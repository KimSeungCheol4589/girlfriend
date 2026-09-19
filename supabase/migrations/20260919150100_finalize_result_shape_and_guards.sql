-- DB-001 / 16. 최종 검토(7d5d143) 지적 반영 — 낮은 등급 3건
--
-- 적용 전제: 1~15번이 적용된 DB. 테이블을 지우거나 다시 만들지 않는다.
--
-- D8 finalize_upload의 "이미 ready" 분기가 expiresAt을 빼고 돌려준다
--   같은 asset을 **새 requestId**로 다시 확정하면 성공인데 응답 모양이 신규 성공과 달랐다.
--   (같은 requestId 재전송은 저장된 결과를 그대로 재생하므로 문제가 없었다.)
--   수정: 이미 ready인 경우에도 저장돼 있는 expires_at을 그대로 담아 응답 모양을 일치시킨다.
--
-- D9 130100의 정규식 반복 횟수 점검이 300 이상만 잡는다
--   `([3-9][0-9]{2,}|[0-9]{4,})` 패턴이라 256~299와 `{300,}` 같은 상한 없는 형태를 놓쳤다.
--   문자열 패턴으로 숫자 범위를 흉내 내는 방식 자체가 부정확했다.
--   수정: 경계값을 **숫자로 뽑아 비교**한다. 이 점검이 130100의 휴리스틱을 대체한다.
--
-- D10 관련 변경은 SQL이 아니라 테스트 하네스에 있다(supabase/tests/concurrency).
--   동시성 경쟁이 "사전 검사"가 아니라 "예외 핸들러" 경로로 갔는지 단언할 수 있도록
--   두 핸들러의 DETAIL에 진단용 path 키를 붙인다.

begin;

-- ---------------------------------------------------------------------------
-- 16.0 적용 역할 가드 (15번과 동일)
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner text;
begin
  select pg_get_userbyid(c.relowner) into v_owner
    from pg_class c where c.oid = 'public.assets'::regclass;
  if v_owner is distinct from current_user then
    raise exception
      'DB-001: 기존 객체 소유자(%)와 현재 역할(%)이 다르다. 같은 역할(기본값 postgres)로 적용한다.',
      v_owner, current_user;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 16.1 D8 — 이미 ready인 경우에도 expiresAt을 포함
