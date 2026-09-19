-- DB-001 / 9. 맛집과 개인 후기 RPC
--
-- DESIGN 5.3 / 7절.
--   * 방문 상태와 방문일은 항상 함께 바뀐다.
--   * visited -> wishlist 되돌리기에 남은 후기가 있으면 명시적 확인이 필요하고,
--     확인된 요청만 후기 삭제와 상태 변경을 한 트랜잭션으로 처리한다.
--   * 후기 저장·삭제도 맛집 행을 잠가 상태 되돌리기와 직렬화한다.

begin;

-- ---------------------------------------------------------------------------
-- 9.1 saveRestaurant — 생성과 정보 수정(상태는 다루지 않는다)
-- ---------------------------------------------------------------------------
create or replace function public.save_restaurant(
  p_restaurant_id    uuid,
  p_name             text,
  p_area             text,
  p_category         text,
  p_map_url          text,
  p_memo             text,
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
  v_restaurant public.restaurants%rowtype;
  v_name       text;
  v_area       text;
  v_category   text;
  v_memo       text;
  v_map_url    text;
  v_host       text;
  v_hosts      text[];
  v_result     jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'saveRestaurant',
    jsonb_build_object(
      'restaurantId', p_restaurant_id,
      'name', p_name, 'area', p_area, 'category', p_category,
      'mapUrl', p_map_url, 'memo', p_memo,
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  v_name     := btrim(coalesce(p_name, ''));
  v_area     := btrim(coalesce(p_area, ''));
  v_category := btrim(coalesce(p_category, ''));
  v_memo     := coalesce(p_memo, '');
  v_map_url  := nullif(btrim(coalesce(p_map_url, '')), '');

  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"name":"length"}');
  end if;
  if char_length(v_area) > 50 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"area":"length"}');
  end if;
  if char_length(v_category) > 50 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"category":"length"}');
  end if;
  if char_length(v_memo) > 2000 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"memo":"length"}');
  end if;

  -- 지도 링크는 HTTPS이며 운영자가 등록한 호스트만 허용한다. 서버가 링크를 가져오지 않는다.
  if v_map_url is not null then
    if v_map_url !~ '^https://[^[:space:]]{3,500}$' then
      perform app_private.raise_error('VALIDATION_ERROR', '{"mapUrl":"https_required"}');
    end if;
    v_hosts := app_private.config_text_array('allowed_map_hosts');
    v_host  := app_private.url_host(v_map_url);
    if v_host is null or not (v_host = any(v_hosts)) then
      perform app_private.raise_error('VALIDATION_ERROR', '{"mapUrl":"host_not_allowed"}');
    end if;
  end if;

  if p_restaurant_id is null then
    if coalesce(p_expected_version, 0) <> 0 then
      perform app_private.raise_error('VALIDATION_ERROR', '{"expectedVersion":"must_be_zero_on_create"}');
    end if;
    insert into public.restaurants (space_id, created_by, name, area, category, map_url, memo)
    values (v_space, v_user, v_name, v_area, v_category, v_map_url, v_memo)
    returning * into v_restaurant;
  else
    select * into v_restaurant
      from public.restaurants r
     where r.id = p_restaurant_id and r.space_id = v_space
       for update;
    if not found then
      perform app_private.raise_error('NOT_FOUND', '{"restaurantId":"missing"}');
    end if;
    if p_expected_version is null or v_restaurant.version <> p_expected_version then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end if;

    update public.restaurants r
       set name     = v_name,
           area     = v_area,
           category = v_category,
           map_url  = v_map_url,
           memo     = v_memo,
           version  = r.version + 1
     where r.id = v_restaurant.id
    returning * into v_restaurant;
  end if;

  v_result := jsonb_build_object(
    'restaurantId', v_restaurant.id,
    'version', v_restaurant.version,
    'status', v_restaurant.status);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9.2 setRestaurantStatus
