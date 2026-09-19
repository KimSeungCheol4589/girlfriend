-- DB-001 테스트 10 — 스키마 무결성
--
-- 실행: docker exec -i <db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/db-001-tests/10_schema_constraints.sql
-- 이 파일은 소유자(postgres)로 제약 자체를 검증한다. 권한·RLS는 20/30번에서 다룬다.
-- 모든 변경은 마지막 ROLLBACK으로 되돌린다.

\set ON_ERROR_STOP on
\timing off

begin;
\ir _helpers.sql

\set ua '11111111-1111-4111-8111-111111111111'
\set ub '22222222-2222-4222-8222-222222222222'
\set s1 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
\set s2 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2'

select tests_support.make_user(:'ua', 'a.member@test.invalid');
select tests_support.make_user(:'ub', 'b.member@test.invalid');
select tests_support.make_profile(:'ua', '에이');
select tests_support.make_profile(:'ub', '비이');
select tests_support.make_space(:'s1', :'ua', '우리 공간');
select tests_support.make_space(:'s2', :'ub', '다른 공간');

-- ---------------------------------------------------------------------------
-- 문자열 길이·형식
-- ---------------------------------------------------------------------------
select tests_support.expect_error(
  format($q$insert into public.spaces (created_by, name) values (%L, '')$q$, :'ua'),
  '23514', '공간 이름 0자 거부');

select tests_support.expect_error(
  format($q$insert into public.spaces (created_by, name) values (%L, repeat('가', 31))$q$, :'ua'),
  '23514', '공간 이름 31자 거부');

select tests_support.expect_error(
  format($q$insert into public.spaces (created_by, name) values (%L, '  앞뒤 공백  ')$q$, :'ua'),
  '23514', '공간 이름 앞뒤 공백 거부');

select tests_support.expect_error(
  format($q$insert into public.profiles (id, nickname) values (%L, repeat('가', 21))$q$,
         gen_random_uuid()),
  null, '닉네임 21자 거부');

-- ---------------------------------------------------------------------------
-- 날짜 규칙 (한국 달력 기준)
-- ---------------------------------------------------------------------------
select tests_support.expect_error(
  format($q$insert into public.spaces (created_by, name, relationship_start_date)
            values (%L, '미래 공간', %L)$q$, :'ua', app_private.kst_today() + 1),
  'GF422', '관계 시작일 미래 거부');

select tests_support.expect_error(
  format($q$insert into public.memories (space_id, author_id, title, memory_date)
            values (%L, %L, '미래 추억', %L)$q$, :'s1', :'ua', app_private.kst_today() + 1),
  'GF422', '추억 날짜 미래 거부');

select tests_support.expect_error(
  format($q$insert into public.restaurants (space_id, created_by, name, status, visited_date)
            values (%L, %L, '미래 방문', 'visited', %L)$q$, :'s1', :'ua', app_private.kst_today() + 1),
  'GF422', '방문일 미래 거부');

-- ---------------------------------------------------------------------------
-- 태그
-- ---------------------------------------------------------------------------
select tests_support.expect_error(
  format($q$insert into public.memories (space_id, author_id, title, memory_date, tags)
            values (%L, %L, '태그 6개', current_date - 1,
                    array['a','b','c','d','e','f'])$q$, :'s1', :'ua'),
  '23514', '태그 6개 거부');

select tests_support.expect_error(
  format($q$insert into public.memories (space_id, author_id, title, memory_date, tags)
            values (%L, %L, '태그 중복', current_date - 1, array['같음','같음'])$q$, :'s1', :'ua'),
  '23514', '태그 중복 거부');

select tests_support.expect_error(
  format($q$insert into public.memories (space_id, author_id, title, memory_date, tags)
            values (%L, %L, '태그 길이', current_date - 1, array[repeat('가', 21)])$q$, :'s1', :'ua'),
  '23514', '태그 21자 거부');

insert into public.memories (space_id, author_id, title, memory_date, tags)
values (:'s1', :'ua', '태그 정상', current_date - 1, array['데이트','봄']);
select tests_support.ok(true, '태그 2개 허용');

