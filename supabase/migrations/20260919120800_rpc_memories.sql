-- DB-001 / 8. 추억 RPC
--
-- DESIGN 7절 saveMemory / deleteMemory.
-- 본문과 사진 연결을 한 트랜잭션에서 저장한다. 사진 집합 교체는
-- 기록 행을 잠근 뒤 처리하고, 떨어져 나간 파일은 deleting으로 돌린다.

begin;

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

    -- 작성자와 공간은 바뀌지 않는다(트리거에서도 다시 막는다).
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
  select coalesce(array_agg(p.asset_id), '{}'::uuid[]) into v_current
    from public.memory_photos p
   where p.memory_id = v_memory.id;

  select coalesce(array_agg(t.x), '{}'::uuid[]) into v_removed
    from unnest(v_current) as t(x)
   where not (t.x = any(v_photos));

  -- 1) 기존 연결을 모두 끊는다. 순서 UNIQUE는 커밋 시점 검사라 재정렬이 가능하다.
  delete from public.memory_photos p where p.memory_id = v_memory.id;

  -- 2) 빠진 파일은 정리 대상으로 돌린다.
  if coalesce(array_length(v_removed, 1), 0) > 0 then
    update public.assets a
       set state = 'deleting', expires_at = now()
     where a.id = any(v_removed)
       and a.state <> 'deleting';
  end if;

  -- 3) 요청 순서대로 다시 연결한다.
  for v_item in
    select t.asset_id, t.ord
      from unnest(v_photos) with ordinality as t(asset_id, ord)
     order by t.ord
  loop
    -- 파일 행을 잠가 정리 작업·다른 저장과 직렬화한다(DESIGN 8.2).
    select * into v_asset from public.assets a where a.id = v_item.asset_id for update;
    if not found or v_asset.space_id <> v_space then
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

    insert into public.memory_photos (memory_id, space_id, asset_id, sort_order)
    values (v_memory.id, v_space, v_asset.id, v_item.ord - 1);

    -- 첨부된 파일은 미첨부 만료 정리 대상에서 제외한다.
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

comment on function public.save_memory(uuid, text, text, date, text, text[], uuid[], boolean, integer, uuid) is
  '추억 본문과 사진 연결을 원자적으로 저장한다. detachedAssets는 Storage 정리 대상이다.';

-- ---------------------------------------------------------------------------
-- deleteMemory
-- ---------------------------------------------------------------------------
create or replace function public.delete_memory(
  p_memory_id        uuid,
  p_expected_version integer,
  p_request_id       uuid
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
  v_memory  public.memories%rowtype;
  v_assets  uuid[];
  v_removed jsonb;
  v_result  jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'deleteMemory',
    jsonb_build_object('memoryId', p_memory_id, 'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  select * into v_memory
    from public.memories m
   where m.id = p_memory_id and m.space_id = v_space
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"memoryId":"missing"}');
  end if;
  if p_expected_version is null or v_memory.version <> p_expected_version then
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  select coalesce(array_agg(p.asset_id), '{}'::uuid[]) into v_assets
    from public.memory_photos p
   where p.memory_id = v_memory.id;

  delete from public.memory_photos p where p.memory_id = v_memory.id;

  if coalesce(array_length(v_assets, 1), 0) > 0 then
    update public.assets a
       set state = 'deleting', expires_at = now()
     where a.id = any(v_assets)
       and a.state <> 'deleting';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('assetId', a.id, 'objectPath', a.object_path)), '[]'::jsonb)
    into v_removed
    from public.assets a
   where a.id = any(v_assets);

  delete from public.memories m where m.id = v_memory.id;

  v_result := jsonb_build_object('memoryId', v_memory.id, 'detachedAssets', v_removed);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

commit;
