-- DB-001 / 7. 업로드 파일 RPC
--
-- DESIGN 8.2의 3~5단계에 해당한다.
--   prepare_upload  : pending asset과 경로 발급. 경로는 생성 열이라 클라이언트가 정할 수 없다.
--   finalize_upload : 업로드 완료 후 ready 전환. 업로더 본인만 가능하다.
--   discard_upload  : 사용자가 취소한 미첨부 파일을 정리 대상으로 돌린다.

begin;

-- ---------------------------------------------------------------------------
-- 7.1 prepareUpload
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

  v_ttl := app_private.config_int('asset_ttl_hours', 24);

  insert into public.assets (space_id, uploader_id, purpose, mime_type, state, expires_at)
  values (v_space, v_user, p_purpose, p_mime_type, 'pending', now() + make_interval(hours => v_ttl))
  returning * into v_asset;

  v_result := jsonb_build_object(
    'assetId', v_asset.id,
    'objectPath', v_asset.object_path,
    'state', v_asset.state,
    'expiresAt', v_asset.expires_at,
    'maxBytes', v_max);

  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

comment on function public.prepare_upload(text, text, bigint, uuid) is
  'pending asset과 Storage 경로를 발급한다. bytes는 사전 검증용이며 확정 값은 finalize_upload에서 기록한다.';

-- ---------------------------------------------------------------------------
-- 7.2 finalizeUpload
-- ---------------------------------------------------------------------------
-- 주의(한계): 이 함수는 호출자가 전달한 bytes/width/height를 기록한다.
-- 실제 파일 디코딩·크기 검증은 Server Action이 Storage에서 수행한 뒤 호출해야 한다.
-- DB는 소유자·공간·상태 전이·상한값만 강제한다.
create or replace function public.finalize_upload(
  p_asset_id   uuid,
  p_bytes      bigint,
  p_width      integer,
  p_height     integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid;
  v_space    uuid;
  v_req      record;
  v_asset    public.assets%rowtype;
  v_max      bigint;
  v_pixels   bigint;
  v_maxpixel bigint;
  v_ttl      integer;
  v_result   jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'finalizeUpload',
    jsonb_build_object('assetId', p_asset_id, 'bytes', p_bytes,
                       'width', p_width, 'height', p_height));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  select * into v_asset
    from public.assets a
   where a.id = p_asset_id
     for update;

  -- 다른 공간이나 다른 업로더의 파일은 존재 자체를 알리지 않는다.
  if not found or v_asset.space_id <> v_space or v_asset.uploader_id <> v_user then
    perform app_private.raise_error('NOT_FOUND', '{"assetId":"missing"}');
  end if;

  if v_asset.state = 'deleting' then
    perform app_private.raise_error('UPLOAD_FAILED', '{"assetId":"deleting"}');
  end if;

  if v_asset.state = 'ready' then
    v_result := jsonb_build_object(
      'assetId', v_asset.id, 'objectPath', v_asset.object_path, 'state', 'ready');
    return app_private.finish_request(v_user, p_request_id, v_result);
  end if;

  if v_asset.expires_at is not null and v_asset.expires_at <= now() then
    perform app_private.raise_error('UPLOAD_FAILED', '{"assetId":"expired"}');
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
         -- 첨부되지 않은 ready 파일도 만료 정리 대상이다(DESIGN 8.2).
         expires_at = now() + make_interval(hours => v_ttl)
   where a.id = v_asset.id
  returning * into v_asset;

  v_result := jsonb_build_object(
    'assetId', v_asset.id,
    'objectPath', v_asset.object_path,
    'state', v_asset.state,
    'expiresAt', v_asset.expires_at);

  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7.3 discardUpload — 사용자가 취소한 파일
-- ---------------------------------------------------------------------------
create or replace function public.discard_upload(
  p_asset_id   uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_space  uuid;
  v_req    record;
  v_asset  public.assets%rowtype;
  v_result jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'discardUpload',
    jsonb_build_object('assetId', p_asset_id));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  select * into v_asset from public.assets a where a.id = p_asset_id for update;
  if not found or v_asset.space_id <> v_space or v_asset.uploader_id <> v_user then
    perform app_private.raise_error('NOT_FOUND', '{"assetId":"missing"}');
  end if;

  if app.is_asset_attached(v_asset.id) then
    perform app_private.raise_error('CONFLICT', '{"assetId":"attached"}');
  end if;

  if v_asset.state <> 'deleting' then
    update public.assets a
       set state = 'deleting', expires_at = now()
     where a.id = v_asset.id;
  end if;

  v_result := jsonb_build_object('assetId', v_asset.id, 'state', 'deleting',
                                 'objectPath', v_asset.object_path);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

commit;
