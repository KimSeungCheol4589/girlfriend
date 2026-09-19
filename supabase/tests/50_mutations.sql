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

-- 준비는 로그인 사용자가 한다.
do $do$
declare
  v_prep   jsonb;
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
  perform tests_support.eq(v_prep ->> 'bucket', 'space-assets', '비공개 버킷 이름을 알려준다');

  v_prep := public.prepare_upload('memory', 'image/jpeg', 2048, gen_random_uuid());
  perform tests_support.put('asset2', v_prep ->> 'assetId');
  v_prep := public.prepare_upload('memory', 'image/png', 2048, gen_random_uuid());
  perform tests_support.put('asset3', v_prep ->> 'assetId');
  v_prep := public.prepare_upload('cover', 'image/webp', 4096, gen_random_uuid());
  perform tests_support.put('cover1', v_prep ->> 'assetId');
  v_prep := public.prepare_upload('cover', 'image/webp', 4096, gen_random_uuid());
  perform tests_support.put('cover2', v_prep ->> 'assetId');

  -- 검토 지적 D2용: A가 올렸지만 어디에도 붙이지 않을 파일들
  v_prep := public.prepare_upload('memory', 'image/webp', 2048, gen_random_uuid());
  perform tests_support.put('asset4', v_prep ->> 'assetId');   -- ready, 미첨부
  v_prep := public.prepare_upload('memory', 'image/webp', 2048, gen_random_uuid());
  perform tests_support.put('asset5', v_prep ->> 'assetId');   -- pending 유지
  v_prep := public.prepare_upload('cover', 'image/webp', 4096, gen_random_uuid());
  perform tests_support.put('cover3', v_prep ->> 'assetId');   -- ready, 미사용 커버
end;
$do$;

-- ---------------------------------------------------------------------------
-- 확정(ready 전환)은 신뢰된 서버 역할만 할 수 있다
-- ---------------------------------------------------------------------------
-- 로그인 사용자는 서명 자체를 실행할 수 없다. Server Action 관례가 아니라 권한으로 막는다.
select tests_support.expect_error(
  format($q$select public.finalize_upload(%L, %L, 2048, 1200, 800, 'image/webp', gen_random_uuid())$q$,
         tests_support.get('asset1'), :'ua'),
  '42501', '로그인 사용자는 finalize_upload를 직접 호출할 수 없다');

-- 예전 서명(사용자 호출 가능)이 남아 있지 않은지도 확인한다.
select tests_support.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'finalize_upload'
       and pg_get_function_identity_arguments(p.oid) = 'uuid, bigint, integer, integer, uuid'),
  '예전 finalize_upload 서명이 제거됐다');

-- 상대 구성원은 남의 파일을 폐기할 수 없다(폐기는 계속 사용자 경로다).
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;
select tests_support.expect_error(
  format($q$select public.discard_upload(%L, gen_random_uuid())$q$, tests_support.get('asset2')),
  'GF404', '상대 구성원은 남의 파일을 폐기할 수 없다');

-- 신뢰된 서버 역할로 전환한다. 최종 사용자 클레임을 지운다.
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;

do $do$
declare
  v_final jsonb;
  v_again jsonb;
  v_a1 uuid := tests_support.get('asset1')::uuid;
