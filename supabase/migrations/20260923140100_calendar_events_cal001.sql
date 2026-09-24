-- CAL-001 / 1. 커플 캘린더(calendar_events) 테이블·권한·RLS·RPC와 위시 삭제 의미 확정
--
-- 개인 일정과 공동 데이트 일정을 한 테이블에 담는다(DESIGN 1·5.2·5.3·6·7).
-- 이미 적용된 마이그레이션은 바꾸지 않고 이 파일만 추가한다.
-- 예외: `public.delete_wish`는 아래 1.9에서 **본문만** 교체한다(시그니처·권한 그대로).
--   위시에 자식 행(일정)이 생기므로 삭제 의미를 CAL-001에서 확정해야 한다(WISH-001 인수인계 잔여 위험 8).
--
-- 계약 요약
--   * kind personal/date. personal은 owner_id가 있고 date는 owner_id가 null이다(DESIGN 5.2).
--   * 두 구성원 모두 **모든** 일정을 조회한다. 개인 일정은 소유자만, 공동 일정은 둘 다 변경한다(DESIGN 6).
--   * 상태 scheduled/done/cancelled. 새 일정은 항상 scheduled다(save_restaurant·save_wish와 같은 분리).
--   * 시각은 서버가 **한국 시간(Asia/Seoul) 달력 날짜+시각**으로 조립한다. 클라이언트가 timestamptz를
--     직접 보내지 않는다. 브라우저 시간대가 달라도 같은 날짜로 저장된다(DESIGN 1의 표시 기준).
--   * 종일 일정은 시작·종료가 KST 자정에 정렬되고 종료일이 **포함**된다(하루 일정은 시작=종료).
--   * 위시 연결은 선택이며 `(wish_item_id, space_id)` 복합 FK로 **같은 공간의 위시만** 허용한다.
--   * 테이블 직접 쓰기는 금지다. 변경은 아래 SECURITY DEFINER RPC로만 한다.
--   * 모든 변경 RPC는 expectedVersion(충돌)과 requestId(중복 요청)를 함께 쓴다(DESIGN 8.4).
--
-- 설계 결정(DESIGN에 명시가 없어 이 작업에서 정한 것)
--   * `location`(장소) 열을 추가한다. DESIGN 5.2의 열 목록에는 없지만 CAL-001 지시가 장소를 요구한다.
--     추억의 장소와 같은 100자 상한을 쓴다.
--   * `kind`와 `owner_id`는 생성 후 바꿀 수 없다. 개인↔공동 전환은 권한 주체가 바뀌는 일이라
--     MVP에서는 새로 만들게 한다(조용한 권한 이전을 만들지 않는다).
--   * 개인 일정의 owner는 항상 **만든 사람**이다. 상대방을 소유자로 지정하는 입력을 받지 않는다.
--   * 연결된 일정이 있는 위시는 삭제하지 않고 CONFLICT로 거부한다(1.9). 자동 연결 해제·연쇄 삭제는
--     사용자가 모르는 사이에 계획을 지우므로 MVP에서 하지 않는다.
--   * 복합 FK는 `no action`이다(`restrict` 아님). 공간 삭제는 위시와 일정을 함께 cascade로 지우므로,
--     문장 끝에 검사하는 `no action`이어야 공간 정리가 실패하지 않는다. 사용자 경로의 위시 삭제는
--     `delete_wish`가 먼저 막고, FK는 마지막 방어선으로 남는다.

begin;

