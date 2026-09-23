-- FOOD-001 / 1. 맛집 삭제의 후기 삭제 확인 (전진·추가 마이그레이션)
--
-- 이미 적용된 마이그레이션은 바꾸지 않는다. 새 함수를 추가하고 이전 함수의 실행 권한만 회수한다.
--
-- 문제
--   DB-001의 delete_restaurant(uuid, integer, uuid)는 연결된 후기를 **확인 없이** 함께 지운다.
--   후기 저장은 맛집 행의 version을 올리지 않으므로 expectedVersion만으로는 경쟁을 잡지 못한다.
--     1) A가 후기 0개인 맛집의 삭제 확인 창을 연다(후기 삭제 안내 없음).
--     2) 그 사이 B가 후기를 저장한다(맛집 version 그대로).
--     3) A의 삭제가 같은 expectedVersion으로 성공하고 B의 후기가 조용히 사라진다.
--   DESIGN 6절("맛집 삭제·방문 취소: 연결된 후기 제거를 명시적으로 확인")을 DB에서 보장하지 못한다.
--
-- 수정
--   * public.delete_restaurant_confirmed(p_restaurant_id, p_confirm_delete_reviews, p_expected_version, p_request_id)
--     set_restaurant_status와 같은 규칙: 맛집 행을 잠근 뒤 후기가 남아 있으면
--     p_confirm_delete_reviews = true일 때만 삭제한다. 확인이 없으면 **아무것도 바꾸지 않고**
--     GF409 {"confirmDeleteReviews":"required"}.
--   * 맛집 행을 FOR UPDATE로 잠그므로 save_review(같은 행을 잠근다)와 직렬화된다.
--   * 이전 delete_restaurant는 authenticated 실행 권한을 회수한다. 직접 API 호출로 확인을 우회할 수 없다.
--     함수 자체는 지우지 않는다(이미 적용된 계약의 흔적과 롤백 경로를 남긴다).
--   * 멱등성 작업 이름은 'deleteRestaurantConfirmed'로 분리한다. 같은 requestId를 다른 작업에 재사용하면
--     begin_request가 CONFLICT로 거부한다.

begin;

create or replace function public.delete_restaurant_confirmed(
  p_restaurant_id          uuid,
  p_confirm_delete_reviews boolean,
  p_expected_version       integer,
  p_request_id             uuid
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
  v_result     jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'deleteRestaurantConfirmed',
    jsonb_build_object(
      'restaurantId', p_restaurant_id,
      'confirmDeleteReviews', coalesce(p_confirm_delete_reviews, false),
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  -- 맛집 행을 잠가 후기 저장(save_review)과 직렬화한다.
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

  delete from public.restaurants r where r.id = v_restaurant.id;

  v_result := jsonb_build_object(
    'restaurantId', v_restaurant.id, 'deletedReviewCount', v_deleted);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

revoke all on function public.delete_restaurant_confirmed(uuid, boolean, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_restaurant_confirmed(uuid, boolean, integer, uuid)
  to authenticated;

-- 확인 없는 이전 삭제 경로를 닫는다.
revoke execute on function public.delete_restaurant(uuid, integer, uuid)
  from public, anon, authenticated;

-- 적용 직후 자체 점검
do $$
begin
  if not has_function_privilege('authenticated',
       'public.delete_restaurant_confirmed(uuid,boolean,integer,uuid)', 'EXECUTE') then
    raise exception 'FOOD-001 권한 점검 실패: delete_restaurant_confirmed 실행 권한 없음';
  end if;
  if has_function_privilege('anon',
       'public.delete_restaurant_confirmed(uuid,boolean,integer,uuid)', 'EXECUTE') then
    raise exception 'FOOD-001 권한 점검 실패: anon이 delete_restaurant_confirmed를 실행할 수 있다';
  end if;
  if has_function_privilege('authenticated',
       'public.delete_restaurant(uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'FOOD-001 권한 점검 실패: 확인 없는 delete_restaurant가 여전히 열려 있다';
  end if;
end;
$$;

commit;