begin
  -- 위조 방지: 실제 업로더가 아닌 사람을 행위자로 보내면 존재 여부를 알리지 않는다.
  perform tests_support.expect_error(
    format($q$select public.finalize_upload(%L, '22222222-2222-4222-8222-222222222222',
             2048, 800, 600, 'image/webp', gen_random_uuid())$q$, v_a1),
    'GF404', '업로더가 일치하지 않으면 확정 거부');

  -- 위조 방지: 존재하지 않는 행위자
  perform tests_support.expect_error(
    format($q$select public.finalize_upload(%L, '99999999-9999-4999-8999-999999999999',
             2048, 800, 600, 'image/webp', gen_random_uuid())$q$, v_a1),
    'GF404', '없는 사용자를 행위자로 보내면 거부');

  -- 위조 방지: 선언한 MIME과 다른 유형을 확인값으로 보고
  perform tests_support.expect_error(
    format($q$select public.finalize_upload(%L, '11111111-1111-4111-8111-111111111111',
             2048, 800, 600, 'image/png', gen_random_uuid())$q$, v_a1),
    'GF412', '확인된 MIME이 선언값과 다르면 거부');

  -- 위조 방지: 상한을 넘는 크기·픽셀
  perform tests_support.expect_error(
    format($q$select public.finalize_upload(%L, '11111111-1111-4111-8111-111111111111',
             10485761, 800, 600, 'image/webp', gen_random_uuid())$q$, v_a1),
    'GF412', '크기 상한 초과 거부');
  perform tests_support.expect_error(
    format($q$select public.finalize_upload(%L, '11111111-1111-4111-8111-111111111111',
             2048, 99999, 99999, 'image/webp', gen_random_uuid())$q$, v_a1),
    'GF412', '픽셀 상한 초과 거부');

  -- 정상 확정
  v_final := public.finalize_upload(v_a1, '11111111-1111-4111-8111-111111111111',
                                    2048, 1200, 800, 'image/webp', gen_random_uuid());
  perform tests_support.eq(v_final ->> 'state', 'ready', '신뢰된 역할의 확정은 ready로 바꾼다');
  perform tests_support.ok(v_final ? 'expiresAt', '신규 확정 응답에 expiresAt이 있다');

  -- 검토 지적 D8: 이미 ready인 asset을 **새 requestId**로 다시 확정해도
  -- 신규 성공과 완전히 같은 모양이어야 한다(expiresAt은 저장된 값 그대로).
  v_again := public.finalize_upload(v_a1, '11111111-1111-4111-8111-111111111111',
                                    2048, 1200, 800, 'image/webp', gen_random_uuid());
  perform tests_support.eq(v_again, v_final,
    '이미 ready인 자산을 새 requestId로 재확정해도 응답이 동일하다');
  perform tests_support.eq(
    (select a.expires_at from public.assets a where a.id = v_a1),
    (v_final ->> 'expiresAt')::timestamptz,
    '재확정이 저장된 만료 시각을 바꾸지 않는다');

  perform public.finalize_upload(tests_support.get('asset2')::uuid,
    '11111111-1111-4111-8111-111111111111', 2048, 800, 600, 'image/jpeg', gen_random_uuid());
  perform public.finalize_upload(tests_support.get('asset3')::uuid,
    '11111111-1111-4111-8111-111111111111', 2048, 800, 600, 'image/png', gen_random_uuid());
  perform public.finalize_upload(tests_support.get('cover1')::uuid,
    '11111111-1111-4111-8111-111111111111', 4096, 1600, 900, 'image/webp', gen_random_uuid());
  perform public.finalize_upload(tests_support.get('cover2')::uuid,
    '11111111-1111-4111-8111-111111111111', 4096, 1600, 900, 'image/webp', gen_random_uuid());
  -- D2용: asset4와 cover3만 확정한다. asset5는 pending으로 남긴다.
  perform public.finalize_upload(tests_support.get('asset4')::uuid,
    '11111111-1111-4111-8111-111111111111', 2048, 800, 600, 'image/webp', gen_random_uuid());
  perform public.finalize_upload(tests_support.get('cover3')::uuid,
    '11111111-1111-4111-8111-111111111111', 4096, 1600, 900, 'image/webp', gen_random_uuid());
end;
$do$;

