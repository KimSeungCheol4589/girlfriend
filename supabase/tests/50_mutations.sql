-- DB-001 테스트 50 — 변경 RPC, 버전 충돌, 중복 요청, 파일·후기 흐름
--
-- 확인 대상
--   * 업로드 준비/확정의 소유자 검사와 상태 전이
--   * 추억 저장의 사진 순서·교체·분리된 파일 정리 표시
--   * expectedVersion 불일치 → CONFLICT, 같은 requestId 재전송 → 같은 결과
--   * 같은 requestId + 다른 입력 → 거부
--   * 맛집 방문 상태 되돌리기와 후기 삭제 확인
--   * 개인 후기는 본인만 수정·삭제

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\set ua '11111111-1111-4111-8111-111111111111'
\set ub '22222222-2222-4222-8222-222222222222'
\set s1 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'

select tests_support.make_user(:'ua', 'a.member@test.invalid');
select tests_support.make_user(:'ub', 'b.member@test.invalid');
select tests_support.make_profile(:'ua', '에이');
select tests_support.make_profile(:'ub', '비이');
select tests_support.make_space(:'s1', :'ua', '우리 공간');
select tests_support.add_member(:'s1', :'ub');

-- ---------------------------------------------------------------------------
-- 업로드 준비와 확정
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_prep   jsonb;
  v_final  jsonb;
  v_asset  uuid;
begin
  perform tests_support.expect_error(
    $q$select public.prepare_upload('avatar', 'image/webp', 1000, gen_random_uuid())$q$,
    'GF422', '허용되지 않은 purpose 거부');
  perform tests_support.expect_error(
    $q$select public.prepare_upload('memory', 'image/heic', 1000, gen_random_uuid())$q$,
    'GF422', '허용되지 않은 MIME 거부');
  perform tests_support.expect_error(
    $q$select public.prepare_upload('memory', 'image/webp', 10485761, gen_random_uuid())$q$,
    'GF422', '10MiB 초과 거부');

  v_prep := public.prepare_upload('memory', 'image/webp', 2048, gen_random_uuid());
  v_asset := (v_prep ->> 'assetId')::uuid;
  perform tests_support.put('asset1', v_asset::text);
  perform tests_support.eq(v_prep ->> 'state', 'pending', 'prepare_upload는 pending 상태를 만든다');
  perform tests_support.eq(
    v_prep ->> 'objectPath',
    'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1/' || v_asset::text || '.webp',
    '경로는 서버가 정한다');

  perform tests_support.expect_error(
    format($q$select public.finalize_upload(%L, 2048, 99999, 99999, gen_random_uuid())$q$, v_asset),
    'GF412', '픽셀 상한 초과 거부');

  v_final := public.finalize_upload(v_asset, 2048, 1200, 800, gen_random_uuid());
  perform tests_support.eq(v_final ->> 'state', 'ready', 'finalize_upload는 ready로 바꾼다');

  -- 두 번째, 세 번째 사진
  v_prep := public.prepare_upload('memory', 'image/jpeg', 2048, gen_random_uuid());
  perform tests_support.put('asset2', v_prep ->> 'assetId');
  perform public.finalize_upload((v_prep ->> 'assetId')::uuid, 2048, 800, 600, gen_random_uuid());

  v_prep := public.prepare_upload('memory', 'image/png', 2048, gen_random_uuid());
  perform tests_support.put('asset3', v_prep ->> 'assetId');
  perform public.finalize_upload((v_prep ->> 'assetId')::uuid, 2048, 800, 600, gen_random_uuid());

  -- 커버용 파일
  v_prep := public.prepare_upload('cover', 'image/webp', 4096, gen_random_uuid());
  perform tests_support.put('cover1', v_prep ->> 'assetId');
  perform public.finalize_upload((v_prep ->> 'assetId')::uuid, 4096, 1600, 900, gen_random_uuid());

  v_prep := public.prepare_upload('cover', 'image/webp', 4096, gen_random_uuid());
  perform tests_support.put('cover2', v_prep ->> 'assetId');
  perform public.finalize_upload((v_prep ->> 'assetId')::uuid, 4096, 1600, 900, gen_random_uuid());
