-- DB-001 테스트 70 — 비공개 버킷과 storage.objects 정책
--
-- 파일 본문(객체) 접근이 assets 메타데이터와 같은 규칙으로 막히는지 확인한다.
-- 실제 사진은 쓰지 않는다. storage.objects의 **메타데이터 행만** 만들어 정책을 검증한다.
--
-- 확인 대상
--   * 임의 경로·남의 경로·다른 공간 경로로는 올릴 수 없다(생성 경로와 정확히 일치해야 한다).
--   * pending이 아닌 asset 경로로는 올릴 수 없다.
--   * 상대 구성원에게는 ready + 실제 첨부된 파일만 보인다. 대기·미첨부·삭제 예정은 안 보인다.
--   * 외부 계정과 비로그인은 아무것도 보지 못한다.
--   * 덮어쓰기(UPDATE)와 사용자 삭제(DELETE)는 불가능하다.

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\set ua '11111111-1111-4111-8111-111111111111'
\set ub '22222222-2222-4222-8222-222222222222'
\set uc '33333333-3333-4333-8333-333333333333'
\set s1 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
\set s2 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
\set mem1 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
\set apending 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
\set aunattached 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
\set aattached 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'
\set acover 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4'
\set adeleting 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
\set apending2 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6'
\set aother 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7'

-- 버킷이 준비돼 있어야 한다.
select tests_support.ok(
  exists (select 1 from storage.buckets b where b.id = 'space-assets' and b.public = false),
  'space-assets 비공개 버킷이 있다');
select tests_support.eq(
  (select count(*) from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname like 'space_assets_%')::bigint,
  2::bigint, 'space_assets 정책은 SELECT/INSERT 2개뿐이다');

-- ---------------------------------------------------------------------------
-- 픽스처
-- ---------------------------------------------------------------------------
select tests_support.make_user(:'ua', 'a.member@test.invalid');
select tests_support.make_user(:'ub', 'b.member@test.invalid');
select tests_support.make_user(:'uc', 'c.outsider@test.invalid');
select tests_support.make_profile(:'ua', '에이');
select tests_support.make_profile(:'ub', '비이');
select tests_support.make_profile(:'uc', '씨이');
select tests_support.make_space(:'s1', :'ua', '우리 공간');
select tests_support.add_member(:'s1', :'ub');
select tests_support.make_space(:'s2', :'uc', '외부 공간');

select tests_support.make_memory(:'mem1', :'s1', :'ua', '첫 추억');
select tests_support.make_asset(:'apending',    :'s1', :'ua', 'memory', 'pending');
select tests_support.make_asset(:'aunattached', :'s1', :'ua', 'memory', 'ready');
select tests_support.make_asset(:'aattached',   :'s1', :'ua', 'memory', 'ready');
select tests_support.make_asset(:'acover',      :'s1', :'ua', 'cover',  'ready');
select tests_support.make_asset(:'adeleting',   :'s1', :'ua', 'memory', 'ready');
select tests_support.make_asset(:'apending2',   :'s1', :'ua', 'memory', 'pending');
select tests_support.make_asset(:'aother',      :'s2', :'uc', 'memory', 'pending');

insert into public.memory_photos (memory_id, space_id, asset_id, sort_order)
values (:'mem1', :'s1', :'aattached', 0);
update public.space_settings set cover_asset_id = :'acover', version = version + 1
 where space_id = :'s1';
update public.assets set state = 'deleting' where id = :'adeleting';
set constraints all immediate;
set constraints all deferred;

-- 객체 메타데이터 행(파일 본문 없음). apending2와 aother는 일부러 만들지 않는다.
insert into storage.objects (id, bucket_id, name, owner)
select gen_random_uuid(), 'space-assets', a.object_path, a.uploader_id
  from public.assets a
 where a.id in (:'apending', :'aunattached', :'aattached', :'acover', :'adeleting');

-- 모든 storage.objects 조회·변경·판정은 이 파일의 픽스처 공간 경로(:s1/…, :s2/…)로만 한정한다.
-- 같은 로컬 DB의 space-assets 버킷에는 다른 작업(MEM·E2E)의 합성 객체가 있을 수 있다.
-- 객체 경로는 생성 열 `space_id/asset_id.ext`이므로 공간 ID 접두사로 픽스처 객체만 고를 수 있다.
select tests_support.eq(
  (select count(*) from storage.objects o
    where o.bucket_id = 'space-assets'
      and (o.name like (:'s1' || '/%') or o.name like (:'s2' || '/%')))::bigint,
  5::bigint, '객체 메타데이터 5건 준비');

-- 경로 문자열을 나중 검증에 쓰기 위해 저장한다.
select tests_support.put('path_pending',    (select a.object_path from public.assets a where a.id = :'apending'));
select tests_support.put('path_unattached', (select a.object_path from public.assets a where a.id = :'aunattached'));
select tests_support.put('path_attached',   (select a.object_path from public.assets a where a.id = :'aattached'));
select tests_support.put('path_cover',      (select a.object_path from public.assets a where a.id = :'acover'));
select tests_support.put('path_deleting',   (select a.object_path from public.assets a where a.id = :'adeleting'));
select tests_support.put('path_pending2',   (select a.object_path from public.assets a where a.id = :'apending2'));
select tests_support.put('path_other',      (select a.object_path from public.assets a where a.id = :'aother'));

