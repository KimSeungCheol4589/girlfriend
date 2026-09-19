-- DB-001 / 15. 독립 검토 지적 반영 (전진 마이그레이션)
--
-- 적용 전제: 1~14번이 이미 적용된 DB. 테이블을 지우거나 다시 만들지 않는다.
--
-- D2 (보안) 새로 첨부하는 파일의 업로더 검사 누락
--   save_memory / save_customization이 파일의 공간·목적·상태만 확인하고 **업로더를 보지 않았다**.
--   상대 구성원이 asset UUID를 알아내면 상대가 올린 비공개(대기/미첨부) 파일을 자기 기록이나
--   커버에 붙여 노출시킬 수 있었다. RLS가 숨기던 파일이 첨부되는 순간 공개된다.
--   수정: **새로 붙는 파일에만** 업로더 일치를 요구한다.
--         이미 그 기록에 붙어 있던 사진(유지·재정렬)과 바뀌지 않는 기존 커버는 두 구성원 모두 다룰 수 있다.
--   거부는 NOT_FOUND로 통일해 파일 존재 여부를 알리지 않는다(업로더 검사를 상태 검사보다 먼저 한다).
--
-- D3 (계약) 동시 실행에서 원시 23505가 새어 나감
--   accept_invite의 서로 다른 공간 동시 수락, update_profile의 첫 프로필 동시 생성이
--   UNIQUE 위반을 그대로 던져 계약에 없는 SQLSTATE가 나왔다.
--   수정: 해당 INSERT만 감싸 CONFLICT(GF409)로 매핑한다.
--         새 잠금을 추가하지 않으므로 잠금 순서 문제나 교착이 생기지 않는다.
--   memory_photos의 asset UNIQUE도 같은 방식으로 매핑한다(사전 검사와 삽입 사이 경쟁).
--
-- D6 (정보 노출) app.is_asset_attached가 공간 범위를 보지 않음
--   anon/authenticated에 EXECUTE가 있어, 외부 계정이 asset UUID를 찍어 보면
--   "첨부되어 있는가"라는 불리언을 알 수 있었다.
--   수정: 호출자의 현재 공간으로 한정한다. 정책 의미는 그대로다
--         (호출하는 정책·헬퍼가 이미 같은 공간 조건을 함께 요구한다).
--
-- D7 (운영) 기본 권한은 적용 역할에만 적용됨
--   20260919120100의 ALTER DEFAULT PRIVILEGES는 **그 문을 실행한 역할**에만 적용된다.
--   다른 역할로 마이그레이션을 적용하면 신규 객체에 기본 권한이 다시 붙을 수 있다.
--   수정: 기존 객체 소유자와 현재 역할이 같은지 검사하고 다르면 멈춘다.

begin;

-- ---------------------------------------------------------------------------
-- 15.0 적용 역할 가드
-- ---------------------------------------------------------------------------
-- 기본 권한 회수와 SECURITY DEFINER 소유자가 모두 "최초 적용 역할" 기준이다.
-- 다른 역할로 적용하면 신규 함수의 정의자가 달라지고 기본 권한 회수도 적용되지 않는다.
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
  if current_user <> 'postgres' then
    raise warning
      'DB-001: 적용 역할이 postgres가 아니다(%). 20260919120100의 ALTER DEFAULT PRIVILEGES를 이 역할로도 실행했는지 확인한다.',
      current_user;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 15.1 D6 — 첨부 여부 헬퍼를 호출자 공간으로 한정