end;
$do$;

-- 상대 구성원은 남의 파일을 확정할 수 없다.
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

select tests_support.expect_error(
  format($q$select public.finalize_upload(%L, 2048, 800, 600, gen_random_uuid())$q$,
         tests_support.get('asset1')),
  'GF404', '상대 구성원은 남의 파일을 확정할 수 없다');
select tests_support.expect_error(
  format($q$select public.discard_upload(%L, gen_random_uuid())$q$, tests_support.get('asset2')),
  'GF404', '상대 구성원은 남의 파일을 폐기할 수 없다');

-- ---------------------------------------------------------------------------
-- 추억 저장
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_save    jsonb;
  v_memory  uuid;
  v_request uuid := '99999999-9999-4999-8999-999999999911';
  v_a1 uuid := tests_support.get('asset1')::uuid;
  v_a2 uuid := tests_support.get('asset2')::uuid;
  v_a3 uuid := tests_support.get('asset3')::uuid;
begin
  perform tests_support.expect_error(
    format($q$select public.save_memory(null, '', '', current_date - 1, null,
             array[]::text[], array[]::uuid[], false, 0, %L)$q$, gen_random_uuid()),
    'GF422', '제목 없는 추억 거부');

  -- app_private는 authenticated가 호출할 수 없으므로 한국 날짜를 인라인으로 계산한다.
  perform tests_support.expect_error(
    format($q$select public.save_memory(null, '미래', '', %L, null,
             array[]::text[], array[]::uuid[], false, 0, %L)$q$,
           (now() at time zone 'Asia/Seoul')::date + 1, gen_random_uuid()),
    'GF422', '미래 날짜 추억 거부');

  perform tests_support.expect_error(
    format($q$select public.save_memory(null, '중복 사진', '', current_date - 1, null,
             array[]::text[], array[%L::uuid, %L::uuid], false, 0, %L)$q$,
           v_a1, v_a1, gen_random_uuid()),
    'GF422', '같은 사진 중복 지정 거부');

  v_save := public.save_memory(null, '첫 데이트', '즐거웠다', current_date - 3, '서울',
                               array['데이트','봄'], array[v_a1, v_a2], false, 0, v_request);
  v_memory := (v_save ->> 'memoryId')::uuid;
  perform tests_support.put('memory1', v_memory::text);
  perform tests_support.eq((v_save ->> 'version')::integer, 1, '새 추억 버전 1');
  perform tests_support.eq((v_save ->> 'photoCount')::integer, 2, '사진 2장 연결');

  -- 같은 requestId 재전송 → 같은 결과, 추억은 하나만 생긴다.
  v_save := public.save_memory(null, '첫 데이트', '즐거웠다', current_date - 3, '서울',
                               array['데이트','봄'], array[v_a1, v_a2], false, 0, v_request);
  perform tests_support.eq(v_save ->> 'memoryId', v_memory::text, '재전송은 같은 추억을 반환');
  perform tests_support.eq(
    (select count(*) from public.memories m where m.space_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1')::bigint,
    1::bigint, '재전송으로 추억이 두 개 생기지 않는다');

  -- 같은 requestId + 다른 입력 → 거부
  perform tests_support.expect_error(
    format($q$select public.save_memory(null, '다른 제목', '', current_date - 3, null,
             array[]::text[], array[]::uuid[], false, 0, %L)$q$, v_request),
    'GF409', '같은 requestId에 다른 입력은 거부');

  -- 버전 불일치
  perform tests_support.expect_error(
    format($q$select public.save_memory(%L, '충돌', '', current_date - 3, null,
             array[]::text[], array[]::uuid[], false, 99, %L)$q$, v_memory, gen_random_uuid()),
    'GF409', 'expectedVersion 불일치는 CONFLICT');

  -- 사진 순서 교체 + 한 장 제거 + 한 장 추가
  v_save := public.save_memory(v_memory, '첫 데이트', '즐거웠다', current_date - 3, '서울',
                               array['데이트'], array[v_a3, v_a1], false, 1, gen_random_uuid());
  perform tests_support.eq((v_save ->> 'version')::integer, 2, '수정 후 버전 2');
  perform tests_support.eq((v_save ->> 'photoCount')::integer, 2, '사진 2장 유지');
  perform tests_support.eq(
    jsonb_array_length(v_save -> 'detachedAssets'), 1, '빠진 사진 1장이 정리 대상');
end;
$do$;

reset role;
select tests_support.eq(
  (select p.sort_order from public.memory_photos p
    where p.memory_id = tests_support.get('memory1')::uuid
      and p.asset_id = tests_support.get('asset3')::uuid), 0,
  '새 사진이 첫 번째 순서');
select tests_support.eq(
  (select p.sort_order from public.memory_photos p
    where p.memory_id = tests_support.get('memory1')::uuid
      and p.asset_id = tests_support.get('asset1')::uuid), 1,
  '기존 사진이 두 번째 순서');
select tests_support.eq(
  (select a.state from public.assets a where a.id = tests_support.get('asset2')::uuid),
  'deleting', '연결이 끊긴 사진은 deleting 상태');
select tests_support.ok(
  (select a.expires_at is null from public.assets a where a.id = tests_support.get('asset1')::uuid),
  '첨부된 사진은 만료 정리 대상에서 빠진다');

-- 다른 기록에 붙은 사진은 재사용할 수 없다.
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

select tests_support.expect_error(
  format($q$select public.save_memory(null, '남의 사진 재사용', '', current_date - 1, null,
           array[]::text[], array[%L::uuid], false, 0, gen_random_uuid())$q$,
         tests_support.get('asset1')),
  'GF409', '이미 연결된 사진은 다른 기록에 붙일 수 없다');

select tests_support.expect_error(
  format($q$select public.save_memory(null, '삭제 예정 사진', '', current_date - 1, null,
           array[]::text[], array[%L::uuid], false, 0, gen_random_uuid())$q$,
         tests_support.get('asset2')),
  'GF422', 'deleting 사진은 붙일 수 없다');

-- 상대 구성원도 공유 기록은 수정할 수 있다.
do $do$
declare v_save jsonb;
begin
  v_save := public.save_memory(tests_support.get('memory1')::uuid, '첫 데이트(B 수정)', '',
                               current_date - 3, null, array[]::text[],
                               array[tests_support.get('asset3')::uuid,
                                     tests_support.get('asset1')::uuid],
                               true, 2, gen_random_uuid());
  perform tests_support.eq((v_save ->> 'version')::integer, 3, '상대 구성원도 공유 기록을 수정한다');
end;
$do$;

reset role;
select tests_support.eq(
  (select m.author_id from public.memories m where m.id = tests_support.get('memory1')::uuid),
  :'ua'::uuid, '상대가 수정해도 작성자는 바뀌지 않는다');

-- ---------------------------------------------------------------------------
-- 꾸미기 저장
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_result jsonb;
  v_cover1 uuid := tests_support.get('cover1')::uuid;
  v_cover2 uuid := tests_support.get('cover2')::uuid;
  -- app_private.default_home_sections()는 authenticated가 호출할 수 없으므로 리터럴을 쓴다.
  v_sections jsonb := '[{"key":"pinned","visible":true},
                        {"key":"recentMemories","visible":true},
                        {"key":"wishlist","visible":false}]'::jsonb;