-- ---------------------------------------------------------------------------
-- 맛집 상태 / 지도 링크
-- ---------------------------------------------------------------------------
select tests_support.expect_error(
  format($q$insert into public.restaurants (space_id, created_by, name, status)
            values (%L, %L, '방문인데 날짜 없음', 'visited')$q$, :'s1', :'ua'),
  '23514', 'visited인데 방문일 없음 거부');

select tests_support.expect_error(
  format($q$insert into public.restaurants (space_id, created_by, name, status, visited_date)
            values (%L, %L, '위시인데 날짜 있음', 'wishlist', current_date - 1)$q$, :'s1', :'ua'),
  '23514', 'wishlist인데 방문일 있음 거부');

-- 회귀: 지도 링크 제약의 정규식이 반복 횟수 한도(255)를 넘으면
-- map_url이 NULL이 아닌 모든 행에서 SQLSTATE 2201B가 난다. 23514가 나와야 한다.
select tests_support.expect_error(
  format($q$insert into public.restaurants (space_id, created_by, name, map_url)
            values (%L, %L, 'http 링크', 'http://map.naver.com/x')$q$, :'s1', :'ua'),
  '23514', 'http 지도 링크 거부 (2201B 아님)');

select tests_support.expect_error(
  format($q$insert into public.restaurants (space_id, created_by, name, map_url)
            values (%L, %L, '너무 긴 링크', %L)$q$, :'s1', :'ua',
         'https://map.naver.com/' || repeat('a', 500)),
  '23514', '500자 초과 지도 링크 거부');

select tests_support.expect_error(
  format($q$insert into public.restaurants (space_id, created_by, name, map_url)
            values (%L, %L, '공백 포함 링크', 'https://map.naver.com/a b')$q$, :'s1', :'ua'),
  '23514', '공백 포함 지도 링크 거부');

-- 정상 링크는 들어간다(정규식이 실제로 컴파일되는지 확인하는 회귀 테스트).
insert into public.restaurants (space_id, created_by, name, map_url)
values (:'s1', :'ua', '정상 링크', 'https://map.naver.com/p/1');
select tests_support.ok(true, 'HTTPS 지도 링크 저장 (정규식 컴파일 정상)');

-- ---------------------------------------------------------------------------
-- 홈 섹션 JSON
-- ---------------------------------------------------------------------------
select tests_support.ok(
  app_private.is_valid_home_sections(app_private.default_home_sections()),
  '기본 섹션 JSON 유효');

select tests_support.ok(
  not app_private.is_valid_home_sections(
    '[{"key":"pinned","visible":true},{"key":"recentMemories","visible":true}]'::jsonb),
  '섹션 2개 거부');

select tests_support.ok(
  not app_private.is_valid_home_sections(
    '[{"key":"pinned","visible":true},{"key":"pinned","visible":true},{"key":"wishlist","visible":true}]'::jsonb),
  '섹션 키 중복 거부');

select tests_support.ok(
  not app_private.is_valid_home_sections(
    '[{"key":"pinned","visible":true},{"key":"recentMemories","visible":true},{"key":"unknown","visible":true}]'::jsonb),
  '알 수 없는 섹션 키 거부');

select tests_support.ok(
  not app_private.is_valid_home_sections(
    '[{"key":"pinned","visible":true,"extra":1},{"key":"recentMemories","visible":true},{"key":"wishlist","visible":true}]'::jsonb),
  '섹션 추가 필드 거부');

select tests_support.ok(
  not app_private.is_valid_home_sections(
    '[{"key":"pinned","visible":"yes"},{"key":"recentMemories","visible":true},{"key":"wishlist","visible":true}]'::jsonb),
  '섹션 visible 비불린 거부');

select tests_support.expect_error(
  format($q$update public.space_settings set home_sections = '[]'::jsonb, version = version + 1
             where space_id = %L$q$, :'s1'),
  '23514', '빈 섹션 배열 저장 거부');

