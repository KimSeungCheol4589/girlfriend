-- DB-001 / 14. 비공개 Storage 버킷과 storage.objects 정책 (전진 마이그레이션)
--
-- DESIGN 6절의 "사진 다운로드 / 대기 중 파일" 규칙을 파일 본문 접근에도 적용한다.
-- 지금까지는 assets 테이블의 메타데이터만 보호했고 객체 자체는 보호되지 않았다.
--
-- 정책 요약 (모두 bucket_id = 'space-assets'로 한정한다. 다른 버킷은 건드리지 않는다.)
--   INSERT : 로그인 사용자가, 자기 공간에서 자기가 만든 pending asset의 **정확한 생성 경로**에만 올릴 수 있다.
--            임의 경로·남의 경로·다른 공간 경로·이미 ready인 경로는 모두 거부된다.
--   SELECT : 같은 공간 구성원이되, ready이면서 실제로 기록·커버에 연결된 파일만 읽는다.
--            업로더 본인은 자기 pending/미첨부 파일도 읽는다(DESIGN 6절 "대기 중 파일: 업로더만").
--            deleting 상태는 누구에게도 열지 않는다.
--   UPDATE : 정책 없음 → 덮어쓰기 불가.
--   DELETE : 정책 없음 → 로그인 사용자는 지울 수 없다. 정리 작업은 BYPASSRLS인 service_role이 한다.
--   anon   : 정책 없음 → 전면 거부.
--
-- 기존 버킷·정책은 수정하지 않는다. 이름이 겹치지 않는 새 정책만 추가한다.

begin;

-- ---------------------------------------------------------------------------
-- 14.1 환경 전제 확인 (수정하지 않고 확인만 한다)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    raise exception 'storage.objects가 없다. Storage 서비스가 있는 환경에서만 이 마이그레이션을 적용한다.';
  end if;
  if to_regclass('storage.buckets') is null then
    raise exception 'storage.buckets가 없다.';
  end if;
  -- RLS를 우리가 켜지 않는다. 꺼져 있으면 Storage 설정 문제이므로 멈춘다.
  if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
    raise exception 'storage.objects에 RLS가 꺼져 있다. 먼저 Storage 설정을 확인한다.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 14.2 비공개 버킷
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('space-assets', 'space-assets', false)
on conflict (id) do nothing;

-- 선택적 열은 존재할 때만 설정한다(Storage 스키마 버전 차이 대응).
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets'
                and column_name = 'file_size_limit') then
    execute $x$update storage.buckets set file_size_limit = 10485760
              where id = 'space-assets' and file_size_limit is distinct from 10485760$x$;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets'
                and column_name = 'allowed_mime_types') then
    execute $x$update storage.buckets
                set allowed_mime_types = array['image/jpeg','image/png','image/webp']
              where id = 'space-assets'$x$;
  end if;
  -- 만약 누군가 공개로 바꿨다면 되돌린다(우리 버킷에 한정).
  update storage.buckets set public = false where id = 'space-assets' and public;
end;
$$;