begin
  perform tests_support.expect_error(
    format($q$select public.save_customization('neon', '#112233', null, %L::jsonb, 1, %L)$q$,
           v_sections, gen_random_uuid()),
    'GF422', '허용되지 않은 테마 거부');

  perform tests_support.expect_error(
    format($q$select public.save_customization('cream', 'red', null, %L::jsonb, 1, %L)$q$,
           v_sections, gen_random_uuid()),
    'GF422', '색상 형식 거부');

  perform tests_support.expect_error(
    format($q$select public.save_customization('cream', '#112233', null, '[]'::jsonb, 1, %L)$q$,
           gen_random_uuid()),
    'GF422', '섹션 JSON 형식 거부');

  perform tests_support.expect_error(
    format($q$select public.save_customization('cream', '#112233', %L, %L::jsonb, 1, %L)$q$,
           tests_support.get('asset1'), v_sections, gen_random_uuid()),
    'GF422', '목적이 memory인 파일은 커버가 될 수 없다');

  v_result := public.save_customization('rose', '#8B435A', v_cover1,
                v_sections, 1, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 2, '꾸미기 저장 후 버전 2');

  perform tests_support.expect_error(
    format($q$select public.save_customization('sage', '#112233', null, %L::jsonb, 1, %L)$q$,
           v_sections, gen_random_uuid()),
    'GF409', '오래된 버전으로 저장하면 CONFLICT');

  -- 커버 교체 시 이전 커버는 정리 대상이 된다.
  v_result := public.save_customization('rose', '#8b435a', v_cover2,
                v_sections, 2, gen_random_uuid());
  perform tests_support.eq(jsonb_array_length(v_result -> 'detachedAssets'), 1,
    '이전 커버가 정리 대상으로 반환된다');
