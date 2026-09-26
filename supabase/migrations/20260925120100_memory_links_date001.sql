-- DATE-001 / 1. 데이트 기록 연결(memory_links) 테이블·권한·RLS·RPC와 원본 삭제 의미 확정
--
-- 완료한 일정·위시에서 만든 사진 추억을 **선택적으로** 원본과 연결한다(DESIGN 1·5.2·5.3·6·7).
-- 이미 적용된 마이그레이션은 바꾸지 않고 이 파일만 추가한다.
-- 예외: `public.delete_calendar_event`와 `public.delete_wish`는 아래 1.8·1.9에서 **본문만** 교체한다
--   (시그니처·반환·기존 오류 계약 그대로). 두 원본에 자식 행(연결)이 생기므로 삭제 의미를
--   DATE-001에서 확정해야 한다(CAL-001 인수인계 "후속 DATE-001 계약").
--
-- 계약 요약
--   * `memory_links.memory_id`가 PK다. 한 추억에는 **연결 행이 최대 하나**다(DESIGN 5.2).
--   * 한 행은 **정확히 하나의 원본**을 가리킨다(`source`가 'event'면 calendar_event_id만,
--     'wish'면 wish_item_id만). 아래 "설계 결정 1" 참고.
--   * 하나의 원본에 **여러 추억**을 연결할 수 있다. 원본 ID에 UNIQUE를 두지 않는다.
--   * 같은 공간만 연결한다. 세 관계 모두 `(id, space_id)` 복합 FK다.
--   * 연결 대상은 **완료(done)** 상태여야 한다. RPC가 저장 직전에 다시 확인한다.
--   * 상대방 개인 일정도 **연결할 수 있다**(조회 권한과 같다). 다만 일정 행의 소유자·상태·내용은
--     이 작업의 어떤 함수도 바꾸지 않는다(원본은 `FOR KEY SHARE`로만 잡는다).
--   * 테이블 직접 쓰기는 금지다. 변경은 아래 SECURITY DEFINER RPC로만 한다.
--   * 동시성은 **추억의 version**으로 본다. 연결 변경은 `memories.version`을 1 올린다.
--     그래서 연결 전 스냅샷으로 저장·고정·삭제를 시도하면 CONFLICT가 된다(DESIGN 8.4).
--   * 멱등성은 다른 변경 RPC와 같은 `mutation_requests` 기반이다(요청 ID 필수).
--
-- 설계 결정 (DESIGN·CAL/WISH 계약에 명시가 없어 이 작업에서 정한 것)
--   1. **한 행에 원본 하나.** DESIGN 5.2는 "둘 중 하나 이상"이지만, 일정에 위시가 연결돼 있다고 해서
--      추억을 그 위시에도 **조용히** 함께 연결하면 사용자가 하지 않은 연결이 생긴다. 두 ID를 동시에
--      허용하면 "일정은 done인데 위시는 planned" 같은 불일치도 검사해야 한다. MVP는 사용자가 고른
--      원본 하나만 저장한다. 나중에 확장하려면 CHECK를 완화하고 상태 일치 검사를 더하면 된다.
--   2. **연결된 추억이 있는 원본은 삭제를 거부한다**(`GF409 {"eventId":"has_memories"}` /
--      `{"wishId":"has_memories"}`). CAL-001이 위시에 대해 고른 방향(거부)과 같다. 연쇄 삭제는
--      사용자가 모르는 사이에 사진·글을 지우고, 자동 연결 해제는 관계를 조용히 끊는다.
--   3. **추억을 지우면 연결 행만 함께 사라지고 원본 일정·위시는 남는다**(DESIGN 5.3).
--      `(memory_id, space_id) → memories(id, space_id) on delete cascade`가 그 역할을 한다.
--      `delete_memory`는 바꾸지 않는다(추억 행을 지우면 FK가 연결을 정리한다).
--   4. **원본 쪽 복합 FK는 `on delete no action`이다**(`restrict` 아님). 공간 삭제는 추억·일정·위시·
--      연결을 함께 cascade로 지우는데, `restrict`는 즉시 검사해서 공간 정리 자체를 실패시킨다.
--      사용자 경로는 삭제 RPC가 먼저 막고 FK는 마지막 방어선이다(CAL-001 설계 결정 6과 같은 기준).
--   5. **연결 해제는 별도 RPC**다. 저장·고정처럼 연결을 보내지 않은 요청이 연결을 지우지 않는다.

