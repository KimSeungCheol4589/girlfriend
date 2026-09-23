-- WISH-001 / 1. 일반 위시(wish_items) 테이블·권한·RLS·RPC
--
-- 맛집(restaurants)과 분리된 "함께 하고 싶은 일" 저장소다(DESIGN 1·5.2·5.3·6·7).
-- 이미 적용된 마이그레이션은 바꾸지 않고 이 파일만 추가한다.
--
-- 계약 요약
--   * 분류 place/activity/trip/shopping/other, 상태 wish/planned/done, 제목 1~100자, 메모 2,000자 이하.
--   * 링크는 선택이며 HTTPS만 허용한다. 서버가 링크 내용을 가져오지 않는다(DESIGN 9).
--   * 계획일은 선택이다. 맛집 방문일과 달리 **미래 날짜가 정상**이므로 미래 거부 트리거를 달지 않는다.
--   * 두 구성원 모두 조회·생성·수정·상태 전환·삭제할 수 있다. 다른 공간·비로그인은 존재 여부도 알 수 없다.
--   * 테이블 직접 쓰기는 금지다. 변경은 아래 SECURITY DEFINER RPC로만 한다.
--   * 모든 변경 RPC는 expectedVersion(충돌)과 requestId(중복 요청)를 함께 쓴다(DESIGN 8.4).
--
-- 설계 결정(DESIGN에 명시가 없어 이 작업에서 정한 것)
--   * `status = 'wish'`이면 `planned_date`는 항상 NULL이다. 아직 계획하지 않은 위시에 계획일이 남아
--     있으면 화면과 이후 캘린더 연결(CAL-001)에서 의미가 어긋난다. 되돌릴 때 DB가 함께 비운다.
--   * `planned`/`done`에서는 계획일이 **선택**이며, 보낸 값이 그대로 저장된다(coalesce로 이전 값을
--     되살리지 않는다). 날짜를 비우려면 null을 보내면 된다.
--   * `save_wish`는 상태·계획일을 다루지 않는다. 새 위시는 항상 'wish'다(save_restaurant와 같은 분리).

begin;

-- ---------------------------------------------------------------------------
-- 1.1 테이블
-- ---------------------------------------------------------------------------
create table if not exists public.wish_items (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces (id) on delete cascade,
  created_by   uuid not null references public.profiles (id) on delete restrict,
  title        text not null,
  category     text not null default 'other',
  memo         text not null default '',
  link_url     text,
  status       text not null default 'wish',
  planned_date date,
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- CAL-001의 calendar_events(wish_item_id, space_id) 복합 FK가 쓸 수 있도록 미리 둔다.
  constraint wish_items_id_space_key     unique (id, space_id),
  constraint wish_items_title_trimmed    check (title = btrim(title)),
  constraint wish_items_title_length     check (char_length(title) between 1 and 100),
  constraint wish_items_memo_length      check (char_length(memo) <= 2000),
  constraint wish_items_category_allowed check (category in ('place', 'activity', 'trip', 'shopping', 'other')),
  constraint wish_items_status_allowed   check (status in ('wish', 'planned', 'done')),
  -- HTTPS만. 공백 없음. 길이는 별도 CHECK로 정확히 제한한다(앱 상수와 같은 값).
  constraint wish_items_link_url_https   check (link_url is null or link_url ~ '^https://[^[:space:]]+$'),
  constraint wish_items_link_url_length  check (link_url is null or char_length(link_url) between 11 and 500),
  -- 아직 계획하지 않은 위시에는 계획일이 없다.
  constraint wish_items_plan_consistent  check (status <> 'wish' or planned_date is null),
  constraint wish_items_version_positive check (version >= 1)
);

comment on table public.wish_items is
  'WISH-001: 맛집과 분리된 공유 위시. 두 구성원이 함께 편집한다. 변경은 전용 RPC로만 한다.';

