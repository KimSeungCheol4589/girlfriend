-- DB-001 / 13. 업로드 확정의 신뢰 경계 수정 (전진 마이그레이션)
--
-- 문제
--   기존 public.finalize_upload는 authenticated가 직접 호출할 수 있었고
--   bytes/width/height를 호출자가 보낸 값 그대로 기록했다.
--   "Server Action이 먼저 검증한다"는 관례는 방어가 아니다. RPC를 직접 호출하면 우회된다.
--   결과적으로 사용자가 아무 파일도 올리지 않고 임의 메타데이터로 asset을 ready로 만들 수 있었다.
--
-- 수정
--   1) ready 전환은 신뢰된 서버 역할(service_role) 또는 DB 워커(postgres)만 할 수 있다.
--      authenticated/anon에는 EXECUTE를 주지 않는다.
--   2) 행위자를 암묵적 세션이 아니라 명시적 인자(p_uploader_id)로 받고,
--      asset의 실제 업로더와 일치할 때만 진행한다.
--   3) 최종 사용자 세션 컨텍스트에서 호출되면 권한이 잘못 부여되더라도 거부한다(이중 방어).
--   4) 서버가 실제로 확인한 MIME을 인자로 받아 prepare 단계의 선언값과 일치하는지 본다.
--
-- 범위 한계(문서화된 사실)
--   **DB는 이미지 바이너리를 디코딩하지 않는다.** 실제 디코딩·픽셀 수·EXIF 제거 검증은
--   신뢰된 서버 워커가 수행해야 하며 아직 구현되지 않았다. 이 마이그레이션은 그 검증 결과를
--   기록할 수 있는 주체를 신뢰된 역할로 좁힌 것이다. DB가 이미지를 검증한다고 주장하지 않는다.

begin;

-- 예전 서명은 제거한다(로그인 사용자가 호출할 수 있던 경로).
drop function if exists public.finalize_upload(uuid, bigint, integer, integer, uuid);

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
  -- ---------------- 신뢰 경로 확인 ----------------
  -- PostgREST 요청이면 service_role 키로 온 것만 허용한다.
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
  -- 최종 사용자 세션(= sub 클레임 보유)에서는 어떤 경우에도 확정할 수 없다.
  if (select auth.uid()) is not null then
    perform app_private.raise_error('FORBIDDEN', '{"actor":"end_user_session"}');
  end if;

  -- ---------------- 행위자 계약 ----------------
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

  -- 지정한 업로더의 파일이 아니면 존재 여부를 알리지 않는다.
  if not found or v_asset.uploader_id <> p_uploader_id then
    perform app_private.raise_error('NOT_FOUND', '{"assetId":"missing"}');
  end if;

  if v_asset.state = 'deleting' then
    perform app_private.raise_error('UPLOAD_FAILED', '{"assetId":"deleting"}');
  end if;

  if v_asset.state = 'ready' then
    v_result := jsonb_build_object(
      'assetId', v_asset.id, 'objectPath', v_asset.object_path, 'state', 'ready');
    return app_private.finish_request(p_uploader_id, p_request_id, v_result);
  end if;

  if v_asset.expires_at is not null and v_asset.expires_at <= now() then
    perform app_private.raise_error('UPLOAD_FAILED', '{"assetId":"expired"}');
  end if;

  -- ---------------- 서버가 확인했다고 보고한 값의 상한 검사 ----------------
  if p_verified_mime_type is null
     or p_verified_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    perform app_private.raise_error('UPLOAD_FAILED', '{"verifiedMimeType":"allowed"}');
  end if;
  if p_verified_mime_type <> v_asset.mime_type then
    -- prepare 단계에서 선언한 유형과 실제 확인 유형이 다르면 경로·확장자가 어긋난다.
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

comment on function public.finalize_upload(uuid, uuid, bigint, integer, integer, text, uuid) is
  '신뢰된 서버 역할만 호출한다. 업로더를 명시 인자로 받고 최종 사용자 세션에서는 거부한다. DB는 이미지를 디코딩하지 않는다.';

revoke all on function public.finalize_upload(uuid, uuid, bigint, integer, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_upload(uuid, uuid, bigint, integer, integer, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 자체 점검
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated',
       'public.finalize_upload(uuid,uuid,bigint,integer,integer,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.finalize_upload(uuid,uuid,bigint,integer,integer,text,uuid)', 'EXECUTE') then
    raise exception 'DB-001 점검 실패: finalize_upload가 로그인 사용자에게 노출됐다';
  end if;
  if not has_function_privilege('service_role',
       'public.finalize_upload(uuid,uuid,bigint,integer,integer,text,uuid)', 'EXECUTE') then
    raise exception 'DB-001 점검 실패: service_role이 finalize_upload를 실행할 수 없다';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'finalize_upload'
       and pg_get_function_identity_arguments(p.oid) = 'uuid, bigint, integer, integer, uuid') then
    raise exception 'DB-001 점검 실패: 예전 finalize_upload 서명이 남아 있다';
  end if;
end;
$$;

commit;