-- ---------------------------------------------------------------------------
-- 파일 경로 생성 열
-- ---------------------------------------------------------------------------
do $do$
declare
  v_asset uuid := gen_random_uuid();
  v_path  text;
begin
  perform tests_support.make_asset(v_asset, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                   '11111111-1111-4111-8111-111111111111');
  select a.object_path into v_path from public.assets a where a.id = v_asset;
  perform tests_support.eq(
    v_path,
    'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1/' || v_asset::text || '.webp',
    '파일 경로는 space_id/asset_id.ext로 생성된다');
end;
$do$;

select tests_support.expect_error(
  format($q$insert into public.assets (space_id, uploader_id, purpose, mime_type, object_path)
            values (%L, %L, 'memory', 'image/webp', 'other-space/evil.webp')$q$, :'s1', :'ua'),
  '428C9', '파일 경로 직접 지정 거부(생성 열)');

-- ---------------------------------------------------------------------------
-- 공간 간 연결 차단
-- ---------------------------------------------------------------------------
do $do$
declare
  v_mem   uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
begin
  perform tests_support.make_memory(v_mem, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                    '11111111-1111-4111-8111-111111111111');
  -- 다른 공간(s2)의 파일
  perform tests_support.make_asset(v_other, 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
                                   '22222222-2222-4222-8222-222222222222');

  perform tests_support.expect_error(
    format($q$insert into public.memory_photos (memory_id, space_id, asset_id, sort_order)
              values (%L, %L, %L, 0)$q$, v_mem,
           'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', v_other),
    '23503', '다른 공간 파일을 추억에 연결 거부');

  perform tests_support.expect_error(
    format($q$update public.space_settings set cover_asset_id = %L, version = version + 1
               where space_id = %L$q$, v_other, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
    null, '다른 공간 파일을 커버로 지정 거부');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 커버 파일의 목적·상태
-- ---------------------------------------------------------------------------
do $do$
declare
  v_memory_purpose uuid := gen_random_uuid();
  v_pending_cover  uuid := gen_random_uuid();
  v_ready_cover    uuid := gen_random_uuid();
begin
  perform tests_support.make_asset(v_memory_purpose, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                   '11111111-1111-4111-8111-111111111111', 'memory', 'ready');
  perform tests_support.make_asset(v_pending_cover, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                   '11111111-1111-4111-8111-111111111111', 'cover', 'pending');
  perform tests_support.make_asset(v_ready_cover, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                   '11111111-1111-4111-8111-111111111111', 'cover', 'ready');

  perform tests_support.expect_error(
    format($q$update public.space_settings set cover_asset_id = %L, version = version + 1
               where space_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$q$, v_memory_purpose),
    'GF422', '목적이 memory인 파일은 커버가 될 수 없다');

  perform tests_support.expect_error(
    format($q$update public.space_settings set cover_asset_id = %L, version = version + 1
               where space_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$q$, v_pending_cover),
    'GF422', 'pending 파일은 커버가 될 수 없다');

  execute format($q$update public.space_settings set cover_asset_id = %L, version = version + 1
                     where space_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$q$, v_ready_cover);
  perform tests_support.ok(true, 'ready cover 파일은 커버로 지정된다');

  -- 커버로 쓰이는 동안에는 삭제 예정 상태로 바꿀 수 없다.
  perform tests_support.expect_error(
    format($q$update public.assets set state = 'deleting' where id = %L$q$, v_ready_cover),
    'GF409', '연결된 커버 파일은 deleting으로 못 바꾼다');

  -- 참조를 끊은 뒤에는 가능하다.
  execute $q$update public.space_settings set cover_asset_id = null, version = version + 1
              where space_id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$q$;
  execute format($q$update public.assets set state = 'deleting' where id = %L$q$, v_ready_cover);
  perform tests_support.ok(true, '참조 해제 후 deleting 전환 가능');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 사진 개수·순서·상태
-- ---------------------------------------------------------------------------
do $do$
declare
  v_mem   uuid := gen_random_uuid();
  v_asset uuid;
  v_state text;
  i integer;
begin
  perform tests_support.make_memory(v_mem, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                    '11111111-1111-4111-8111-111111111111', '사진 테스트');

  -- 0..9 정상
  for i in 0..9 loop
    v_asset := gen_random_uuid();
    perform tests_support.make_asset(v_asset, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                     '11111111-1111-4111-8111-111111111111');
    insert into public.memory_photos (memory_id, space_id, asset_id, sort_order)
    values (v_mem, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', v_asset, i);
  end loop;
  set constraints all immediate;
  perform tests_support.ok(true, '사진 10장 연결 허용');

  -- 11번째(sort_order 10)는 범위 제약으로 거부
  v_asset := gen_random_uuid();
  perform tests_support.make_asset(v_asset, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                   '11111111-1111-4111-8111-111111111111');
  perform tests_support.expect_error(
    format($q$insert into public.memory_photos (memory_id, space_id, asset_id, sort_order)
              values (%L, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', %L, 10)$q$, v_mem, v_asset),
    '23514', '사진 11번째(sort_order 10) 거부');

  -- 이미 다른 기록에 연결된 파일은 재사용 불가
  declare
    v_mem2  uuid := gen_random_uuid();
    v_first uuid;
  begin
    perform tests_support.make_memory(v_mem2, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                      '11111111-1111-4111-8111-111111111111', '두 번째');
    select p.asset_id into v_first from public.memory_photos p where p.memory_id = v_mem limit 1;
    perform tests_support.expect_error(
      format($q$insert into public.memory_photos (memory_id, space_id, asset_id, sort_order)
                values (%L, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', %L, 0)$q$, v_mem2, v_first),
      '23505', '한 파일을 두 기록에 연결 거부');
  end;
end;
$do$;

-- 순서 빈칸(0,2)은 커밋 시점 검사에서 거부된다.
do $do$
declare
  v_mem   uuid := gen_random_uuid();
  v_a1    uuid := gen_random_uuid();
  v_a2    uuid := gen_random_uuid();
  v_state text;
begin
  perform tests_support.make_memory(v_mem, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                    '11111111-1111-4111-8111-111111111111', '순서 빈칸');
  perform tests_support.make_asset(v_a1, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                   '11111111-1111-4111-8111-111111111111');
  perform tests_support.make_asset(v_a2, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                   '11111111-1111-4111-8111-111111111111');
  begin
    insert into public.memory_photos (memory_id, space_id, asset_id, sort_order)
    values (v_mem, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', v_a1, 0),
           (v_mem, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', v_a2, 2);
    set constraints all immediate;
  exception when others then
    v_state := sqlstate;
  end;
  perform tests_support.eq(v_state, 'GF422', '사진 순서 빈칸은 커밋 검사에서 거부');
end;
$do$;

-- pending 파일은 추억에 연결할 수 없다.
do $do$
declare
  v_mem     uuid := gen_random_uuid();
  v_pending uuid := gen_random_uuid();
begin
  perform tests_support.make_memory(v_mem, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                    '11111111-1111-4111-8111-111111111111', 'pending 연결');
  perform tests_support.make_asset(v_pending, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                   '11111111-1111-4111-8111-111111111111', 'memory', 'pending');
  perform tests_support.expect_error(
    format($q$insert into public.memory_photos (memory_id, space_id, asset_id, sort_order)
              values (%L, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', %L, 0)$q$, v_mem, v_pending),
    'GF422', 'pending 파일 연결 거부');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 불변 열과 버전 규칙
-- ---------------------------------------------------------------------------
do $do$
declare
  v_mem uuid := gen_random_uuid();
begin
  perform tests_support.make_memory(v_mem, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                    '11111111-1111-4111-8111-111111111111', '불변 검사');

  perform tests_support.expect_error(
    format($q$update public.memories set author_id = '22222222-2222-4222-8222-222222222222',
                                          version = version + 1 where id = %L$q$, v_mem),
    'GF422', '작성자 변경 거부');

  perform tests_support.expect_error(
    format($q$update public.memories set space_id = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
                                          version = version + 1 where id = %L$q$, v_mem),
    'GF422', '공간 변경 거부');

  perform tests_support.expect_error(
    format($q$update public.memories set title = '버전 안 올림' where id = %L$q$, v_mem),
    'GF409', '버전 증가 없는 수정 거부');

  perform tests_support.expect_error(
    format($q$update public.memories set title = '버전 점프', version = version + 5 where id = %L$q$, v_mem),
    'GF409', '버전 임의 증가 거부');

  execute format($q$update public.memories set title = '정상 수정', version = version + 1 where id = %L$q$, v_mem);
  perform tests_support.ok(
    (select m.version from public.memories m where m.id = v_mem) = 2,
    '정상 수정 시 버전 2');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 후기 무결성
-- ---------------------------------------------------------------------------
do $do$
declare
  v_wish    uuid := gen_random_uuid();
  v_visited uuid := gen_random_uuid();
begin
  perform tests_support.make_restaurant(v_wish, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                        '11111111-1111-4111-8111-111111111111', 'wishlist');
  perform tests_support.make_restaurant(v_visited, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                        '11111111-1111-4111-8111-111111111111', 'visited');

  perform tests_support.expect_error(
    format($q$insert into public.restaurant_reviews (restaurant_id, space_id, user_id, rating)
              values (%L, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                      '11111111-1111-4111-8111-111111111111', 5)$q$, v_wish),
    'GF409', 'wishlist 맛집에는 후기를 만들 수 없다');

  insert into public.restaurant_reviews (restaurant_id, space_id, user_id, rating, comment)
  values (v_visited, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          '11111111-1111-4111-8111-111111111111', 5, '좋았다');
  perform tests_support.ok(true, 'visited 맛집 후기 생성');

  perform tests_support.expect_error(
    format($q$insert into public.restaurant_reviews (restaurant_id, space_id, user_id, rating)
              values (%L, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                      '11111111-1111-4111-8111-111111111111', 3)$q$, v_visited),
    '23505', '같은 맛집에 같은 사용자의 후기는 하나');

  perform tests_support.expect_error(
    format($q$insert into public.restaurant_reviews (restaurant_id, space_id, user_id, rating)
              values (%L, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                      '22222222-2222-4222-8222-222222222222', 3)$q$, v_visited),
    '23503', '공간 구성원이 아닌 사용자의 후기는 거부');

  perform tests_support.expect_error(
    format($q$insert into public.restaurant_reviews (restaurant_id, space_id, user_id, rating)
              values (%L, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                      '11111111-1111-4111-8111-111111111111', 6)$q$, v_visited),
    null, '별점 6 거부');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 계정당 공간 하나 / 정원
-- ---------------------------------------------------------------------------
select tests_support.expect_error(
  format($q$insert into public.space_members (space_id, user_id) values (%L, %L)$q$, :'s2', :'ua'),
  '23505', '한 계정이 두 공간에 소속될 수 없다');

do $do$
declare
  v_third uuid := gen_random_uuid();
  v_state text;
begin
  perform tests_support.make_user(v_third, 'third@test.invalid');
  perform tests_support.make_profile(v_third, '세번째');
  -- s1에는 이미 ua가 있다. ub는 s2 소속이므로 새 사용자 두 명을 더 넣어 정원을 넘긴다.
  begin
    insert into public.space_members (space_id, user_id)
    values ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', v_third);
    declare
      v_fourth uuid := gen_random_uuid();
    begin
      perform tests_support.make_user(v_fourth, 'fourth@test.invalid');
      perform tests_support.make_profile(v_fourth, '네번째');
      insert into public.space_members (space_id, user_id)
      values ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', v_fourth);
    end;
    set constraints all immediate;
  exception when others then
    v_state := sqlstate;
  end;
  perform tests_support.eq(v_state, 'GF411', '구성원 3명은 정원 트리거에서 거부');
end;
$do$;

rollback;

\echo '10_schema_constraints.sql 완료 (모든 변경 롤백)'