end;
$do$;

reset role;
select tests_support.eq(
  (select a.state from public.assets a where a.id = tests_support.get('cover1')::uuid),
  'deleting', '교체된 이전 커버는 deleting 상태');
select tests_support.eq(
  (select s.accent_color from public.space_settings s
    where s.space_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  '#8b435a', '포인트 색상은 소문자로 정규화된다');

-- ---------------------------------------------------------------------------
-- 맛집과 개인 후기
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_result jsonb;
  v_rest   uuid;
begin
  perform tests_support.expect_error(
    $q$select public.save_restaurant(null, '나쁜 링크', '', '', 'https://evil.example.com/x',
           '', 0, gen_random_uuid())$q$,
    'GF422', '허용되지 않은 지도 호스트 거부');

  v_result := public.save_restaurant(null, '테스트 맛집', '서울', '한식',
                'https://map.naver.com/p/1', '메모', 0, gen_random_uuid());
  v_rest := (v_result ->> 'restaurantId')::uuid;
  perform tests_support.put('restaurant1', v_rest::text);
  perform tests_support.eq(v_result ->> 'status', 'wishlist', '새 맛집은 wishlist');

  -- wishlist 상태에서는 후기를 만들 수 없다.
  perform tests_support.expect_error(
    format($q$select public.save_review(%L, 5::smallint, '맛있다', 0, %L)$q$, v_rest, gen_random_uuid()),
    'GF409', 'wishlist 맛집에는 후기 불가');

  -- 방문 처리
  v_result := public.set_restaurant_status(v_rest, 'visited', current_date - 1, false, 1,
                gen_random_uuid());
  perform tests_support.eq(v_result ->> 'status', 'visited', '방문 완료로 전환');

  -- 후기 작성
  v_result := public.save_review(v_rest, 5::smallint, 'A의 후기', 0, gen_random_uuid());
  perform tests_support.put('review_a', v_result ->> 'reviewId');
  perform tests_support.eq((v_result ->> 'version')::integer, 1, '후기 버전 1');

  -- 같은 사용자의 두 번째 생성 시도(버전 0)는 충돌
  perform tests_support.expect_error(
    format($q$select public.save_review(%L, 4::smallint, '중복 생성', 0, %L)$q$, v_rest, gen_random_uuid()),
    'GF409', '후기 중복 생성은 CONFLICT');

  -- 수정
  v_result := public.save_review(v_rest, 4::smallint, 'A의 수정 후기', 1, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 2, '후기 수정 후 버전 2');
end;
$do$;

-- B의 후기
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

do $do$
declare v_result jsonb;
begin
  v_result := public.save_review(tests_support.get('restaurant1')::uuid, 3::smallint,
                                 'B의 후기', 0, gen_random_uuid());
  perform tests_support.put('review_b', v_result ->> 'reviewId');
end;
$do$;

-- B는 A의 후기를 지울 수 없다.
select tests_support.expect_error(
  format($q$select public.delete_review(%L, 2, gen_random_uuid())$q$, tests_support.get('review_a')),
  'GF404', '상대방 후기는 삭제할 수 없다');

-- 방문 취소는 후기 삭제 확인이 필요하다.
select tests_support.expect_error(
  format($q$select public.set_restaurant_status(%L, 'wishlist', null, false, 2, gen_random_uuid())$q$,
         tests_support.get('restaurant1')),
  'GF409', '후기가 남아 있으면 확인 없이 방문 취소 불가');

reset role;
select tests_support.eq(
  (select count(*) from public.restaurant_reviews rv
    where rv.restaurant_id = tests_support.get('restaurant1')::uuid)::bigint,
  2::bigint, '확인 없는 방문 취소 시도는 후기를 지우지 않는다');
select tests_support.eq(
  (select r.status from public.restaurants r where r.id = tests_support.get('restaurant1')::uuid),
  'visited', '확인 없는 방문 취소 시도는 상태도 바꾸지 않는다');

-- 확인된 요청은 후기 삭제와 상태 변경을 함께 처리한다.
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

do $do$
declare v_result jsonb;
begin
  v_result := public.set_restaurant_status(tests_support.get('restaurant1')::uuid,
                'wishlist', null, true, 2, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'deletedReviewCount')::integer, 2,
    '확인된 방문 취소는 후기 2건을 함께 지운다');
  perform tests_support.eq(v_result ->> 'status', 'wishlist', '상태가 wishlist로 바뀐다');