-- ---------------------------------------------------------------------------
-- 비로그인
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select tests_support.expect_no_rows(
  $q$select id from storage.objects
      where bucket_id = 'space-assets'
        and (name like 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1/%'
             or name like 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2/%')$q$,
  'anon은 버킷 객체를 볼 수 없다');

select tests_support.expect_error(
  $q$insert into storage.objects (id, bucket_id, name)
     values (gen_random_uuid(), 'space-assets', 'anon/evil.webp')$q$,
  '42501', 'anon은 객체를 올릴 수 없다');

-- ---------------------------------------------------------------------------
-- 업로더 A
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

select tests_support.eq(
  (select count(*) from storage.objects o
    where o.bucket_id = 'space-assets' and o.name like (:'s1' || '/%'))::bigint,
  4::bigint, 'A는 자기 파일 4건을 본다(deleting 제외)');

select tests_support.ok(
  not exists (select 1 from storage.objects o
               where o.bucket_id = 'space-assets' and o.name = tests_support.get('path_deleting')),
  '삭제 예정 파일은 업로더에게도 열리지 않는다');

-- 정확한 생성 경로 + pending 상태 → 허용
select tests_support.expect_not_denied(
  format($q$insert into storage.objects (id, bucket_id, name, owner)
            values (gen_random_uuid(), 'space-assets', %L, %L)$q$,
         tests_support.get('path_pending2'), :'ua'),
  'A는 자기 pending 파일의 정확한 경로에 올릴 수 있다');

-- 임의 경로 → 거부
select tests_support.expect_error(
  $q$insert into storage.objects (id, bucket_id, name)
     values (gen_random_uuid(), 'space-assets', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1/evil.webp')$q$,
  '42501', '임의 경로 업로드 거부');

select tests_support.expect_error(
  $q$insert into storage.objects (id, bucket_id, name)
     values (gen_random_uuid(), 'space-assets', 'evil.webp')$q$,
  '42501', '루트 임의 파일 업로드 거부');

-- 다른 공간 경로 → 거부
select tests_support.expect_error(
  format($q$insert into storage.objects (id, bucket_id, name)
            values (gen_random_uuid(), 'space-assets', %L)$q$, tests_support.get('path_other')),
  '42501', '다른 공간 경로 업로드 거부');

-- 이미 ready인 asset 경로 → 거부(덮어쓰기 우회 차단)
select tests_support.expect_error(
  format($q$insert into storage.objects (id, bucket_id, name)
            values (gen_random_uuid(), 'space-assets', %L)$q$, tests_support.get('path_unattached')),
  '42501', 'pending이 아닌 경로 업로드 거부');

-- 덮어쓰기와 삭제
do $do$
declare v_state text; v_count integer := -1;
begin
  begin
    -- 픽스처 공간 객체만 대상으로 한다(다른 작업의 객체를 건드리지 않는다).
    update storage.objects set owner = owner
     where bucket_id = 'space-assets' and name like 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1/%';
    get diagnostics v_count = row_count;
  exception when others then
    v_state := sqlstate;
  end;
  perform tests_support.ok(v_state = '42501' or v_count = 0, '로그인 사용자는 객체를 덮어쓸 수 없다');
end;
$do$;

do $do$
declare v_state text; v_count integer := -1;
begin
  begin
    delete from storage.objects
     where bucket_id = 'space-assets' and name like 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1/%';
    get diagnostics v_count = row_count;
  exception when others then
    v_state := sqlstate;
  end;
  perform tests_support.ok(v_state = '42501' or v_count = 0, '로그인 사용자는 객체를 지울 수 없다');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 상대 구성원 B
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

select tests_support.eq(
  (select count(*) from storage.objects o
    where o.bucket_id = 'space-assets' and o.name like (:'s1' || '/%'))::bigint,
  2::bigint, 'B에게는 첨부된 사진과 커버 2건만 보인다');

select tests_support.ok(
  exists (select 1 from storage.objects o where o.name = tests_support.get('path_attached')),
  'B는 첨부된 사진을 읽을 수 있다');
select tests_support.ok(
  exists (select 1 from storage.objects o where o.name = tests_support.get('path_cover')),
  'B는 커버를 읽을 수 있다');
select tests_support.ok(
  not exists (select 1 from storage.objects o where o.name = tests_support.get('path_pending')),
  'B는 상대의 대기 파일을 읽을 수 없다');
select tests_support.ok(
  not exists (select 1 from storage.objects o where o.name = tests_support.get('path_unattached')),
  'B는 상대의 미첨부 파일을 읽을 수 없다');
select tests_support.ok(
  not exists (select 1 from storage.objects o where o.name = tests_support.get('path_deleting')),
  'B는 삭제 예정 파일을 읽을 수 없다');

-- B가 A의 pending 경로에 올릴 수 없다.
select tests_support.expect_error(
  format($q$insert into storage.objects (id, bucket_id, name)
            values (gen_random_uuid(), 'space-assets', %L)$q$, tests_support.get('path_pending')),
  '42501', 'B는 상대의 pending 경로에 올릴 수 없다');

-- ---------------------------------------------------------------------------
-- 외부 계정 C
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'uc'), true);
select set_config('request.jwt.claim.sub', :'uc', true);
set local role authenticated;

select tests_support.eq(
  (select count(*) from storage.objects o
    where o.bucket_id = 'space-assets' and o.name like (:'s1' || '/%'))::bigint,
  0::bigint, 'C에게는 남의 공간 객체가 보이지 않는다');

select tests_support.expect_error(
  format($q$insert into storage.objects (id, bucket_id, name)
            values (gen_random_uuid(), 'space-assets', %L)$q$, tests_support.get('path_attached')),
  '42501', 'C는 남의 공간 경로에 올릴 수 없다');

reset role;
rollback;

\echo '70_storage_policies.sql 완료 (모든 변경 롤백)'