-- ---------------------------------------------------------------------------
-- 1.1 테이블
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_events (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces (id) on delete cascade,
  created_by   uuid not null references public.profiles (id) on delete restrict,
  -- null이면 공동 데이트 일정이다(DESIGN 5.2).
  owner_id     uuid references public.profiles (id) on delete restrict,
  kind         text not null,
  title        text not null,
  location     text,
  note         text not null default '',
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  all_day      boolean not null default false,
  status       text not null default 'scheduled',
  wish_item_id uuid,
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- DATE-001의 memory_links가 `(calendar_event_id, space_id)` 복합 FK로 쓸 수 있도록 미리 둔다.
  constraint calendar_events_id_space_key    unique (id, space_id),
  constraint calendar_events_kind_allowed    check (kind in ('personal', 'date')),
  constraint calendar_events_status_allowed  check (status in ('scheduled', 'done', 'cancelled')),
  -- 개인 일정에는 소유자가 있고, 공동 일정에는 없다. 한쪽만 바뀌는 상태를 만들 수 없다.
  constraint calendar_events_owner_shape     check ((kind = 'personal') = (owner_id is not null)),
  constraint calendar_events_title_trimmed   check (title = btrim(title)),
  constraint calendar_events_title_length    check (char_length(title) between 1 and 100),
  constraint calendar_events_location_length check (location is null or char_length(location) between 1 and 100),
  constraint calendar_events_note_length     check (char_length(note) <= 2000),
  -- 종료는 시작 이후다(DESIGN 5.2). 종일 일정은 같은 날(시작=종료)을 허용한다.
  constraint calendar_events_range           check (ends_at is null or ends_at >= starts_at),
  -- 종일 일정은 종료일이 반드시 있다(포함 종료일). 시간 일정은 종료가 선택이며 시작보다 뒤여야 한다.
  constraint calendar_events_all_day_end     check (not all_day or ends_at is not null),
  constraint calendar_events_timed_end       check (all_day or ends_at is null or ends_at > starts_at),
  constraint calendar_events_version_positive check (version >= 1),
  -- 같은 공간의 위시만 연결한다. wish_item_id가 null이면 검사하지 않는다(MATCH SIMPLE).
  constraint calendar_events_wish_same_space
    foreign key (wish_item_id, space_id)
    references public.wish_items (id, space_id)
    on update cascade on delete no action
);

comment on table public.calendar_events is
  'CAL-001: 개인 일정(owner_id 있음)과 공동 데이트 일정(owner_id null). 조회는 두 구성원 모두, 변경은 소유 규칙에 따른다. 변경은 전용 RPC로만 한다.';
comment on column public.calendar_events.starts_at is
  '한국 시간 기준 날짜+시각을 서버가 조립한 값. 종일 일정은 KST 자정이다.';
comment on column public.calendar_events.ends_at is
  '종일 일정은 **포함** 종료일의 KST 자정. 시간 일정은 선택이며 시작보다 뒤다.';

-- TECH_STACK 4절의 조회 인덱스. 월·목록 보기는 기간이 겹치는 일정을 시작 시각 순으로 읽는다.
create index if not exists calendar_events_range_idx
  on public.calendar_events (space_id, starts_at, id);
-- 위시 삭제 검사와 복합 FK 확인이 전체 스캔하지 않도록 둔다.
create index if not exists calendar_events_wish_idx
  on public.calendar_events (wish_item_id)
  where wish_item_id is not null;

-- ---------------------------------------------------------------------------
-- 1.2 트리거
-- ---------------------------------------------------------------------------
drop trigger if exists calendar_events_touch on public.calendar_events;
create trigger calendar_events_touch
  before update on public.calendar_events
  for each row execute function app_private.tg_touch_updated_at();

-- kind·owner_id도 불변이다. 개인↔공동 전환은 권한 주체가 바뀌므로 허용하지 않는다.
drop trigger if exists calendar_events_immutable on public.calendar_events;
create trigger calendar_events_immutable
  before update on public.calendar_events
  for each row execute function app_private.tg_immutable_columns(
    'id', 'space_id', 'created_by', 'created_at', 'kind', 'owner_id');

drop trigger if exists calendar_events_version on public.calendar_events;
create trigger calendar_events_version
  before update on public.calendar_events
  for each row execute function app_private.tg_version_step();

-- 시작·종료 시각에는 tg_no_future_date를 달지 않는다. 앞으로의 일정이 정상이다.

-- 종일 일정의 자정 정렬은 CHECK로 쓸 수 없다(`at time zone`은 IMMUTABLE이 아니다).
-- 트리거에서는 STABLE 함수를 쓸 수 있으므로 DB가 여기서 다시 검사한다.
create or replace function app_private.tg_calendar_time_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.all_day then
    if new.ends_at is null then
      perform app_private.raise_error('VALIDATION_ERROR', '{"endDate":"required_for_all_day"}');
    end if;
    if (new.starts_at at time zone 'Asia/Seoul')::time <> time '00:00:00' then
      perform app_private.raise_error('VALIDATION_ERROR', '{"startDate":"all_day_must_be_midnight"}');
    end if;
    if (new.ends_at at time zone 'Asia/Seoul')::time <> time '00:00:00' then
      perform app_private.raise_error('VALIDATION_ERROR', '{"endDate":"all_day_must_be_midnight"}');
    end if;
    if new.ends_at < new.starts_at then
      perform app_private.raise_error('VALIDATION_ERROR', '{"endDate":"before_start"}');
    end if;
  elsif new.ends_at is not null and new.ends_at <= new.starts_at then
    perform app_private.raise_error('VALIDATION_ERROR', '{"endTime":"not_after_start"}');
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_events_time_guard on public.calendar_events;
create trigger calendar_events_time_guard
  before insert or update on public.calendar_events
  for each row execute function app_private.tg_calendar_time_guard();