-- ---------------------------------------------------------------------------
create or replace function public.set_restaurant_status(
  p_restaurant_id         uuid,
  p_status                text,
  p_visited_date          date,
  p_confirm_delete_reviews boolean,
  p_expected_version      integer,
  p_request_id            uuid
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
  v_restaurant public.restaurants%rowtype;
  v_reviews    integer;
  v_deleted    integer := 0;
  v_date       date;
  v_result     jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'setRestaurantStatus',
    jsonb_build_object(
      'restaurantId', p_restaurant_id,
      'status', p_status,
      'visitedDate', p_visited_date,
      'confirmDeleteReviews', coalesce(p_confirm_delete_reviews, false),
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  if p_status is null or p_status not in ('wishlist', 'visited') then
    perform app_private.raise_error('VALIDATION_ERROR', '{"status":"allowed"}');
  end if;

  -- 맛집 행을 잠가 후기 저장과 직렬화한다.
  select * into v_restaurant
    from public.restaurants r
   where r.id = p_restaurant_id and r.space_id = v_space
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"restaurantId":"missing"}');
  end if;
  if p_expected_version is null or v_restaurant.version <> p_expected_version then
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  if p_status = 'visited' then
    v_date := coalesce(p_visited_date, v_restaurant.visited_date, app_private.kst_today());
    if v_date > app_private.kst_today() then
      perform app_private.raise_error('VALIDATION_ERROR', '{"visitedDate":"future_date"}');
    end if;
  else
    if p_visited_date is not null then
      perform app_private.raise_error('VALIDATION_ERROR', '{"visitedDate":"must_be_null"}');
    end if;
    v_date := null;

    select count(*) into v_reviews
      from public.restaurant_reviews rv
     where rv.restaurant_id = v_restaurant.id;

    if v_reviews > 0 then
      if not coalesce(p_confirm_delete_reviews, false) then
        -- 확인되지 않은 요청은 아무것도 바꾸지 않는다.
        perform app_private.raise_error('CONFLICT', '{"confirmDeleteReviews":"required"}');
      end if;
      delete from public.restaurant_reviews rv where rv.restaurant_id = v_restaurant.id;
      get diagnostics v_deleted = row_count;
    end if;
  end if;

  update public.restaurants r
     set status       = p_status,
         visited_date = v_date,
         version      = r.version + 1
   where r.id = v_restaurant.id
  returning * into v_restaurant;

  v_result := jsonb_build_object(
    'restaurantId', v_restaurant.id,
    'version', v_restaurant.version,
    'status', v_restaurant.status,
    'visitedDate', v_restaurant.visited_date,
    'deletedReviewCount', v_deleted);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9.3 deleteRestaurant
-- ---------------------------------------------------------------------------
create or replace function public.delete_restaurant(
  p_restaurant_id    uuid,
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
  v_restaurant public.restaurants%rowtype;
  v_deleted    integer;
  v_result     jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'deleteRestaurant',
    jsonb_build_object('restaurantId', p_restaurant_id, 'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  select * into v_restaurant
    from public.restaurants r
   where r.id = p_restaurant_id and r.space_id = v_space
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"restaurantId":"missing"}');
  end if;
  if p_expected_version is null or v_restaurant.version <> p_expected_version then
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  delete from public.restaurant_reviews rv where rv.restaurant_id = v_restaurant.id;
  get diagnostics v_deleted = row_count;

  delete from public.restaurants r where r.id = v_restaurant.id;

  v_result := jsonb_build_object(
    'restaurantId', v_restaurant.id, 'deletedReviewCount', v_deleted);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9.4 saveReview — 본인 후기만
-- ---------------------------------------------------------------------------
-- 생성 시 expectedVersion은 0, 수정 시 현재 버전을 보낸다(DESIGN 7절).
create or replace function public.save_review(
  p_restaurant_id    uuid,
  p_rating           smallint,
  p_comment          text,
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
  v_restaurant public.restaurants%rowtype;
  v_review     public.restaurant_reviews%rowtype;
  v_comment    text;
  v_result     jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'saveReview',
    jsonb_build_object(
      'restaurantId', p_restaurant_id,
      'rating', p_rating,
      'comment', p_comment,
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  v_comment := coalesce(p_comment, '');
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"rating":"range"}');
  end if;
  if char_length(v_comment) > 500 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"comment":"length"}');
  end if;

  -- 상태 되돌리기와 동시에 실행돼도 후기가 남지 않도록 맛집 행을 잠근다(DESIGN 5.3).
  select * into v_restaurant
    from public.restaurants r
   where r.id = p_restaurant_id and r.space_id = v_space
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"restaurantId":"missing"}');
  end if;
  if v_restaurant.status <> 'visited' then
    perform app_private.raise_error('CONFLICT', '{"restaurant":"not_visited"}');
  end if;

  select * into v_review
    from public.restaurant_reviews rv
   where rv.restaurant_id = v_restaurant.id and rv.user_id = v_user
     for update;

  if not found then
    if coalesce(p_expected_version, 0) <> 0 then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end if;
    begin
      insert into public.restaurant_reviews (restaurant_id, space_id, user_id, rating, comment)
      values (v_restaurant.id, v_space, v_user, p_rating, v_comment)
      returning * into v_review;
    exception when unique_violation then
      -- 동시 생성 경쟁은 UNIQUE 제약으로 검출한다(DESIGN 7절).
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end;
  else
    if p_expected_version is null or v_review.version <> p_expected_version then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end if;
    update public.restaurant_reviews rv
       set rating  = p_rating,
           comment = v_comment,
           version = rv.version + 1
     where rv.id = v_review.id
    returning * into v_review;
  end if;

  v_result := jsonb_build_object(
    'reviewId', v_review.id,
    'restaurantId', v_restaurant.id,
    'version', v_review.version);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9.5 deleteReview — 본인 후기만
-- ---------------------------------------------------------------------------
create or replace function public.delete_review(
  p_review_id        uuid,
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
  v_review public.restaurant_reviews%rowtype;
  v_result jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'deleteReview',
    jsonb_build_object('reviewId', p_review_id, 'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  select * into v_review
    from public.restaurant_reviews rv
   where rv.id = p_review_id
     and rv.space_id = v_space
     and rv.user_id = v_user   -- 상대방 후기는 존재 자체를 알리지 않는다.
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"reviewId":"missing"}');
  end if;
  if p_expected_version is null or v_review.version <> p_expected_version then
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  delete from public.restaurant_reviews rv where rv.id = v_review.id;

  v_result := jsonb_build_object('reviewId', v_review.id, 'restaurantId', v_review.restaurant_id);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

commit;