begin;

-- ---------------------------------------------------------------------------
-- 1.1 테이블
-- ---------------------------------------------------------------------------
create table if not exists public.memory_links (
  -- 추억당 최대 한 행(DESIGN 5.2). PK가 곧 그 제약이다.
  memory_id         uuid primary key,
  space_id          uuid not null references public.spaces (id) on delete cascade,
  -- 이 행이 가리키는 원본의 종류. 열 하나로 "무엇을 연결했는지"가 명확해진다.
  source            text not null,
  calendar_event_id uuid,
  wish_item_id      uuid,
  -- 마지막으로 연결을 바꾼 사람. 공유 기록이므로 두 구성원 모두 바꿀 수 있다.
  linked_by         uuid not null references public.profiles (id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint memory_links_source_allowed check (source in ('event', 'wish')),
  -- 설계 결정 1: 정확히 하나. "둘 중 하나 이상"(DESIGN 5.2)을 만족하는 더 좁은 규칙이다.
  constraint memory_links_exactly_one_source check (
    (source = 'event' and calendar_event_id is not null and wish_item_id is null)
    or (source = 'wish' and wish_item_id is not null and calendar_event_id is null)),

  -- 같은 공간의 추억만. 추억이 사라지면 연결도 함께 사라진다(설계 결정 3).
  constraint memory_links_memory_same_space
    foreign key (memory_id, space_id)
    references public.memories (id, space_id)
    on update cascade on delete cascade,
  -- 같은 공간의 일정만. null이면 검사하지 않는다(MATCH SIMPLE).
  constraint memory_links_event_same_space
    foreign key (calendar_event_id, space_id)
    references public.calendar_events (id, space_id)
    on update cascade on delete no action,
  -- 같은 공간의 위시만.
  constraint memory_links_wish_same_space
    foreign key (wish_item_id, space_id)
    references public.wish_items (id, space_id)
    on update cascade on delete no action
);

comment on table public.memory_links is
  'DATE-001: 완료한 일정·위시와 사진 추억의 선택적 연결. 추억당 한 행, 원본 하나. 변경은 전용 RPC로만 한다.';
comment on column public.memory_links.source is
  '이 행이 가리키는 원본 종류(event|wish). 해당하는 ID 열만 채운다.';
comment on column public.memory_links.linked_by is
  '마지막으로 연결을 만들거나 바꾼 구성원. 추억의 작성자와 다를 수 있다.';

-- 원본 삭제 검사와 역방향 조회("이 일정으로 남긴 기록")가 전체 스캔하지 않도록 둔다.
create index if not exists memory_links_event_idx
  on public.memory_links (calendar_event_id)
  where calendar_event_id is not null;
create index if not exists memory_links_wish_idx
  on public.memory_links (wish_item_id)
  where wish_item_id is not null;

-- ---------------------------------------------------------------------------
-- 1.2 트리거 — DB-001의 공통 트리거 함수를 재사용한다
-- ---------------------------------------------------------------------------
drop trigger if exists memory_links_touch on public.memory_links;
create trigger memory_links_touch
  before update on public.memory_links
  for each row execute function app_private.tg_touch_updated_at();

-- 어느 추억의 연결인지, 어느 공간인지는 바꿀 수 없다. 원본 교체는 ID 열만 바꾼다.
drop trigger if exists memory_links_immutable on public.memory_links;
create trigger memory_links_immutable
  before update on public.memory_links
  for each row execute function app_private.tg_immutable_columns(
    'memory_id', 'space_id', 'created_at');

-- 연결 대상은 완료 상태여야 한다. RPC가 먼저 검사하지만 직접 DML 경로에도 남긴다.
create or replace function app_private.tg_memory_link_done_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.calendar_event_id is not null then
    select e.status into v_status
      from public.calendar_events e
     where e.id = new.calendar_event_id;
    if not found then
      perform app_private.raise_error('NOT_FOUND', '{"eventId":"missing"}');
    end if;
    if v_status is distinct from 'done' then
      perform app_private.raise_error('CONFLICT', '{"eventId":"not_done"}');
    end if;
  end if;

  if new.wish_item_id is not null then
    select w.status into v_status
      from public.wish_items w
     where w.id = new.wish_item_id;
    if not found then
      perform app_private.raise_error('NOT_FOUND', '{"wishId":"missing"}');
    end if;
    if v_status is distinct from 'done' then
      perform app_private.raise_error('CONFLICT', '{"wishId":"not_done"}');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists memory_links_done_source on public.memory_links;
create trigger memory_links_done_source
  before insert or update on public.memory_links
  for each row execute function app_private.tg_memory_link_done_source();

-- ---------------------------------------------------------------------------
-- 1.3 권한과 RLS
-- ---------------------------------------------------------------------------
revoke all on table public.memory_links from public, anon, authenticated, service_role;

grant select on table public.memory_links to authenticated, service_role;

alter table public.memory_links enable row level security;

-- 조회는 자기 공간의 연결만. 쓰기 정책은 만들지 않는다(권한과 정책 양쪽에서 막힌다).
drop policy if exists memory_links_select_member on public.memory_links;
create policy memory_links_select_member on public.memory_links
  for select to authenticated
  using (space_id = app.current_space_id());

-- ---------------------------------------------------------------------------
-- 1.4 내부 헬퍼 — 원본을 잠그고 완료 상태를 확인한다
-- ---------------------------------------------------------------------------
-- 원본 행은 `FOR KEY SHARE`로만 잡는다. 내용·상태·소유자를 **바꾸지 않는다**.
-- 이 잠금은 FK가 잡는 것과 같은 종류라, 원본 삭제(`FOR UPDATE`)와 직렬화된다.
--
-- 잠금 순서는 항상 **추억 → 원본**이다(link/unlink 모두). 삭제 RPC는 원본만 잡고 연결을 세므로
-- 두 경로가 서로를 기다리는 고리가 생기지 않는다.
create or replace function app_private.memory_link_lock_source(
  p_space uuid, p_source text, p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_source_id is null then
    perform app_private.raise_error('VALIDATION_ERROR', '{"sourceId":"required"}');
  end if;

  if p_source = 'event' then
    select e.status into v_status
      from public.calendar_events e
     where e.id = p_source_id and e.space_id = p_space
       for key share;
    if not found then
      -- 다른 공간의 일정도 존재 여부를 알리지 않는다.
      perform app_private.raise_error('NOT_FOUND', '{"eventId":"missing"}');
    end if;
    if v_status <> 'done' then
      -- 재시도해도 같은 결과다. 앱이 "완료 처리를 먼저 해 주세요"를 안내할 수 있어야 한다.
      perform app_private.raise_error('CONFLICT', '{"eventId":"not_done"}');
    end if;
  elsif p_source = 'wish' then
    select w.status into v_status
      from public.wish_items w
     where w.id = p_source_id and w.space_id = p_space
       for key share;
    if not found then
      perform app_private.raise_error('NOT_FOUND', '{"wishId":"missing"}');
    end if;
    if v_status <> 'done' then
      perform app_private.raise_error('CONFLICT', '{"wishId":"not_done"}');
    end if;
  else
    perform app_private.raise_error('VALIDATION_ERROR', '{"source":"allowed"}');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.5 linkMemoryPlan — 추억을 완료한 일정·위시와 연결한다
-- ---------------------------------------------------------------------------
-- DESIGN 7의 `linkMemoryPlan`. 이 함수는 **연결만** 다룬다. 본문·사진 저장은 기존 `save_memory`가 한다.
create or replace function public.link_memory_plan(
  p_memory_id        uuid,
  p_source           text,
  p_source_id        uuid,
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
  v_source   text;
  v_existing public.memory_links%rowtype;
  v_had_link boolean := false;
  v_replaced boolean := false;
  v_changed  boolean := true;
  v_version  integer;
  v_result   jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'linkMemoryPlan',
    jsonb_build_object(
      'memoryId', p_memory_id,
      'source', p_source,
      'sourceId', p_source_id,
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  v_source := btrim(lower(coalesce(p_source, '')));
  if v_source not in ('event', 'wish') then
    perform app_private.raise_error('VALIDATION_ERROR', '{"source":"allowed"}');
  end if;
  if p_source_id is null then
    perform app_private.raise_error('VALIDATION_ERROR', '{"sourceId":"required"}');
  end if;

  -- 잠금 1: 추억. 같은 추억의 저장·고정·삭제·연결 변경을 직렬화한다.
  select * into v_memory
    from public.memories m
   where m.id = p_memory_id and m.space_id = v_space
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"memoryId":"missing"}');
  end if;
  if p_expected_version is null or v_memory.version <> p_expected_version then
    -- 연결 화면을 연 뒤 상대가 기록을 바꿨으면 아무것도 연결하지 않는다.
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  -- 잠금 2: 원본. 완료 상태 확인까지 여기서 한다(원본을 바꾸지 않는다).
  perform app_private.memory_link_lock_source(v_space, v_source, p_source_id);

  select * into v_existing from public.memory_links l where l.memory_id = v_memory.id;
  if found then
    v_had_link := true;
    -- 같은 원본을 다시 연결하는 것은 아무것도 바꾸지 않는다(버전도 올리지 않는다).
    v_changed := v_existing.source is distinct from v_source
      or coalesce(v_existing.calendar_event_id, v_existing.wish_item_id) is distinct from p_source_id;
    v_replaced := v_changed;
  end if;

  if v_changed then
    begin
      insert into public.memory_links (
        memory_id, space_id, source, calendar_event_id, wish_item_id, linked_by)
      values (
        v_memory.id, v_space, v_source,
        case when v_source = 'event' then p_source_id end,
        case when v_source = 'wish'  then p_source_id end,
        v_user)
      on conflict (memory_id) do update
        set source            = excluded.source,
            calendar_event_id = excluded.calendar_event_id,
            wish_item_id      = excluded.wish_item_id,
            linked_by         = excluded.linked_by;
    exception when foreign_key_violation then
      -- 잠금 사이에 원본이 사라진 경우. 재시도해도 같은 결과이므로 확정 실패로 알린다.
      if v_source = 'event' then
        perform app_private.raise_error('CONFLICT', '{"eventId":"gone"}');
      else
        perform app_private.raise_error('CONFLICT', '{"wishId":"gone"}');
      end if;
    end;

    -- 연결이 실제로 바뀌면 추억의 version을 올린다. 연결 전 스냅샷으로 하는 저장·고정·삭제는
    -- 이 증가 때문에 CONFLICT가 된다(조용한 덮어쓰기 방지).
    update public.memories m
       set version = m.version + 1
     where m.id = v_memory.id
    returning m.version into v_version;
  else
    v_version := v_memory.version;
  end if;

  v_result := jsonb_build_object(
    'memoryId', v_memory.id,
    'version', v_version,
    'source', v_source,
    'sourceId', p_source_id,
    'eventId', case when v_source = 'event' then p_source_id end,
    'wishId',  case when v_source = 'wish'  then p_source_id end,
    'replacedPreviousLink', v_replaced,
    'alreadyLinked', v_had_link and not v_changed);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

comment on function public.link_memory_plan(uuid, text, uuid, integer, uuid) is
  'DATE-001 linkMemoryPlan. 완료한 일정·위시를 추억에 연결한다. 원본 행은 읽기 잠금만 하고 바꾸지 않는다.';

-- ---------------------------------------------------------------------------
-- 1.6 unlinkMemoryPlan — 명시적인 연결 해제
-- ---------------------------------------------------------------------------
-- 저장·고정처럼 "연결을 보내지 않은" 요청은 연결을 지우지 않는다(설계 결정 5).
-- 해제는 사용자가 이 함수를 직접 부를 때만 일어난다.
create or replace function public.unlink_memory_plan(
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
  v_user     uuid;
  v_space    uuid;
  v_req      record;
  v_memory   public.memories%rowtype;
  v_existing public.memory_links%rowtype;
  v_version  integer;
  v_result   jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'unlinkMemoryPlan',
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

  select * into v_existing from public.memory_links l where l.memory_id = v_memory.id;
  if not found then
    -- 이미 연결이 없다. 무엇을 해제했는지 모른 채 성공이라고 말하지 않는다.
    perform app_private.raise_error('NOT_FOUND', '{"memoryLink":"missing"}');
  end if;

  delete from public.memory_links l where l.memory_id = v_memory.id;

  update public.memories m
     set version = m.version + 1
   where m.id = v_memory.id
  returning m.version into v_version;

  v_result := jsonb_build_object(
    'memoryId', v_memory.id,
    'version', v_version,
    'source', v_existing.source,
    'sourceId', coalesce(v_existing.calendar_event_id, v_existing.wish_item_id));
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.7 실행 권한
-- ---------------------------------------------------------------------------
revoke all on function app_private.memory_link_lock_source(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.tg_memory_link_done_source()
  from public, anon, authenticated, service_role;

revoke all on function public.link_memory_plan(uuid, text, uuid, integer, uuid) from public, anon;
revoke all on function public.unlink_memory_plan(uuid, integer, uuid)           from public, anon;

grant execute on function public.link_memory_plan(uuid, text, uuid, integer, uuid) to authenticated;
grant execute on function public.unlink_memory_plan(uuid, integer, uuid)           to authenticated;

-- ---------------------------------------------------------------------------
-- 1.8 일정 삭제 의미 확정 — 연결된 추억이 있으면 거부한다
-- ---------------------------------------------------------------------------
-- CAL-001의 `delete_calendar_event`는 "자식 행이 없다"는 전제 위에 있었다(CAL 인수인계 "주의").
-- 이제 연결이 일정을 참조하므로 무엇을 할지 정해야 한다. 설계 결정 2대로 **거부**한다.
-- 시그니처·반환·기존 오류(GF401/GF403/GF404/GF409)는 그대로다. 거부 조건 하나가 늘어난다.
--
-- 일정 행을 `FOR UPDATE`로 잠근 뒤 연결을 센다. 연결 삽입은 FK가 일정 행에 `FOR KEY SHARE`를
-- 잡으므로 이 잠금과 직렬화된다. 검사 뒤 새 연결이 끼어들 틈이 없다.
-- 23503(FK 위반)에 기대지 않는다. FK는 마지막 방어선이고, 사용자에게 보이는 결정은 이 검사다.
create or replace function public.delete_calendar_event(
  p_event_id         uuid,
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
  v_event   public.calendar_events%rowtype;
  v_linked  integer;
  v_result  jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'deleteCalendarEvent',
    jsonb_build_object('eventId', p_event_id, 'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  select * into v_event
    from public.calendar_events e
   where e.id = p_event_id and e.space_id = v_space
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"eventId":"missing"}');
  end if;
  if not app_private.calendar_can_write(v_event.owner_id, v_user) then
    perform app_private.raise_error('FORBIDDEN', '{"ownerId":"not_owner"}');
  end if;
  if p_expected_version is null or v_event.version <> p_expected_version then
    -- 확인 창을 연 뒤 상대가 무엇이든 바꿨으면 아무것도 지우지 않는다.
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  -- DATE-001: 연결된 추억이 있으면 지우지 않는다. 추억·사진을 조용히 잃지 않게 한다.
  select count(*) into v_linked
    from public.memory_links l
   where l.calendar_event_id = v_event.id and l.space_id = v_space;
  if v_linked > 0 then
    perform app_private.raise_error('CONFLICT', '{"eventId":"has_memories"}');
  end if;

  delete from public.calendar_events e where e.id = v_event.id;

  v_result := jsonb_build_object('eventId', v_event.id);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.9 위시 삭제 — 기존 거부 조건에 "연결된 추억"을 더한다
-- ---------------------------------------------------------------------------
-- CAL-001이 정한 `has_calendar_events` 거부는 **그대로 둔다**(검사 순서도 그대로).
-- 그 뒤에 DATE-001의 `has_memories`를 더한다. 반환·시그니처·권한은 바뀌지 않는다.
create or replace function public.delete_wish(
  p_wish_id          uuid,
  p_expected_version integer,
  p_request_id       uuid
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
  v_wish   public.wish_items%rowtype;
  v_linked integer;
  v_result jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'deleteWish',
    jsonb_build_object('wishId', p_wish_id, 'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  select * into v_wish
    from public.wish_items w
   where w.id = p_wish_id and w.space_id = v_space
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"wishId":"missing"}');
  end if;
  if p_expected_version is null or v_wish.version <> p_expected_version then
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  -- CAL-001: 연결된 일정이 있으면 거부한다(먼저 검사한다. 기존 안내를 유지한다).
  select count(*) into v_linked
    from public.calendar_events e
   where e.wish_item_id = v_wish.id and e.space_id = v_space;
  if v_linked > 0 then
    perform app_private.raise_error('CONFLICT', '{"wishId":"has_calendar_events"}');
  end if;

  -- DATE-001: 연결된 추억이 있으면 거부한다.
  select count(*) into v_linked
    from public.memory_links l
   where l.wish_item_id = v_wish.id and l.space_id = v_space;
  if v_linked > 0 then
    perform app_private.raise_error('CONFLICT', '{"wishId":"has_memories"}');
  end if;

  delete from public.wish_items w where w.id = v_wish.id;

  v_result := jsonb_build_object('wishId', v_wish.id);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- 본문만 교체했으므로 권한은 유지된다. 그래도 명시적으로 다시 확인한다.
revoke all on function public.delete_calendar_event(uuid, integer, uuid) from public, anon;
revoke all on function public.delete_wish(uuid, integer, uuid)           from public, anon;
grant execute on function public.delete_calendar_event(uuid, integer, uuid) to authenticated;
grant execute on function public.delete_wish(uuid, integer, uuid)           to authenticated;

-- ---------------------------------------------------------------------------
-- 1.10 적용 직후 자체 점검 — 위반이 있으면 마이그레이션을 실패시킨다
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- (1) 로그인 사용자 RPC는 실행할 수 있어야 한다.
  if not has_function_privilege('authenticated',
       'public.link_memory_plan(uuid,text,uuid,integer,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.unlink_memory_plan(uuid,integer,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.delete_calendar_event(uuid,integer,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.delete_wish(uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'DATE-001 권한 점검 실패: 연결 RPC 실행 권한 없음';
  end if;

  -- (2) anon에는 어떤 변경 RPC도 없어야 한다.
  if has_function_privilege('anon', 'public.link_memory_plan(uuid,text,uuid,integer,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.unlink_memory_plan(uuid,integer,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_calendar_event(uuid,integer,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_wish(uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'DATE-001 권한 점검 실패: anon이 변경 RPC를 실행할 수 있다';
  end if;

  -- (3) 내부 헬퍼는 클라이언트 역할에 노출되면 안 된다.
  if has_function_privilege('anon', 'app_private.memory_link_lock_source(uuid,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
          'app_private.memory_link_lock_source(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'DATE-001 권한 점검 실패: app_private 헬퍼가 노출됐다';
  end if;

  -- (4) 클라이언트·서비스 역할에 직접 쓰기 권한이 남아 있으면 안 된다.
  --     소유자(postgres)는 마이그레이션·복구 경로이므로 제외한다(DB-001 11.4와 같은 기준).
  select string_agg(format('%s:%s', g.grantee, g.privilege_type), ', ')
    into v_bad
    from information_schema.role_table_grants g
   where g.table_schema = 'public'
     and g.table_name = 'memory_links'
     and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if v_bad is not null then
    raise exception 'DATE-001 권한 점검 실패: memory_links 직접 쓰기 권한이 남아 있다 (%)', v_bad;
  end if;

  -- (5) RLS가 켜져 있어야 한다.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'memory_links' and c.relrowsecurity) then
    raise exception 'DATE-001 권한 점검 실패: memory_links에 RLS가 꺼져 있다';
  end if;

  -- (6) 새 SECURITY DEFINER 함수에 고정 search_path가 있어야 한다.
  --     교체한 기존 함수(delete_calendar_event·delete_wish)도 함께 확인한다.
  select string_agg(p.proname, ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where ((n.nspname = 'public'
           and p.proname in ('link_memory_plan', 'unlink_memory_plan',
                             'delete_calendar_event', 'delete_wish'))
       or (n.nspname = 'app_private'
           and p.proname in ('memory_link_lock_source', 'tg_memory_link_done_source')))
     and p.prosecdef
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) as c(v) where c.v like 'search\_path=%'));
  if v_bad is not null then
    raise exception 'DATE-001 권한 점검 실패: search_path 미고정 함수 (%)', v_bad;
  end if;

  -- (7) 세 관계 모두 같은 공간만 허용하는 복합 FK여야 한다.
  --     단일 열 FK로 바뀌면 다른 공간의 일정·위시를 연결할 수 있게 된다.
  select string_agg(want.conname, ', ')
    into v_bad
    from (values
      ('memory_links_memory_same_space', 'public.memories'),
      ('memory_links_event_same_space',  'public.calendar_events'),
      ('memory_links_wish_same_space',   'public.wish_items')
    ) as want(conname, target)
   where not exists (
     select 1 from pg_constraint c
      where c.conrelid = 'public.memory_links'::regclass
        and c.conname = want.conname
        and c.contype = 'f'
        and c.confrelid = want.target::regclass
        and array_length(c.conkey, 1) = 2);
  if v_bad is not null then
    raise exception 'DATE-001 점검 실패: 복합 FK(id, space_id)가 없다 (%)', v_bad;
  end if;

  -- (8) 추억 삭제는 연결만 지우고, 원본 삭제는 FK가 막아야 한다(설계 결정 2·3).
  if (select c.confdeltype from pg_constraint c
       where c.conrelid = 'public.memory_links'::regclass
         and c.conname = 'memory_links_memory_same_space') <> 'c' then
    raise exception 'DATE-001 점검 실패: 추억 FK가 cascade가 아니다';
  end if;
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.memory_links'::regclass
       and c.conname in ('memory_links_event_same_space', 'memory_links_wish_same_space')
       and c.confdeltype <> 'a') then
    raise exception 'DATE-001 점검 실패: 원본 FK가 no action이 아니다';
  end if;

  -- (9) 원본 ID에 UNIQUE를 두지 않는다(한 원본에 여러 추억을 연결할 수 있어야 한다).
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.memory_links'::regclass
       and c.contype = 'u'
       and c.conkey::int[] && array[
         (select a.attnum from pg_attribute a
           where a.attrelid = 'public.memory_links'::regclass and a.attname = 'calendar_event_id'),
         (select a.attnum from pg_attribute a
           where a.attrelid = 'public.memory_links'::regclass and a.attname = 'wish_item_id')
       ]::int[]) then
    raise exception 'DATE-001 점검 실패: 원본 ID에 UNIQUE 제약이 있다(한 원본에 추억 하나로 제한됨)';
  end if;
end;
$$;

commit;