-- 개인 일정의 소유자는 반드시 그 공간의 구성원이다. RPC도 검사하지만 DB에도 남긴다.
create or replace function app_private.tg_calendar_owner_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null
     and not exists (
       select 1 from public.space_members m
        where m.space_id = new.space_id and m.user_id = new.owner_id) then
    perform app_private.raise_error('VALIDATION_ERROR', '{"ownerId":"not_member"}');
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_events_owner_member on public.calendar_events;
create trigger calendar_events_owner_member
  before insert or update on public.calendar_events
  for each row execute function app_private.tg_calendar_owner_member();

-- ---------------------------------------------------------------------------
-- 1.3 권한과 RLS
-- ---------------------------------------------------------------------------
revoke all on table public.calendar_events from public, anon, authenticated, service_role;

grant select on table public.calendar_events to authenticated, service_role;

alter table public.calendar_events enable row level security;

-- 조회는 자기 공간의 **모든** 일정(상대방 개인 일정 포함, DESIGN 6). 쓰기 정책은 만들지 않는다.
drop policy if exists calendar_events_select_member on public.calendar_events;
create policy calendar_events_select_member on public.calendar_events
  for select to authenticated
  using (space_id = app.current_space_id());

-- ---------------------------------------------------------------------------
-- 1.4 내부 헬퍼
-- ---------------------------------------------------------------------------
-- 한국 시간 벽시계(날짜+시각)를 timestamptz로 조립한다. 한국은 일광절약시간이 없다.
create or replace function app_private.kst_moment(p_date date, p_time time)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((p_date + coalesce(p_time, time '00:00:00')) at time zone 'Asia/Seoul');
$$;