-- ---------------------------------------------------------------------------
create or replace function app.is_asset_attached(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_asset_id is not null
     and exists (
       select 1
         from public.assets a
        where a.id = p_asset_id
          -- 호출자 공간 밖의 파일에 대해서는 어떤 사실도 알려주지 않는다.
          and a.space_id = app.current_space_id()
          and (
            exists (select 1 from public.memory_photos p where p.asset_id = a.id)
            or exists (select 1 from public.space_settings s where s.cover_asset_id = a.id)
          )
     );
$$;

comment on function app.is_asset_attached(uuid) is
  '호출자의 현재 공간에 속한 파일에 대해서만 첨부 여부를 알려준다. 외부 계정에는 항상 false다.';

-- ---------------------------------------------------------------------------
-- 15.2 D2/D3 — save_memory
-- ---------------------------------------------------------------------------
create or replace function public.save_memory(
  p_memory_id        uuid,
  p_title            text,
  p_body             text,
  p_memory_date      date,
  p_location         text,
  p_tags             text[],
  p_photo_asset_ids  uuid[],
  p_is_pinned        boolean,
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
  v_space    uuid;
  v_req      record;
  v_memory   public.memories%rowtype;
  v_title    text;
  v_body     text;
  v_location text;
  v_tags     text[];
  v_photos   uuid[];
  v_current  uuid[];
  v_removed  uuid[];
  v_limit    integer;
  v_item     record;
  v_asset    public.assets%rowtype;
  v_detached jsonb;
  v_result   jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'saveMemory',
    jsonb_build_object(
      'memoryId', p_memory_id,
      'title', p_title,
      'body', p_body,
      'memoryDate', p_memory_date,
      'location', p_location,
      'tags', to_jsonb(coalesce(p_tags, '{}'::text[])),
      'photoAssetIds', to_jsonb(coalesce(p_photo_asset_ids, '{}'::uuid[])),
      'isPinned', coalesce(p_is_pinned, false),
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  -- ---------------- 입력 검증 ----------------
  v_title    := btrim(coalesce(p_title, ''));
  v_body     := coalesce(p_body, '');
  v_location := nullif(btrim(coalesce(p_location, '')), '');

  select coalesce(array_agg(s.v order by s.ord), '{}'::text[]) into v_tags
    from (
      select btrim(t.v) as v, t.ord
        from unnest(coalesce(p_tags, '{}'::text[])) with ordinality as t(v, ord)
    ) s
   where s.v <> '';

  v_photos := coalesce(p_photo_asset_ids, '{}'::uuid[]);
  v_limit  := app_private.config_int('memory_photo_limit', 10);

  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"title":"length"}');
  end if;
  if char_length(v_body) > 10000 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"body":"length"}');
  end if;
  if v_location is not null and char_length(v_location) > 100 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"location":"length"}');
  end if;
  if p_memory_date is null then
    perform app_private.raise_error('VALIDATION_ERROR', '{"memoryDate":"required"}');
  end if;
  if p_memory_date > app_private.kst_today() then
    perform app_private.raise_error('VALIDATION_ERROR', '{"memoryDate":"future_date"}');
  end if;
  if not app_private.is_valid_tags(v_tags) then
    perform app_private.raise_error('VALIDATION_ERROR', '{"tags":"invalid"}');
  end if;
  if coalesce(array_length(v_photos, 1), 0) > v_limit then
    perform app_private.raise_error('VALIDATION_ERROR', '{"photoAssetIds":"limit"}');
  end if;
  if (select count(distinct t.x) from unnest(v_photos) as t(x)) <> coalesce(array_length(v_photos, 1), 0) then
    perform app_private.raise_error('VALIDATION_ERROR', '{"photoAssetIds":"duplicate"}');
  end if;

  -- ---------------- 기록 생성 또는 수정 ----------------
  if p_memory_id is null then
    if coalesce(p_expected_version, 0) <> 0 then
      perform app_private.raise_error('VALIDATION_ERROR', '{"expectedVersion":"must_be_zero_on_create"}');
    end if;
    insert into public.memories (space_id, author_id, title, body, memory_date, location, tags, is_pinned)
    values (v_space, v_user, v_title, v_body, p_memory_date, v_location, v_tags, coalesce(p_is_pinned, false))
    returning * into v_memory;
  else
    select * into v_memory
      from public.memories m
     where m.id = p_memory_id and m.space_id = v_space
       for update;
    if not found then
      perform app_private.raise_error('NOT_FOUND', '{"memoryId":"missing"}');
    end if;
    if p_expected_version is null then
      perform app_private.raise_error('VALIDATION_ERROR', '{"expectedVersion":"required"}');
    end if;
    if v_memory.version <> p_expected_version then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end if;

    update public.memories m
       set title       = v_title,
           body        = v_body,
           memory_date = p_memory_date,
           location    = v_location,
           tags        = v_tags,
           is_pinned   = coalesce(p_is_pinned, v_memory.is_pinned),
           version     = m.version + 1
     where m.id = v_memory.id
    returning * into v_memory;
  end if;

  -- ---------------- 사진 집합 교체 ----------------
  -- v_current는 "이 호출 전에 이 기록에 붙어 있던" 집합이다. 업로더 검사 면제 기준이 된다.
  select coalesce(array_agg(p.asset_id), '{}'::uuid[]) into v_current
    from public.memory_photos p
   where p.memory_id = v_memory.id;

  select coalesce(array_agg(t.x), '{}'::uuid[]) into v_removed
    from unnest(v_current) as t(x)
   where not (t.x = any(v_photos));

  delete from public.memory_photos p where p.memory_id = v_memory.id;

  if coalesce(array_length(v_removed, 1), 0) > 0 then
    update public.assets a
       set state = 'deleting', expires_at = now()
     where a.id = any(v_removed)
       and a.state <> 'deleting';
  end if;

  for v_item in
    select t.asset_id, t.ord
      from unnest(v_photos) with ordinality as t(asset_id, ord)
     order by t.ord
  loop
    select * into v_asset from public.assets a where a.id = v_item.asset_id for update;
    if not found or v_asset.space_id <> v_space then
      perform app_private.raise_error('NOT_FOUND', '{"photoAssetIds":"missing"}');
    end if;

    -- D2: 새로 붙이는 파일은 올린 사람만 붙일 수 있다.
    -- 이미 이 기록에 붙어 있던 사진(유지·재정렬)은 두 구성원 모두 다룰 수 있다.
    -- 상태·목적 검사보다 먼저 해서 남의 비공개 파일의 존재를 알리지 않는다.
    if not (v_asset.id = any(v_current)) and v_asset.uploader_id <> v_user then
      perform app_private.raise_error('NOT_FOUND', '{"photoAssetIds":"missing"}');
    end if;

    if v_asset.purpose <> 'memory' then
      perform app_private.raise_error('VALIDATION_ERROR', '{"photoAssetIds":"purpose"}');
    end if;
    if v_asset.state <> 'ready' then
      perform app_private.raise_error('VALIDATION_ERROR', '{"photoAssetIds":"not_ready"}');
    end if;
    if exists (select 1 from public.memory_photos p where p.asset_id = v_asset.id) then
      perform app_private.raise_error('CONFLICT', '{"photoAssetIds":"already_attached"}');
    end if;

    -- D3: 사전 검사와 삽입 사이의 경쟁은 UNIQUE가 잡는다. 계약 코드로 바꿔 던진다.
    begin
      insert into public.memory_photos (memory_id, space_id, asset_id, sort_order)
      values (v_memory.id, v_space, v_asset.id, v_item.ord - 1);
    exception when unique_violation then
      perform app_private.raise_error('CONFLICT', '{"photoAssetIds":"already_attached"}');
    end;

    update public.assets a set expires_at = null where a.id = v_asset.id;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('assetId', a.id, 'objectPath', a.object_path)), '[]'::jsonb)
    into v_detached
    from public.assets a
   where a.id = any(v_removed);

  v_result := jsonb_build_object(
    'memoryId', v_memory.id,
    'version', v_memory.version,
    'photoCount', coalesce(array_length(v_photos, 1), 0),
    'detachedAssets', v_detached);

  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