insert into app_private.app_config (key, value)
values ('storage_bucket', '"space-assets"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 14.3 정책용 헬퍼
-- ---------------------------------------------------------------------------
-- 호출자 자신의 접근 가능 여부만 알려준다. 다른 사람의 파일 존재 여부는 드러나지 않는다.
create or replace function app.can_upload_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_name is not null
     and exists (
       select 1
         from public.assets a
        where a.object_path = p_name
          and a.state = 'pending'
          and a.uploader_id = (select auth.uid())
          and a.space_id = app.current_space_id()
     );
$$;

comment on function app.can_upload_object(text) is
  '생성 열 object_path와 정확히 일치하는 pending 파일에만 업로드를 허용한다. 임의 경로를 만들 수 없다.';

create or replace function app.can_read_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_name is not null
     and exists (
       select 1
         from public.assets a
        where a.object_path = p_name
          and a.space_id = app.current_space_id()
          and a.state <> 'deleting'
          and (
            a.uploader_id = (select auth.uid())
            or (a.state = 'ready' and app.is_asset_attached(a.id))
          )
     );
$$;

comment on function app.can_read_object(text) is
  '상대 구성원에게는 ready이면서 실제 첨부된 파일만 연다. 업로더 본인은 자기 대기 파일도 읽는다.';

revoke all on function app.can_upload_object(text) from public;
revoke all on function app.can_read_object(text)   from public;
grant execute on function app.can_upload_object(text) to authenticated;
grant execute on function app.can_read_object(text)   to authenticated;

-- ---------------------------------------------------------------------------
-- 14.4 storage.objects 정책
-- ---------------------------------------------------------------------------
drop policy if exists space_assets_insert_own_pending on storage.objects;
create policy space_assets_insert_own_pending on storage.objects
  for insert to authenticated
  with check (bucket_id = 'space-assets' and app.can_upload_object(name));

drop policy if exists space_assets_select_visible on storage.objects;
create policy space_assets_select_visible on storage.objects
  for select to authenticated
  using (bucket_id = 'space-assets' and app.can_read_object(name));

-- UPDATE / DELETE 정책은 의도적으로 만들지 않는다(덮어쓰기·사용자 삭제 금지).
-- anon 정책도 만들지 않는다.

-- ---------------------------------------------------------------------------
-- 14.5 prepare_upload가 버킷 이름을 함께 알려주도록 교체
-- ---------------------------------------------------------------------------
create or replace function public.prepare_upload(
  p_purpose    text,
  p_mime_type  text,
  p_bytes      bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid;
  v_space   uuid;
  v_req     record;
  v_max     bigint;
  v_ttl     integer;
  v_bucket  text;
  v_asset   public.assets%rowtype;
  v_result  jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'prepareUpload',
    jsonb_build_object('purpose', p_purpose, 'mimeType', p_mime_type, 'bytes', p_bytes));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  if p_purpose is null or p_purpose not in ('memory', 'cover') then
    perform app_private.raise_error('VALIDATION_ERROR', '{"purpose":"allowed"}');
  end if;
  if p_mime_type is null or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    perform app_private.raise_error('VALIDATION_ERROR', '{"mimeType":"allowed"}');
  end if;

  v_max := app_private.config_bigint('upload_max_bytes', 10485760);
  if p_bytes is null or p_bytes <= 0 or p_bytes > v_max then
    perform app_private.raise_error('VALIDATION_ERROR', '{"bytes":"range"}');
  end if;

  v_ttl    := app_private.config_int('asset_ttl_hours', 24);
  v_bucket := coalesce(
    (select c.value #>> '{}' from app_private.app_config c where c.key = 'storage_bucket'),
    'space-assets');

  insert into public.assets (space_id, uploader_id, purpose, mime_type, state, expires_at)
  values (v_space, v_user, p_purpose, p_mime_type, 'pending', now() + make_interval(hours => v_ttl))
  returning * into v_asset;

  v_result := jsonb_build_object(
    'assetId', v_asset.id,
    'bucket', v_bucket,
    'objectPath', v_asset.object_path,
    'state', v_asset.state,
    'expiresAt', v_asset.expires_at,
    'maxBytes', v_max);

  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

revoke all on function public.prepare_upload(text, text, bigint, uuid) from public, anon;
grant execute on function public.prepare_upload(text, text, bigint, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 14.6 자체 점검
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  if (select b.public from storage.buckets b where b.id = 'space-assets') is distinct from false then
    raise exception 'DB-001 점검 실패: space-assets 버킷이 비공개가 아니다';
  end if;

  select count(*) into v_count from pg_policies p
   where p.schemaname = 'storage' and p.tablename = 'objects'
     and p.policyname in ('space_assets_insert_own_pending', 'space_assets_select_visible');
  if v_count <> 2 then
    raise exception 'DB-001 점검 실패: storage 정책 2개가 만들어지지 않았다 (현재 %)', v_count;
  end if;

  -- 우리가 만든 정책이 UPDATE/DELETE를 열지 않았는지 확인한다.
  if exists (
    select 1 from pg_policies p
     where p.schemaname = 'storage' and p.tablename = 'objects'
       and p.policyname like 'space_assets_%'
       and p.cmd in ('UPDATE', 'DELETE', 'ALL')) then
    raise exception 'DB-001 점검 실패: space_assets 정책이 덮어쓰기/삭제를 허용한다';
  end if;

  -- anon 대상 정책이 없어야 한다.
  if exists (
    select 1 from pg_policies p
     where p.schemaname = 'storage' and p.tablename = 'objects'
       and p.policyname like 'space_assets_%'
       and 'anon' = any(p.roles)) then
    raise exception 'DB-001 점검 실패: space_assets 정책이 anon에 열려 있다';
  end if;
end;
$$;

commit;