-- 변경 권한: 공동 일정(owner null)은 두 구성원 모두, 개인 일정은 소유자만.
create or replace function app_private.calendar_can_write(p_owner uuid, p_user uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_owner is null or p_owner = p_user;
$$;

-- ---------------------------------------------------------------------------
-- 1.5 saveCalendarEvent — 생성과 수정(상태는 다루지 않는다)
-- ---------------------------------------------------------------------------
create or replace function public.save_calendar_event(
  p_event_id         uuid,
  p_kind             text,
  p_title            text,
  p_location         text,
  p_note             text,
  p_all_day          boolean,
  p_start_date       date,
  p_start_time       time,
  p_end_date         date,
  p_end_time         time,
  p_wish_item_id     uuid,
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
  v_event    public.calendar_events%rowtype;
  v_kind     text;
  v_title    text;
  v_location text;
  v_note     text;
  v_all_day  boolean;
  v_end_date date;
  v_starts   timestamptz;
  v_ends     timestamptz;
  v_owner    uuid;
  v_wish     uuid;
  v_result   jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'saveCalendarEvent',
    jsonb_build_object(
      'eventId', p_event_id,
      'kind', p_kind,
      'title', p_title,
      'location', p_location,
      'note', p_note,
      'allDay', p_all_day,
      'startDate', p_start_date,
      'startTime', p_start_time,
      'endDate', p_end_date,
      'endTime', p_end_time,
      'wishItemId', p_wish_item_id,
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  v_kind     := btrim(lower(coalesce(p_kind, '')));
  v_title    := btrim(coalesce(p_title, ''));
  v_location := nullif(btrim(coalesce(p_location, '')), '');
  v_note     := coalesce(p_note, '');
  v_all_day  := coalesce(p_all_day, false);

  if v_kind not in ('personal', 'date') then
    perform app_private.raise_error('VALIDATION_ERROR', '{"kind":"allowed"}');
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 100 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"title":"length"}');
  end if;
  if v_location is not null and char_length(v_location) > 100 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"location":"length"}');
  end if;
  if char_length(v_note) > 2000 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"note":"length"}');
  end if;

  -- 시각 조립. 클라이언트의 시간대 해석을 믿지 않고 서버가 KST로 만든다.
  if p_start_date is null then
    perform app_private.raise_error('VALIDATION_ERROR', '{"startDate":"required"}');
  end if;

  if v_all_day then
    if p_start_time is not null then
      perform app_private.raise_error('VALIDATION_ERROR', '{"startTime":"must_be_null_for_all_day"}');
    end if;
    if p_end_time is not null then
      perform app_private.raise_error('VALIDATION_ERROR', '{"endTime":"must_be_null_for_all_day"}');
    end if;
    v_end_date := coalesce(p_end_date, p_start_date);
    if v_end_date < p_start_date then
      perform app_private.raise_error('VALIDATION_ERROR', '{"endDate":"before_start"}');
    end if;
    v_starts := app_private.kst_moment(p_start_date, null);
    v_ends   := app_private.kst_moment(v_end_date, null);
  else
    if p_start_time is null then
      perform app_private.raise_error('VALIDATION_ERROR', '{"startTime":"required"}');
    end if;
    v_starts := app_private.kst_moment(p_start_date, p_start_time);
    if p_end_date is null and p_end_time is null then
      v_ends := null;
    else
      if p_end_time is null then
        -- 종료 날짜만 보내면 언제 끝나는지 알 수 없다. 조용히 자정으로 정하지 않는다.
        perform app_private.raise_error('VALIDATION_ERROR', '{"endTime":"required"}');
      end if;
      v_end_date := coalesce(p_end_date, p_start_date);
      v_ends := app_private.kst_moment(v_end_date, p_end_time);
      if v_ends <= v_starts then
        perform app_private.raise_error('VALIDATION_ERROR', '{"endTime":"not_after_start"}');
      end if;
    end if;
  end if;

  -- 위시 연결: 같은 공간의 위시만. 행을 FK와 같은 잠금으로 잡아 삭제와 직렬화한다.
  -- (잠금 절은 하위 질의에 쓸 수 없으므로 SELECT INTO로 잡는다.)
  if p_wish_item_id is not null then
    select w.id into v_wish
      from public.wish_items w
     where w.id = p_wish_item_id and w.space_id = v_space
       for key share;
    if not found then
      -- 다른 공간의 위시도 존재 여부를 알리지 않는다.
      perform app_private.raise_error('NOT_FOUND', '{"wishItemId":"missing"}');
    end if;
  end if;

  if p_event_id is null then
    if coalesce(p_expected_version, 0) <> 0 then
      perform app_private.raise_error('VALIDATION_ERROR', '{"expectedVersion":"must_be_zero_on_create"}');
    end if;
    -- 개인 일정의 소유자는 항상 만든 사람이다. 상대방을 소유자로 지정할 수 없다.
    v_owner := case when v_kind = 'personal' then v_user else null end;

    begin
      insert into public.calendar_events (
        space_id, created_by, owner_id, kind, title, location, note,
        starts_at, ends_at, all_day, wish_item_id)
      values (
        v_space, v_user, v_owner, v_kind, v_title, v_location, v_note,
        v_starts, v_ends, v_all_day, p_wish_item_id)
      returning * into v_event;
    exception when foreign_key_violation then
      -- 잠금 사이에 위시가 사라진 경우. 재시도해도 같은 결과이므로 확정 실패로 알린다.
      perform app_private.raise_error('CONFLICT', '{"wishItemId":"gone"}');
    end;
  else
    select * into v_event
      from public.calendar_events e
     where e.id = p_event_id and e.space_id = v_space
       for update;
    if not found then
      perform app_private.raise_error('NOT_FOUND', '{"eventId":"missing"}');
    end if;
    -- 상대방 개인 일정은 **보이지만** 바꿀 수 없다. 존재를 숨기지 않고 권한 없음으로 알린다.
    if not app_private.calendar_can_write(v_event.owner_id, v_user) then
      perform app_private.raise_error('FORBIDDEN', '{"ownerId":"not_owner"}');
    end if;
    if v_event.kind <> v_kind then
      perform app_private.raise_error('VALIDATION_ERROR', '{"kind":"immutable"}');
    end if;
    if p_expected_version is null or v_event.version <> p_expected_version then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end if;

    begin
      update public.calendar_events e
         set title        = v_title,
             location     = v_location,
             note         = v_note,
             starts_at    = v_starts,
             ends_at      = v_ends,
             all_day      = v_all_day,
             wish_item_id = p_wish_item_id,
             version      = e.version + 1
       where e.id = v_event.id
      returning * into v_event;
    exception when foreign_key_violation then
      perform app_private.raise_error('CONFLICT', '{"wishItemId":"gone"}');
    end;
  end if;

  v_result := jsonb_build_object(
    'eventId', v_event.id,
    'version', v_event.version,
    'kind', v_event.kind,
    'ownerId', v_event.owner_id,
    'status', v_event.status,
    'allDay', v_event.all_day,
    'startsAt', v_event.starts_at,
    'endsAt', v_event.ends_at,
    'wishItemId', v_event.wish_item_id);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.6 setCalendarEventStatus — 완료 체크·취소