revoke all on function public.save_memory(uuid, text, text, date, text, text[], uuid[], boolean, integer, uuid)
  from public, anon;
grant execute on function public.save_memory(uuid, text, text, date, text, text[], uuid[], boolean, integer, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 15.3 D2 — save_customization (새 커버에만 업로더 요구)
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

  -- 커버를 **바꿀 때만** 검사한다. 기존 커버를 그대로 두는 저장은 두 구성원 모두 할 수 있다.
  if p_cover_asset_id is not null and p_cover_asset_id is distinct from v_previous then
    select * into v_asset from public.assets a where a.id = p_cover_asset_id for update;
    if not found or v_asset.space_id <> v_space then
      perform app_private.raise_error('NOT_FOUND', '{"coverAssetId":"missing"}');
    end if;
    -- D2: 새 커버는 올린 사람만 지정할 수 있다. 존재 여부를 알리지 않기 위해 NOT_FOUND로 통일한다.
    if v_asset.uploader_id <> v_user then
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

  if p_cover_asset_id is not null then
    update public.assets a set expires_at = null where a.id = p_cover_asset_id;
  end if;

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

revoke all on function public.save_customization(text, text, uuid, jsonb, integer, uuid) from public, anon;
grant execute on function public.save_customization(text, text, uuid, jsonb, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 15.4 D3 — accept_invite: 서로 다른 공간 동시 수락을 계약 코드로
-- ---------------------------------------------------------------------------
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
    perform app_private.raise_error('CONFLICT', '{"space":"already_member_of_other_space"}');
  end if;

  v_limit := app_private.config_int('space_member_limit', 2);
  select count(*) into v_count from public.space_members m where m.space_id = v_invite.space_id;
  if v_count >= v_limit then
    perform app_private.raise_error('SPACE_FULL', '{"space":"member_limit"}');
  end if;

  perform app_private.ensure_profile(v_user);

  -- D3: 서로 다른 공간의 초대를 동시에 수락하면 두 세션이 각자 다른 공간 행을 잠그므로
  --     위 검사만으로는 직렬화되지 않는다. 계정당 공간 하나 UNIQUE가 최종 방어이고,
  --     그 위반을 원시 23505 대신 계약 코드로 바꿔 던진다.
  begin
    insert into public.space_members (space_id, user_id) values (v_invite.space_id, v_user);
  exception when unique_violation then
    perform app_private.raise_error('CONFLICT', '{"space":"already_member_of_other_space"}');
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

-- ---------------------------------------------------------------------------
-- 15.5 D3 — update_profile: 첫 프로필 동시 생성
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
    if coalesce(p_expected_version, 0) <> 0 then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end if;
    -- D3: 동시에 들어온 첫 저장 두 건은 PK UNIQUE가 잡는다.
    --     늦은 쪽에서는 expectedVersion 0이 이미 낡은 값이므로 CONFLICT가 맞다.
    begin
      insert into public.profiles (id, nickname) values (v_user, v_nickname)
      returning * into v_row;
      v_created := true;
    exception when unique_violation then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
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
-- 15.6 자체 점검
-- ---------------------------------------------------------------------------
do $$
begin
  -- 정책이 여전히 헬퍼를 호출할 수 있어야 한다.
  if not has_function_privilege('authenticated', 'app.is_asset_attached(uuid)', 'EXECUTE') then
    raise exception 'DB-001 점검 실패: 정책이 쓰는 app.is_asset_attached 실행 권한이 사라졌다';
  end if;
  -- 재정의한 RPC가 로그인 사용자에게 계속 열려 있어야 한다.
  if not has_function_privilege('authenticated',
       'public.save_memory(uuid,text,text,date,text,text[],uuid[],boolean,integer,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.save_customization(text,text,uuid,jsonb,integer,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.accept_invite(text,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_profile(text,integer,uuid)', 'EXECUTE') then
    raise exception 'DB-001 점검 실패: 재정의한 RPC의 실행 권한이 빠졌다';
  end if;
  -- 재정의한 함수가 anon에 열리면 안 된다.
  if has_function_privilege('anon',
       'public.save_memory(uuid,text,text,date,text,text[],uuid[],boolean,integer,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.accept_invite(text,uuid)', 'EXECUTE') then
    raise exception 'DB-001 점검 실패: 재정의한 RPC가 anon에 노출됐다';
  end if;
end;
$$;

commit;