end;
$do$;

reset role;
select tests_support.eq(
  (select count(*) from public.restaurant_reviews rv
    where rv.restaurant_id = tests_support.get('restaurant1')::uuid)::bigint,
  0::bigint, '후기가 남지 않는다');
select tests_support.ok(
  (select r.visited_date is null from public.restaurants r
    where r.id = tests_support.get('restaurant1')::uuid),
  'wishlist로 돌아가면 방문일이 비워진다');

-- ---------------------------------------------------------------------------
-- 프로필
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare v_result jsonb;
begin
  perform tests_support.expect_error(
    $q$select public.update_profile('', 1, gen_random_uuid())$q$,
    'GF422', '빈 닉네임 거부');
  perform tests_support.expect_error(
    $q$select public.update_profile('정상닉네임', 99, gen_random_uuid())$q$,
    'GF409', '프로필 버전 불일치는 CONFLICT');
  v_result := public.update_profile('새 닉네임', 1, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 2, '프로필 버전 2');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 추억 삭제
-- ---------------------------------------------------------------------------
do $do$
declare v_result jsonb;
begin
  perform tests_support.expect_error(
    format($q$select public.delete_memory(%L, 1, gen_random_uuid())$q$, tests_support.get('memory1')),
    'GF409', '버전 불일치 삭제는 CONFLICT');
  v_result := public.delete_memory(tests_support.get('memory1')::uuid, 3, gen_random_uuid());
  perform tests_support.eq(jsonb_array_length(v_result -> 'detachedAssets'), 2,
    '삭제 시 연결 사진 2장이 정리 대상');
end;
$do$;

reset role;
select tests_support.eq(
  (select count(*) from public.memories)::bigint, 0::bigint, '추억이 삭제된다');
select tests_support.eq(
  (select count(*) from public.memory_photos)::bigint, 0::bigint, '사진 연결도 삭제된다');
select tests_support.eq(
  (select count(*) from public.assets a where a.state = 'deleting')::bigint, 4::bigint,
  '정리 대상 파일 4개(사진 3 + 이전 커버 1)');

-- 운영 정리 함수
select tests_support.eq(
  (select app_private.purge_deleted_assets(
     array(select a.id from public.assets a where a.state = 'deleting')))::integer,
  4, '정리 함수가 메타데이터 4건을 제거한다');

reset role;
rollback;

\echo '50_mutations.sql 완료 (모든 변경 롤백)'