-- ---------------------------------------------------------------------------
create or replace function public.set_calendar_event_status(
  p_event_id         uuid,
  p_status           text,
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
  v_event  public.calendar_events%rowtype;
  v_result jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'setCalendarEventStatus',
    jsonb_build_object(
      'eventId', p_event_id,
      'status', p_status,
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  if p_status is null or p_status not in ('scheduled', 'done', 'cancelled') then
    perform app_private.raise_error('VALIDATION_ERROR', '{"status":"allowed"}');
  end if;

  -- 행을 잠가 같은 일정의 다른 변경(내용 수정·삭제)과 직렬화한다.
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
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  update public.calendar_events e
     set status  = p_status,
         version = e.version + 1
   where e.id = v_event.id
  returning * into v_event;

  v_result := jsonb_build_object(
    'eventId', v_event.id,
    'version', v_event.version,
    'status', v_event.status);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.7 deleteCalendarEvent
-- ---------------------------------------------------------------------------
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
  v_user   uuid;
  v_space  uuid;
  v_req    record;
  v_event  public.calendar_events%rowtype;
  v_result jsonb;
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

  delete from public.calendar_events e where e.id = v_event.id;

  v_result := jsonb_build_object('eventId', v_event.id);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.8 실행 권한
-- ---------------------------------------------------------------------------
revoke all on function app_private.kst_moment(date, time)          from public, anon, authenticated, service_role;
revoke all on function app_private.calendar_can_write(uuid, uuid)   from public, anon, authenticated, service_role;
revoke all on function app_private.tg_calendar_time_guard()         from public, anon, authenticated, service_role;
revoke all on function app_private.tg_calendar_owner_member()       from public, anon, authenticated, service_role;

revoke all on function public.save_calendar_event(uuid, text, text, text, text, boolean, date, time, date, time, uuid, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.set_calendar_event_status(uuid, text, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_calendar_event(uuid, integer, uuid)
  from public, anon, authenticated;

grant execute on function public.save_calendar_event(uuid, text, text, text, text, boolean, date, time, date, time, uuid, integer, uuid) to authenticated;
grant execute on function public.set_calendar_event_status(uuid, text, integer, uuid)                                                   to authenticated;
grant execute on function public.delete_calendar_event(uuid, integer, uuid)                                                             to authenticated;

-- ---------------------------------------------------------------------------
-- 1.9 위시 삭제 의미 확정 — 연결된 일정이 있으면 거부한다
-- ---------------------------------------------------------------------------
-- WISH-001의 `delete_wish`는 "자식 행이 없다"는 전제 위에 있었다. 이제 일정이 위시를 참조하므로
-- 무엇을 할지 정해야 한다. 선택지는 ① 연쇄 삭제 ② 연결만 해제 ③ 거부였고, **거부**를 골랐다.
--   * 연쇄 삭제는 사용자가 위시를 지웠을 뿐인데 캘린더의 계획이 사라진다.
--   * 자동 연결 해제도 사용자가 모르는 사이에 일정과 위시의 관계를 끊는다.
--   * 거부는 무엇을 먼저 정리해야 하는지 화면에서 분명히 안내할 수 있다.
--
-- 시그니처를 그대로 두고 본문만 교체한다(기존 EXECUTE 권한 유지). 위시 행을 FOR UPDATE로 잠그므로
-- 새 일정 삽입(FK가 위시 행에 FOR KEY SHARE를 잡는다)과 직렬화되고, 검사 뒤 끼어들 틈이 없다.
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

  select count(*) into v_linked
    from public.calendar_events e
   where e.wish_item_id = v_wish.id and e.space_id = v_space;
  if v_linked > 0 then
    -- 확정적인 거부다. 같은 요청을 다시 보내도 결과가 같다는 것을 앱이 알 수 있어야 한다.
    perform app_private.raise_error('CONFLICT', '{"wishId":"has_calendar_events"}');
  end if;

  delete from public.wish_items w where w.id = v_wish.id;

  v_result := jsonb_build_object('wishId', v_wish.id);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

revoke all on function public.delete_wish(uuid, integer, uuid) from public, anon;
grant execute on function public.delete_wish(uuid, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1.10 적용 직후 자체 점검 — 위반이 있으면 마이그레이션을 실패시킨다
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- (1) 로그인 사용자 RPC는 실행할 수 있어야 한다.
  if not has_function_privilege('authenticated',
       'public.save_calendar_event(uuid,text,text,text,text,boolean,date,time,date,time,uuid,integer,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.set_calendar_event_status(uuid,text,integer,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.delete_calendar_event(uuid,integer,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.delete_wish(uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'CAL-001 권한 점검 실패: 캘린더 RPC 실행 권한 없음';
  end if;

  -- (2) anon에는 어떤 변경 RPC도 없어야 한다.
  if has_function_privilege('anon',
       'public.save_calendar_event(uuid,text,text,text,text,boolean,date,time,date,time,uuid,integer,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_calendar_event_status(uuid,text,integer,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_calendar_event(uuid,integer,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_wish(uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'CAL-001 권한 점검 실패: anon이 변경 RPC를 실행할 수 있다';
  end if;

  -- (3) 내부 헬퍼는 클라이언트 역할에 노출되면 안 된다.
  if has_function_privilege('anon', 'app_private.kst_moment(date,time)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.kst_moment(date,time)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.calendar_can_write(uuid,uuid)', 'EXECUTE') then
    raise exception 'CAL-001 권한 점검 실패: app_private 헬퍼가 노출됐다';
  end if;

  -- (4) 클라이언트·서비스 역할에 직접 쓰기 권한이 남아 있으면 안 된다.
  --     소유자(postgres)는 마이그레이션·복구 경로이므로 제외한다(DB-001 11.4와 같은 기준).
  select string_agg(format('%s:%s', g.grantee, g.privilege_type), ', ')
    into v_bad
    from information_schema.role_table_grants g
   where g.table_schema = 'public'
     and g.table_name = 'calendar_events'
     and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if v_bad is not null then
    raise exception 'CAL-001 권한 점검 실패: calendar_events 직접 쓰기 권한이 남아 있다 (%)', v_bad;
  end if;

  -- (5) RLS가 켜져 있어야 한다.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'calendar_events' and c.relrowsecurity) then
    raise exception 'CAL-001 권한 점검 실패: calendar_events에 RLS가 꺼져 있다';
  end if;

  -- (6) 새 SECURITY DEFINER 함수에 고정 search_path가 있어야 한다.
  select string_agg(p.proname, ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where ((n.nspname = 'public'
           and p.proname in ('save_calendar_event', 'set_calendar_event_status',
                             'delete_calendar_event', 'delete_wish'))
       or (n.nspname = 'app_private'
           and p.proname in ('tg_calendar_time_guard', 'tg_calendar_owner_member')))
     and p.prosecdef
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) as c(v) where c.v like 'search\_path=%'));
  if v_bad is not null then
    raise exception 'CAL-001 권한 점검 실패: search_path 미고정 함수 (%)', v_bad;
  end if;

  -- (7) 위시 연결은 같은 공간만 허용하는 복합 FK여야 한다(단일 열 FK로 바뀌면 공간 격리가 깨진다).
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.calendar_events'::regclass
       and c.conname = 'calendar_events_wish_same_space'
       and c.contype = 'f'
       and c.confrelid = 'public.wish_items'::regclass
       and array_length(c.conkey, 1) = 2) then
    raise exception 'CAL-001 점검 실패: wish_item_id 복합 FK(id, space_id)가 없다';
  end if;
end;
$$;

commit;
