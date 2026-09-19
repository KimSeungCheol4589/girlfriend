-- DB-001 / 10. 꾸미기·공간 정보·프로필 RPC
--
-- DESIGN 4.2 / 7절.
--   * 섹션 JSON은 지정한 3개 키를 정확히 한 번씩 포함해야 한다.
--   * 커버 교체 시 이전 커버는 참조를 끊은 뒤 deleting으로 돌린다.
--   * 공유 설정은 구성원 모두, 프로필은 본인만 바꿀 수 있다.

begin;

-- ---------------------------------------------------------------------------
-- 10.1 saveCustomization
-- ---------------------------------------------------------------------------
create or replace function public.save_customization(
  p_theme_key        text,
  p_accent_color     text,
  p_cover_asset_id   uuid,
  p_home_sections    jsonb,
  p_expected_version integer,
  p_request_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid;
  v_space     uuid;
  v_req       record;
  v_settings  public.space_settings%rowtype;
  v_accent    text;
  v_previous  uuid;
  v_asset     public.assets%rowtype;
  v_released  jsonb := '[]'::jsonb;
  v_result    jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'saveCustomization',
    jsonb_build_object(
      'themeKey', p_theme_key,
      'accentColor', p_accent_color,
      'coverAssetId', p_cover_asset_id,
      'sections', p_home_sections,
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  v_accent := lower(btrim(coalesce(p_accent_color, '')));

  if p_theme_key is null or p_theme_key not in ('cream', 'rose', 'sage') then
    perform app_private.raise_error('VALIDATION_ERROR', '{"themeKey":"allowed"}');
  end if;
  if v_accent !~ '^#[0-9a-f]{6}$' then
    perform app_private.raise_error('VALIDATION_ERROR', '{"accentColor":"format"}');
  end if;
  if not app_private.is_valid_home_sections(p_home_sections) then
    perform app_private.raise_error('VALIDATION_ERROR', '{"sections":"invalid"}');
  end if;

  select * into v_settings
    from public.space_settings s
   where s.space_id = v_space
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"spaceId":"missing"}');
  end if;
  if p_expected_version is null or v_settings.version <> p_expected_version then
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  v_previous := v_settings.cover_asset_id;

  if p_cover_asset_id is not null and p_cover_asset_id is distinct from v_previous then
    select * into v_asset from public.assets a where a.id = p_cover_asset_id for update;
    if not found or v_asset.space_id <> v_space then
      perform app_private.raise_error('NOT_FOUND', '{"coverAssetId":"missing"}');
    end if;
    if v_asset.purpose <> 'cover' then
      perform app_private.raise_error('VALIDATION_ERROR', '{"coverAssetId":"purpose"}');
    end if;
    if v_asset.state <> 'ready' then
      perform app_private.raise_error('VALIDATION_ERROR', '{"coverAssetId":"not_ready"}');
    end if;
  end if;

  update public.space_settings s
     set theme_key      = p_theme_key,
         accent_color   = v_accent,
         cover_asset_id = p_cover_asset_id,
         home_sections  = p_home_sections,
         version        = s.version + 1
   where s.space_id = v_space
  returning * into v_settings;

  -- 새 커버는 미첨부 만료 정리 대상에서 제외한다.
  if p_cover_asset_id is not null then
    update public.assets a set expires_at = null where a.id = p_cover_asset_id;
  end if;

  -- 참조가 끊어진 이전 커버를 정리 대상으로 돌린다(DESIGN 8.3).
  if v_previous is not null and v_previous is distinct from p_cover_asset_id then
    update public.assets a
       set state = 'deleting', expires_at = now()
     where a.id = v_previous
       and a.state <> 'deleting'
       and not exists (select 1 from public.memory_photos p where p.asset_id = a.id);

    select coalesce(jsonb_agg(jsonb_build_object('assetId', a.id, 'objectPath', a.object_path)), '[]'::jsonb)
      into v_released
      from public.assets a
     where a.id = v_previous and a.state = 'deleting';
  end if;

  v_result := jsonb_build_object(
    'spaceId', v_space,
    'version', v_settings.version,
    'coverAssetId', v_settings.cover_asset_id,
    'detachedAssets', v_released);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10.2 updateSpace
-- ---------------------------------------------------------------------------
create or replace function public.update_space(
  p_name                    text,
  p_introduction            text,
  p_relationship_start_date date,
  p_expected_version        integer,
  p_request_id              uuid
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
  v_row    public.spaces%rowtype;
  v_name   text;
  v_intro  text;
  v_result jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'updateSpace',
    jsonb_build_object(
      'name', p_name,
      'introduction', p_introduction,
      'relationshipStartDate', p_relationship_start_date,
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  v_name  := btrim(coalesce(p_name, ''));
  v_intro := btrim(coalesce(p_introduction, ''));

  if char_length(v_name) < 1 or char_length(v_name) > 30 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"name":"length"}');
  end if;
  if char_length(v_intro) > 200 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"introduction":"length"}');
  end if;
  if p_relationship_start_date is not null
     and p_relationship_start_date > app_private.kst_today() then
    perform app_private.raise_error('VALIDATION_ERROR', '{"relationshipStartDate":"future_date"}');
  end if;

  select * into v_row from public.spaces s where s.id = v_space for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"spaceId":"missing"}');
  end if;
  if p_expected_version is null or v_row.version <> p_expected_version then
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  update public.spaces s
     set name                    = v_name,
         introduction            = v_intro,
         relationship_start_date = p_relationship_start_date,
         version                 = s.version + 1
   where s.id = v_space
  returning * into v_row;

  v_result := jsonb_build_object('spaceId', v_row.id, 'version', v_row.version);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10.3 updateProfile — 본인만
-- ---------------------------------------------------------------------------
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
    -- 첫 저장이면 프로필을 만든다. expectedVersion 0을 허용한다.
    if coalesce(p_expected_version, 0) <> 0 then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end if;
    insert into public.profiles (id, nickname) values (v_user, v_nickname)
    returning * into v_row;
    v_created := true;
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

commit;