-- ---------------------------------------------------------------------------
create or replace function public.finalize_upload(
  p_asset_id           uuid,
  p_uploader_id        uuid,
  p_bytes              bigint,
  p_width              integer,
  p_height             integer,
  p_verified_mime_type text,
  p_request_id         uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw      text;
  v_claims   jsonb;
  v_req      record;
  v_asset    public.assets%rowtype;
  v_max      bigint;
  v_maxpixel bigint;
  v_pixels   bigint;
  v_ttl      integer;
  v_result   jsonb;
begin
  -- 신뢰 경로 확인
  v_raw := nullif(current_setting('request.jwt.claims', true), '');
  if v_raw is not null then
    begin
      v_claims := v_raw::jsonb;
    exception when others then
      perform app_private.raise_error('FORBIDDEN', '{"actor":"untrusted_session"}');
    end;
    if coalesce(v_claims ->> 'role', '') <> 'service_role' then
      perform app_private.raise_error('FORBIDDEN', '{"actor":"untrusted_session"}');
    end if;
  end if;
  if (select auth.uid()) is not null then
    perform app_private.raise_error('FORBIDDEN', '{"actor":"end_user_session"}');
  end if;

  -- 행위자 계약
  if p_uploader_id is null then
    perform app_private.raise_error('VALIDATION_ERROR', '{"uploaderId":"required"}');
  end if;
  if not exists (select 1 from auth.users u where u.id = p_uploader_id) then
    perform app_private.raise_error('NOT_FOUND', '{"uploaderId":"missing"}');
  end if;

  select * into v_req from app_private.begin_request(
    p_uploader_id, p_request_id, 'finalizeUpload',
    jsonb_build_object('assetId', p_asset_id, 'bytes', p_bytes,
                       'width', p_width, 'height', p_height,
                       'verifiedMimeType', p_verified_mime_type));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  select * into v_asset
    from public.assets a
   where a.id = p_asset_id
     for update;

  if not found or v_asset.uploader_id <> p_uploader_id then
    perform app_private.raise_error('NOT_FOUND', '{"assetId":"missing"}');
  end if;

  if v_asset.state = 'deleting' then
    perform app_private.raise_error('UPLOAD_FAILED', '{"assetId":"deleting"}');
  end if;

  if v_asset.state = 'ready' then
    -- D8: 새 requestId로 다시 확정해도 신규 성공과 같은 모양을 돌려준다.
    --     expiresAt은 저장된 값을 그대로 쓴다(재확정으로 만료를 연장하지 않는다).
    v_result := jsonb_build_object(
      'assetId', v_asset.id,
      'objectPath', v_asset.object_path,
      'state', 'ready',
      'expiresAt', v_asset.expires_at);
    return app_private.finish_request(p_uploader_id, p_request_id, v_result);
  end if;

  if v_asset.expires_at is not null and v_asset.expires_at <= now() then
    perform app_private.raise_error('UPLOAD_FAILED', '{"assetId":"expired"}');
  end if;

  if p_verified_mime_type is null
     or p_verified_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    perform app_private.raise_error('UPLOAD_FAILED', '{"verifiedMimeType":"allowed"}');
  end if;
  if p_verified_mime_type <> v_asset.mime_type then
    perform app_private.raise_error('UPLOAD_FAILED', '{"verifiedMimeType":"mismatch"}');
  end if;

  v_max      := app_private.config_bigint('upload_max_bytes', 10485760);
  v_maxpixel := app_private.config_bigint('upload_max_pixels', 40000000);

  if p_bytes is null or p_bytes <= 0 or p_bytes > v_max then
    perform app_private.raise_error('UPLOAD_FAILED', '{"bytes":"range"}');
  end if;
  if p_width is null or p_height is null or p_width < 1 or p_height < 1 then
    perform app_private.raise_error('UPLOAD_FAILED', '{"dimensions":"invalid"}');
  end if;
  v_pixels := p_width::bigint * p_height::bigint;
  if v_pixels > v_maxpixel then
    perform app_private.raise_error('UPLOAD_FAILED', '{"dimensions":"max_pixels"}');
  end if;

  v_ttl := app_private.config_int('asset_ttl_hours', 24);

  update public.assets a
     set state      = 'ready',
         bytes      = p_bytes,
         width      = p_width,
         height     = p_height,
         ready_at   = now(),
         expires_at = now() + make_interval(hours => v_ttl)
   where a.id = v_asset.id
  returning * into v_asset;

  v_result := jsonb_build_object(
    'assetId', v_asset.id,
    'objectPath', v_asset.object_path,
    'state', v_asset.state,
    'expiresAt', v_asset.expires_at);

  return app_private.finish_request(p_uploader_id, p_request_id, v_result);
end;
$$;

revoke all on function public.finalize_upload(uuid, uuid, bigint, integer, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_upload(uuid, uuid, bigint, integer, integer, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 16.2 D10 보조 — 동시 경쟁 핸들러 경로를 진단 가능하게
-- ---------------------------------------------------------------------------
-- 사전 검사와 UNIQUE 예외 핸들러는 같은 GF409를 돌려준다. 그래서 동시성 테스트가
-- "정말 경쟁이 일어났는지"를 코드만으로는 구분할 수 없었다.
-- DETAIL에 진단용 "path":"unique_violation" 키를 붙인다. 필드 오류가 아니라 진단 힌트다.

create or replace function public.accept_invite(
  p_token      text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid;
  v_email     text;
  v_hash      text;
  v_req       record;
  v_invite    public.space_invites%rowtype;
  v_invite_id uuid;
  v_space_id  uuid;
  v_existing  uuid;
  v_limit     integer;
  v_count     integer;
  v_result    jsonb;
begin
  v_user  := app_private.require_user();
  v_email := app_private.current_verified_email();
  v_hash  := app_private.hash_token(coalesce(p_token, ''));

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'acceptInvite',
    jsonb_build_object('tokenHash', v_hash));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  if p_token is null or char_length(p_token) < 32 then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;
  if v_email is null then
    perform app_private.raise_error('INVITE_INVALID', '{"email":"unverified"}');
  end if;

  select i.id, i.space_id into v_invite_id, v_space_id
    from public.space_invites i where i.token_hash = v_hash;
  if v_invite_id is null then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;

  perform 1 from public.spaces s where s.id = v_space_id for update;

  select * into v_invite
    from public.space_invites i
   where i.id = v_invite_id
     for update;
  if not found then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;

  if v_invite.target_email <> v_email then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;

  if v_invite.accepted_at is not null then
    if v_invite.accepted_by = v_user then
      v_result := jsonb_build_object('spaceId', v_invite.space_id, 'alreadyAccepted', true);
      return app_private.finish_request(v_user, p_request_id, v_result);
    end if;
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;

  if v_invite.revoked_at is not null then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;

  if v_invite.expires_at <= now() then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"expired"}');
  end if;

  select m.space_id into v_existing from public.space_members m where m.user_id = v_user;
  if v_existing is not null then
    if v_existing = v_invite.space_id then
      update public.space_invites i
         set accepted_at = now(), accepted_by = v_user
       where i.id = v_invite.id;
      v_result := jsonb_build_object('spaceId', v_invite.space_id, 'alreadyAccepted', true);
      return app_private.finish_request(v_user, p_request_id, v_result);
    end if;
    -- 사전 검사 경로(순차 실행)
    perform app_private.raise_error('CONFLICT', '{"space":"already_member_of_other_space"}');
  end if;

  v_limit := app_private.config_int('space_member_limit', 2);
  select count(*) into v_count from public.space_members m where m.space_id = v_invite.space_id;
  if v_count >= v_limit then
    perform app_private.raise_error('SPACE_FULL', '{"space":"member_limit"}');
  end if;

  perform app_private.ensure_profile(v_user);

  begin
    insert into public.space_members (space_id, user_id) values (v_invite.space_id, v_user);
  exception when unique_violation then
    -- 동시 경쟁 경로. path는 진단용이며 필드 오류가 아니다.
    perform app_private.raise_error('CONFLICT',
      '{"space":"already_member_of_other_space","path":"unique_violation"}');
  end;

  update public.space_invites i
     set accepted_at = now(), accepted_by = v_user
   where i.id = v_invite.id;

  if v_count + 1 >= v_limit then
    update public.space_invites i
       set revoked_at = now()
     where i.space_id = v_invite.space_id
       and i.accepted_at is null
       and i.revoked_at is null;
  end if;

  v_result := jsonb_build_object('spaceId', v_invite.space_id, 'alreadyAccepted', false);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

revoke all on function public.accept_invite(text, uuid) from public, anon;
grant execute on function public.accept_invite(text, uuid) to authenticated;

create or replace function public.update_profile(
  p_nickname         text,
  p_expected_version integer,
  p_request_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid;
  v_req      record;
  v_row      public.profiles%rowtype;
  v_nickname text;
  v_created  boolean := false;
  v_result   jsonb;
begin
  v_user := app_private.require_user();

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'updateProfile',
    jsonb_build_object('nickname', p_nickname, 'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  v_nickname := btrim(coalesce(p_nickname, ''));
  if char_length(v_nickname) < 1 or char_length(v_nickname) > 20 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"nickname":"length"}');
  end if;

  select * into v_row from public.profiles p where p.id = v_user for update;
  if not found then
    if coalesce(p_expected_version, 0) <> 0 then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end if;
    begin
      insert into public.profiles (id, nickname) values (v_user, v_nickname)
      returning * into v_row;
      v_created := true;
    exception when unique_violation then
      -- 동시 경쟁 경로. path는 진단용이며 필드 오류가 아니다.
      perform app_private.raise_error('CONFLICT',
        '{"expectedVersion":"stale","path":"unique_violation"}');
    end;
  end if;

  if not v_created then
    if p_expected_version is null or v_row.version <> p_expected_version then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end if;
    update public.profiles p
       set nickname = v_nickname,
           version  = p.version + 1
     where p.id = v_user
    returning * into v_row;
  end if;

  v_result := jsonb_build_object('userId', v_row.id, 'version', v_row.version);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

revoke all on function public.update_profile(text, integer, uuid) from public, anon;
grant execute on function public.update_profile(text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 16.3 D9 — 정규식 반복 횟수 점검을 숫자 비교로 교체
-- ---------------------------------------------------------------------------
-- PostgreSQL은 `{m,n}`의 m, n을 모두 255까지만 허용한다(초과 시 실행 시점에 2201B).
-- 130100의 문자열 패턴 점검은 300 이상만 잡아 256~299와 `{300,}`을 놓쳤다.
-- 여기서는 경계값을 숫자로 뽑아 비교한다. 이 점검이 130100의 휴리스틱을 대체한다.
do $$
declare
  v_bad text;
begin
  with src as (
    select format('%s.%s', n.nspname, p.proname) as what, p.prosrc as body
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app', 'app_private')
    union all
    select format('%s.%s', c.relname, con.conname), pg_get_constraintdef(con.oid)
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and con.contype = 'c'
  ),
  bounds as (
    select s.what,
           m[1] as lo,
           nullif(m[2], '') as hi
      from src s,
           lateral regexp_matches(s.body, '\{([0-9]+)(?:,([0-9]*))?\}', 'g') as m
  )
  select string_agg(distinct format('%s {%s,%s}', b.what, b.lo, coalesce(b.hi, '')), ', ')
    into v_bad
    from bounds b
   where b.lo::bigint > 255
      or (b.hi is not null and b.hi::bigint > 255);

  if v_bad is not null then
    raise exception
      'DB-001 점검 실패: 정규식 반복 횟수가 255를 넘는다(실행 시점 2201B). 길이 제한은 char_length로 표현한다. (%)',
      v_bad;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 16.4 자체 점검
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated',
       'public.finalize_upload(uuid,uuid,bigint,integer,integer,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.finalize_upload(uuid,uuid,bigint,integer,integer,text,uuid)', 'EXECUTE') then
    raise exception 'DB-001 점검 실패: finalize_upload가 로그인 사용자에게 노출됐다';
  end if;
  if not has_function_privilege('authenticated', 'public.accept_invite(text,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_profile(text,integer,uuid)', 'EXECUTE') then
    raise exception 'DB-001 점검 실패: 재정의한 RPC의 실행 권한이 빠졌다';
  end if;
end;
$$;

commit;
