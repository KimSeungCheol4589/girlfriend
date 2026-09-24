-- CAL-001 / 2. save_calendar_event의 외래 키 위반 처리를 위시 제약으로 좁힌다
--
-- 독립 검토 P3-4.
-- `20260923140100_calendar_events_cal001.sql`의 1.5는 INSERT/UPDATE를 감싼 핸들러에서
-- `foreign_key_violation`을 **모두** `CONFLICT {"wishItemId":"gone"}`으로 바꿨다.
-- 그러면 `space_id`·`created_by`·`owner_id`의 FK가 깨진 경우에도 "위시가 사라졌어요"라고 알린다.
-- 원인이 위시가 아닌데 위시를 고치라고 안내하는 셈이다.
--   (현재 MVP에는 공간·프로필 삭제 RPC가 없어 실제 도달 경로는 없다. 그래도 잘못된 안내를 만들 수 있는
--    코드를 남겨 두지 않는다. DATE-001·계정 삭제가 생기면 도달 경로가 늘어난다.)
--
-- 이 파일은 **위시 복합 FK(`calendar_events_wish_same_space`)일 때만** 그 안내를 쓰고,
-- 다른 FK 위반은 원래 예외를 그대로 다시 던진다. 앱의 공통 매핑이 `23503 → CONFLICT`이므로
-- 사용자에게는 "처리하지 못했다"는 확정 실패로 보이고, 잘못된 재시도 안내는 하지 않는다.
--
-- 이미 적용된 마이그레이션은 바꾸지 않고 이 파일만 추가한다(전진 마이그레이션).
-- 시그니처가 같아 `create or replace`가 기존 EXECUTE 권한을 유지한다. 그래도 끝에서 다시 확인한다.

begin;

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
  v_user       uuid;
  v_space      uuid;
  v_req        record;
  v_event      public.calendar_events%rowtype;
  v_kind       text;
  v_title      text;
  v_location   text;
  v_note       text;
  v_all_day    boolean;
  v_end_date   date;
  v_starts     timestamptz;
  v_ends       timestamptz;
  v_owner      uuid;
  v_wish       uuid;
  v_constraint text;
  v_result     jsonb;
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
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'calendar_events_wish_same_space' then
        -- 잠금 사이에 위시가 사라진 경우. 재시도해도 같은 결과이므로 확정 실패로 알린다.
        perform app_private.raise_error('CONFLICT', '{"wishItemId":"gone"}');
      end if;
      -- 위시가 아닌 FK(공간·작성자·소유자)가 깨진 것이다. 위시 안내를 붙이지 않고 그대로 올린다.
      raise;
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
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'calendar_events_wish_same_space' then
        perform app_private.raise_error('CONFLICT', '{"wishItemId":"gone"}');
      end if;
      raise;
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

-- 실행 권한은 그대로여야 한다. 혹시 바뀌었으면 다시 맞춘다.
revoke all on function public.save_calendar_event(uuid, text, text, text, text, boolean, date, time, date, time, uuid, integer, uuid)
  from public, anon;
grant execute on function public.save_calendar_event(uuid, text, text, text, text, boolean, date, time, date, time, uuid, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 적용 직후 자체 점검
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
begin
  if not has_function_privilege('authenticated',
       'public.save_calendar_event(uuid,text,text,text,text,boolean,date,time,date,time,uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'CAL-001 점검 실패: save_calendar_event 실행 권한 없음';
  end if;
  if has_function_privilege('anon',
       'public.save_calendar_event(uuid,text,text,text,text,boolean,date,time,date,time,uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'CAL-001 점검 실패: anon이 save_calendar_event를 실행할 수 있다';
  end if;

  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_calendar_event';

  -- 위시 제약 이름을 확인하지 않고 모든 FK 위반을 위시로 돌리는 상태로 되돌아가지 않게 한다.
  if position('calendar_events_wish_same_space' in v_src) = 0 then
    raise exception 'CAL-001 점검 실패: FK 핸들러가 위시 제약 이름을 확인하지 않는다';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'save_calendar_event'
       and p.prosecdef
       and p.proconfig is not null
       and exists (select 1 from unnest(p.proconfig) as c(v) where c.v like 'search\_path=%')) then
    raise exception 'CAL-001 점검 실패: save_calendar_event의 search_path가 고정되지 않았다';
  end if;
end;
$$;

commit;
