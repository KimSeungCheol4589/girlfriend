-- FOOD-001 / 2. 후기 변경이 맛집 버전을 올린다 (전진 마이그레이션)
--
-- 이미 적용된 마이그레이션은 바꾸지 않는다. save_review / delete_review를 같은 서명으로 교체한다
-- (CREATE OR REPLACE는 기존 EXECUTE 권한을 유지한다).
--
-- 문제
--   후기 저장·삭제가 맛집 행의 version을 올리지 않아, 삭제·방문 취소 확인 창을 연 뒤에
--   생기거나 **바뀌거나** 지워진 후기를 expectedVersion으로 알아챌 수 없었다.
--   boolean 확인(p_confirm_delete_reviews)만으로는 "확인할 때 본 후기"와 "지금 후기"가 같은지 모른다.
--     예) A가 B의 후기 "좋음"을 보고 삭제를 확인 → 그 사이 B가 후기를 "최고, 꼭 남겨 줘"로 수정 → A의 요청이 그대로 지운다.
--
-- 수정 (계약 변경)
--   * save_review: 맛집 행을 FOR UPDATE로 잠근 뒤(기존과 같음) 후기를 만들거나 고치고,
--     **같은 트랜잭션에서 맛집 version을 1 올린다.**
--   * delete_review: 후기의 맛집 행을 **먼저** FOR UPDATE로 잠그고(잠금 순서: 맛집 → 후기, 다른 RPC와 같음)
--     후기를 지운 뒤 맛집 version을 1 올린다.
--   * 두 함수의 반환에 `restaurantVersion`(바뀐 뒤 맛집 버전)을 추가한다. 기존 키는 그대로다.
--   * 결과: set_restaurant_status / delete_restaurant_confirmed / save_restaurant의 expectedVersion이
--     "마지막으로 본 후기 상태"까지 포함한다. 확인 창을 연 뒤 후기가 생기거나·바뀌거나·지워지면 GF409 stale.
--   * 같은 requestId 재전송은 begin_request가 저장된 결과를 재생하므로 버전을 다시 올리지 않는다.
--
-- 영향
--   * 후기 저장·삭제 뒤에는 맛집 version과 updated_at이 바뀐다. 정보 수정 화면을 연 채
--     상대가 후기를 쓰면 정보 저장이 CONFLICT가 된다(의도: 조용한 덮어쓰기·삭제 방지).
--   * 두 사람이 동시에 각자 후기를 저장하면 맛집 행 잠금으로 직렬화되고 둘 다 성공한다
--     (후기 자체의 expectedVersion은 각자 후기 기준이라 서로 충돌하지 않는다).

begin;

-- ---------------------------------------------------------------------------
-- save_review
-- ---------------------------------------------------------------------------
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

  -- 맛집 행을 잠가 상태 되돌리기·삭제·상대 후기 저장과 직렬화한다.
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

  -- 후기 변경을 맛집 버전에 반영한다(확인 창의 expectedVersion이 후기 변화를 알아채도록).
  update public.restaurants r
     set version = r.version + 1
   where r.id = v_restaurant.id
  returning * into v_restaurant;

  v_result := jsonb_build_object(
    'reviewId', v_review.id,
    'restaurantId', v_restaurant.id,
    'version', v_review.version,
    'restaurantVersion', v_restaurant.version);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_review
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
  v_user          uuid;
  v_space         uuid;
  v_req           record;
  v_restaurant_id uuid;
  v_restaurant    public.restaurants%rowtype;
  v_review        public.restaurant_reviews%rowtype;
  v_result        jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'deleteReview',
    jsonb_build_object('reviewId', p_review_id, 'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  -- 본인 후기의 맛집을 찾는다. 상대 후기는 존재 자체를 알리지 않는다.
  select rv.restaurant_id into v_restaurant_id
    from public.restaurant_reviews rv
   where rv.id = p_review_id
     and rv.space_id = v_space
     and rv.user_id = v_user;
  if v_restaurant_id is null then
    perform app_private.raise_error('NOT_FOUND', '{"reviewId":"missing"}');
  end if;

  -- 잠금 순서: 맛집 → 후기 (save_review·set_restaurant_status·delete_restaurant_confirmed와 같다).
  select * into v_restaurant
    from public.restaurants r
   where r.id = v_restaurant_id and r.space_id = v_space
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"reviewId":"missing"}');
  end if;

  -- 잠근 뒤 다시 읽는다. 그 사이 방문 취소·맛집 삭제로 지워졌으면 NOT_FOUND다.
  select * into v_review
    from public.restaurant_reviews rv
   where rv.id = p_review_id
     and rv.space_id = v_space
     and rv.user_id = v_user
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"reviewId":"missing"}');
  end if;
  if p_expected_version is null or v_review.version <> p_expected_version then
    perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
  end if;

  delete from public.restaurant_reviews rv where rv.id = v_review.id;

  update public.restaurants r
     set version = r.version + 1
   where r.id = v_restaurant.id
  returning * into v_restaurant;

  v_result := jsonb_build_object(
    'reviewId', v_review.id,
    'restaurantId', v_review.restaurant_id,
    'restaurantVersion', v_restaurant.version);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- CREATE OR REPLACE는 권한을 유지하지만, 기본 권한 변경에 기대지 않도록 다시 명시한다.
revoke all on function public.save_review(uuid, smallint, text, integer, uuid) from public, anon;
revoke all on function public.delete_review(uuid, integer, uuid)             from public, anon;
grant execute on function public.save_review(uuid, smallint, text, integer, uuid) to authenticated;
grant execute on function public.delete_review(uuid, integer, uuid)             to authenticated;

do $$
begin
  if not has_function_privilege('authenticated', 'public.save_review(uuid,smallint,text,integer,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.delete_review(uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'FOOD-001 권한 점검 실패: 후기 RPC 실행 권한 없음';
  end if;
  if has_function_privilege('anon', 'public.save_review(uuid,smallint,text,integer,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_review(uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'FOOD-001 권한 점검 실패: anon이 후기 RPC를 실행할 수 있다';
  end if;
  if has_function_privilege('authenticated', 'public.delete_restaurant(uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'FOOD-001 권한 점검 실패: 확인 없는 delete_restaurant가 열려 있다';
  end if;
end;
$$;

commit;