-- DESIGN 5.3의 조회 인덱스. 목록 정렬은 created_at DESC, id DESC다.
create index if not exists wish_items_list_idx
  on public.wish_items (space_id, status, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 1.2 트리거 — DB-001의 공통 트리거 함수를 재사용한다
-- ---------------------------------------------------------------------------
drop trigger if exists wish_items_touch on public.wish_items;
create trigger wish_items_touch
  before update on public.wish_items
  for each row execute function app_private.tg_touch_updated_at();

drop trigger if exists wish_items_immutable on public.wish_items;
create trigger wish_items_immutable
  before update on public.wish_items
  for each row execute function app_private.tg_immutable_columns(
    'id', 'space_id', 'created_by', 'created_at');

drop trigger if exists wish_items_version on public.wish_items;
create trigger wish_items_version
  before update on public.wish_items
  for each row execute function app_private.tg_version_step();

-- 계획일에는 tg_no_future_date를 달지 않는다. 앞으로 할 일이므로 미래 날짜가 정상이다.

-- ---------------------------------------------------------------------------
-- 1.3 권한과 RLS
-- ---------------------------------------------------------------------------
-- 신규 테이블에 자동으로 붙었을 수 있는 권한을 먼저 모두 회수한다(foundation의 기본 권한 차단과 같은 방향).
revoke all on table public.wish_items from public, anon, authenticated, service_role;

grant select on table public.wish_items to authenticated, service_role;

alter table public.wish_items enable row level security;

-- 조회는 자기 공간만. 쓰기 정책은 만들지 않는다(직접 쓰기 전면 차단).
drop policy if exists wish_items_select_member on public.wish_items;
create policy wish_items_select_member on public.wish_items
  for select to authenticated
  using (space_id = app.current_space_id());

-- ---------------------------------------------------------------------------
-- 1.4 내부 헬퍼 — 링크 검사
-- ---------------------------------------------------------------------------
-- HTTPS이고, 길이가 범위 안이며, 호스트에 사용자 정보(`user@host`)가 없어야 한다.
-- 사용자 정보가 붙은 주소는 화면에서 믿을 수 있는 호스트처럼 보이게 만들 수 있다.
-- 링크 내용은 가져오지 않는다. 호스트 허용 목록은 두지 않는다(맛집 지도 링크와 다른 점).
create or replace function app_private.wish_link_problem(p_link_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_host text;
begin
  if p_link_url is null then
    return null;
  end if;
  if p_link_url !~ '^https://[^[:space:]]+$' then
    return 'https_required';
  end if;
  if char_length(p_link_url) < 11 or char_length(p_link_url) > 500 then
    return 'length';
  end if;
  v_host := app_private.url_host(p_link_url);
  if v_host is null or position('@' in v_host) > 0 then
    return 'host_not_allowed';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.5 saveWish — 생성과 정보 수정(상태·계획일은 다루지 않는다)
-- ---------------------------------------------------------------------------
create or replace function public.save_wish(
  p_wish_id          uuid,
  p_title            text,
  p_category         text,
  p_memo             text,
  p_link_url         text,
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
  v_wish     public.wish_items%rowtype;
  v_title    text;
  v_category text;
  v_memo     text;
  v_link     text;
  v_problem  text;
  v_result   jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'saveWish',
    jsonb_build_object(
      'wishId', p_wish_id,
      'title', p_title,
      'category', p_category,
      'memo', p_memo,
      'linkUrl', p_link_url,
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  v_title    := btrim(coalesce(p_title, ''));
  v_category := btrim(lower(coalesce(p_category, '')));
  v_memo     := coalesce(p_memo, '');
  v_link     := nullif(btrim(coalesce(p_link_url, '')), '');

  if char_length(v_title) < 1 or char_length(v_title) > 100 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"title":"length"}');
  end if;
  if v_category not in ('place', 'activity', 'trip', 'shopping', 'other') then
    perform app_private.raise_error('VALIDATION_ERROR', '{"category":"allowed"}');
  end if;
  if char_length(v_memo) > 2000 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"memo":"length"}');
  end if;

  v_problem := app_private.wish_link_problem(v_link);
  if v_problem is not null then
    perform app_private.raise_error('VALIDATION_ERROR',
      json_build_object('linkUrl', v_problem)::text);
  end if;

  if p_wish_id is null then
    if coalesce(p_expected_version, 0) <> 0 then
      perform app_private.raise_error('VALIDATION_ERROR', '{"expectedVersion":"must_be_zero_on_create"}');
    end if;
    -- 작성자·공간은 세션에서 정한다. 클라이언트가 보낸 값을 쓰지 않는다.
    insert into public.wish_items (space_id, created_by, title, category, memo, link_url)
    values (v_space, v_user, v_title, v_category, v_memo, v_link)
    returning * into v_wish;
  else
    select * into v_wish
      from public.wish_items w
     where w.id = p_wish_id and w.space_id = v_space
       for update;
    if not found then
      -- 다른 공간의 위시도 존재 여부를 알리지 않는다.
      perform app_private.raise_error('NOT_FOUND', '{"wishId":"missing"}');
    end if;
    if p_expected_version is null or v_wish.version <> p_expected_version then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end if;

    update public.wish_items w
       set title    = v_title,
           category = v_category,
           memo     = v_memo,
           link_url = v_link,
           version  = w.version + 1
     where w.id = v_wish.id
    returning * into v_wish;
  end if;

  v_result := jsonb_build_object(
    'wishId', v_wish.id,
    'version', v_wish.version,
    'status', v_wish.status,
    'category', v_wish.category);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.6 setWishStatus — 하고 싶음 / 계획됨 / 완료 전환과 계획일
-- ---------------------------------------------------------------------------
create or replace function public.set_wish_status(
  p_wish_id          uuid,
  p_status           text,
  p_planned_date     date,
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
  v_date   date;
  v_result jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'setWishStatus',
    jsonb_build_object(
      'wishId', p_wish_id,
      'status', p_status,
      'plannedDate', p_planned_date,
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  if p_status is null or p_status not in ('wish', 'planned', 'done') then
    perform app_private.raise_error('VALIDATION_ERROR', '{"status":"allowed"}');
  end if;
  if p_status = 'wish' and p_planned_date is not null then
    perform app_private.raise_error('VALIDATION_ERROR', '{"plannedDate":"must_be_null"}');
  end if;

  -- 행을 잠가 같은 위시의 다른 변경(정보 수정·삭제)과 직렬화한다.
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

  -- 보낸 값을 그대로 저장한다. 'wish'로 되돌리면 계획일을 비운다.
  v_date := case when p_status = 'wish' then null else p_planned_date end;

  update public.wish_items w
     set status       = p_status,
         planned_date = v_date,
         version      = w.version + 1
   where w.id = v_wish.id
  returning * into v_wish;

  v_result := jsonb_build_object(
    'wishId', v_wish.id,
    'version', v_wish.version,
    'status', v_wish.status,
    'plannedDate', v_wish.planned_date);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.7 deleteWish
-- ---------------------------------------------------------------------------
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
    -- 확인 창을 연 뒤 상대가 무엇이든 바꿨으면 아무것도 지우지 않는다.
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  delete from public.wish_items w where w.id = v_wish.id;

  v_result := jsonb_build_object('wishId', v_wish.id);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.8 실행 권한
-- ---------------------------------------------------------------------------
revoke all on function app_private.wish_link_problem(text)
  from public, anon, authenticated, service_role;

revoke all on function public.save_wish(uuid, text, text, text, text, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.set_wish_status(uuid, text, date, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_wish(uuid, integer, uuid)
  from public, anon, authenticated;

grant execute on function public.save_wish(uuid, text, text, text, text, integer, uuid) to authenticated;
grant execute on function public.set_wish_status(uuid, text, date, integer, uuid)        to authenticated;
grant execute on function public.delete_wish(uuid, integer, uuid)                        to authenticated;

-- ---------------------------------------------------------------------------
-- 1.9 적용 직후 자체 점검 — 위반이 있으면 마이그레이션을 실패시킨다
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- (1) 로그인 사용자 RPC는 실행할 수 있어야 한다.
  if not has_function_privilege('authenticated',
       'public.save_wish(uuid,text,text,text,text,integer,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.set_wish_status(uuid,text,date,integer,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.delete_wish(uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'WISH-001 권한 점검 실패: 위시 RPC 실행 권한 없음';
  end if;

  -- (2) anon에는 어떤 변경 RPC도 없어야 한다.
  if has_function_privilege('anon', 'public.save_wish(uuid,text,text,text,text,integer,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_wish_status(uuid,text,date,integer,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_wish(uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'WISH-001 권한 점검 실패: anon이 위시 RPC를 실행할 수 있다';
  end if;

  -- (3) 내부 헬퍼는 클라이언트 역할에 노출되면 안 된다.
  if has_function_privilege('anon', 'app_private.wish_link_problem(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.wish_link_problem(text)', 'EXECUTE') then
    raise exception 'WISH-001 권한 점검 실패: app_private 헬퍼가 노출됐다';
  end if;

  -- (4) 클라이언트·서비스 역할에 직접 쓰기 권한이 남아 있으면 안 된다.
  --     소유자(postgres)는 마이그레이션·복구 경로이므로 제외한다(DB-001의 11.4와 같은 기준).
  select string_agg(format('%s:%s', g.grantee, g.privilege_type), ', ')
    into v_bad
    from information_schema.role_table_grants g
   where g.table_schema = 'public'
     and g.table_name = 'wish_items'
     and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if v_bad is not null then
    raise exception 'WISH-001 권한 점검 실패: wish_items 직접 쓰기 권한이 남아 있다 (%)', v_bad;
  end if;

  -- (5) RLS가 켜져 있어야 한다.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'wish_items' and c.relrowsecurity) then
    raise exception 'WISH-001 권한 점검 실패: wish_items에 RLS가 꺼져 있다';
  end if;

  -- (6) 새 SECURITY DEFINER 함수에 고정 search_path가 있어야 한다.
  select string_agg(p.proname, ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('save_wish', 'set_wish_status', 'delete_wish')
     and p.prosecdef
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) as c(v) where c.v like 'search\_path=%'));
  if v_bad is not null then
    raise exception 'WISH-001 권한 점검 실패: search_path 미고정 함수 (%)', v_bad;
  end if;
end;
$$;

commit;