-- 이중 방어: service_role 권한이더라도 최종 사용자 클레임이 실린 요청은 거부한다.
do $do$
declare v_prep jsonb;
begin
  -- 사용자 세션 클레임을 흉내 낸다(권한은 service_role인 상태).
  perform set_config('request.jwt.claims',
    tests_support.claims('11111111-1111-4111-8111-111111111111'), true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

  perform tests_support.expect_error(
    format($q$select public.finalize_upload(%L, '11111111-1111-4111-8111-111111111111',
             2048, 800, 600, 'image/webp', gen_random_uuid())$q$, tests_support.get('asset1')),
    'GF403', '최종 사용자 세션 컨텍스트에서는 확정할 수 없다');

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$do$;

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

-- 업로더 본인(A)도 이미 연결된 사진이나 삭제 예정 사진은 다시 붙일 수 없다.
-- (업로더 검사를 통과해야 도달하는 코드이므로 A로 확인한다.)
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

select tests_support.expect_error(
  format($q$select public.save_memory(null, '사진 재사용', '', current_date - 1, null,
           array[]::text[], array[%L::uuid], false, 0, gen_random_uuid())$q$,
         tests_support.get('asset1')),
  'GF409', '이미 연결된 사진은 다른 기록에 붙일 수 없다');

select tests_support.expect_error(
  format($q$select public.save_memory(null, '삭제 예정 사진', '', current_date - 1, null,
           array[]::text[], array[%L::uuid], false, 0, gen_random_uuid())$q$,
         tests_support.get('asset2')),
  'GF422', 'deleting 사진은 붙일 수 없다');

-- 검토 지적 D2: 상대가 올린 비공개 파일을 UUID만 알아내 붙일 수 없어야 한다.
-- 존재 여부를 알리지 않기 위해 NOT_FOUND로 통일한다(상태 검사보다 업로더 검사가 먼저다).
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

-- 상대가 올린 파일은 이미 연결됐는지·삭제 예정인지조차 구분되지 않아야 한다.
select tests_support.expect_error(
  format($q$select public.save_memory(null, '남의 연결된 사진', '', current_date - 1, null,
           array[]::text[], array[%L::uuid], false, 0, gen_random_uuid())$q$,
         tests_support.get('asset1')),
  'GF404', 'B에게는 상대의 연결된 사진도 NOT_FOUND로만 보인다');
select tests_support.expect_error(
  format($q$select public.save_memory(null, '남의 미첨부 파일', '', current_date - 1, null,
           array[]::text[], array[%L::uuid], false, 0, gen_random_uuid())$q$,
         tests_support.get('asset4')),
  'GF404', 'B는 A의 ready 미첨부 파일을 붙일 수 없다');

select tests_support.expect_error(
  format($q$select public.save_memory(null, '남의 대기 파일', '', current_date - 1, null,
           array[]::text[], array[%L::uuid], false, 0, gen_random_uuid())$q$,
         tests_support.get('asset5')),
  'GF404', 'B는 A의 pending 파일을 붙일 수 없다(상태도 알리지 않는다)');

reset role;
select tests_support.eq(
  (select a.state from public.assets a where a.id = tests_support.get('asset4')::uuid),
  'ready', '거부된 시도가 A의 파일 상태를 바꾸지 않았다');
select tests_support.ok(
  not exists (select 1 from public.memory_photos p
               where p.asset_id = tests_support.get('asset4')::uuid),
  '거부된 시도가 연결을 만들지 않았다');

select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

-- 검토 지적 D2의 허용 쪽: 이미 이 기록에 붙어 있던 사진은 올린 사람이 아니어도
-- 유지·재정렬할 수 있다(공유 기록이므로). 여기서는 B가 순서를 뒤집는다.
do $do$
declare v_save jsonb;
begin
  v_save := public.save_memory(tests_support.get('memory1')::uuid, '첫 데이트(B 수정)', '',
                               current_date - 3, null, array[]::text[],
                               array[tests_support.get('asset1')::uuid,
                                     tests_support.get('asset3')::uuid],
                               true, 2, gen_random_uuid());
  perform tests_support.eq((v_save ->> 'version')::integer, 3, '상대 구성원도 공유 기록을 수정한다');
  perform tests_support.eq((v_save ->> 'photoCount')::integer, 2, '사진 2장 유지');
  perform tests_support.eq(jsonb_array_length(v_save -> 'detachedAssets'), 0,
    '재정렬만 했으므로 정리 대상이 없다');
end;
$do$;

reset role;
select tests_support.eq(
  (select m.author_id from public.memories m where m.id = tests_support.get('memory1')::uuid),
  :'ua'::uuid, '상대가 수정해도 작성자는 바뀌지 않는다');
select tests_support.eq(
  (select p.sort_order from public.memory_photos p
    where p.memory_id = tests_support.get('memory1')::uuid
      and p.asset_id = tests_support.get('asset1')::uuid), 0,
  'B의 재정렬이 실제로 반영된다(A가 올린 사진이어도)');

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

-- 검토 지적 D2(커버): 새 커버는 올린 사람만 지정할 수 있고,
-- 바뀌지 않는 기존 커버는 두 구성원 모두 그대로 저장할 수 있다.
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

do $do$
declare
  v_result jsonb;
  v_sections jsonb := '[{"key":"pinned","visible":true},
                        {"key":"recentMemories","visible":true},
                        {"key":"wishlist","visible":false}]'::jsonb;
begin
  perform tests_support.expect_error(
    format($q$select public.save_customization('rose', '#8b435a', %L, %L::jsonb, 3, %L)$q$,
           tests_support.get('cover3'), v_sections, gen_random_uuid()),
    'GF404', 'B는 A가 올린 파일을 새 커버로 지정할 수 없다');

  -- 기존 커버(cover2)를 그대로 둔 저장은 허용된다.
  v_result := public.save_customization('sage', '#8b435a',
                tests_support.get('cover2')::uuid, v_sections, 3, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 4,
    'B도 기존 커버를 유지한 채 꾸미기를 저장할 수 있다');
  perform tests_support.eq(v_result ->> 'coverAssetId', tests_support.get('cover2'),
    '커버는 그대로 유지된다');
end;
$do$;

reset role;
select tests_support.eq(
  (select a.state from public.assets a where a.id = tests_support.get('cover3')::uuid),
  'ready', '거부된 커버 시도가 A의 파일을 건드리지 않았다');

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
