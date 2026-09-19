-- DB-001 테스트 40 — 공간 생성과 초대 (실제 RPC 흐름)
--
-- 확인 대상
--   * 부트스트랩 허용 목록이 비어 있으면 아무도 공간을 만들 수 없다(deny closed).
--   * 허용 판단은 auth.users의 확인된 이메일로만 한다. 클라이언트가 주장할 수 없다.
--   * 초대: 대상 이메일 일치, 24시간 만료, 재사용 금지, 이전 초대 폐기, 정원 2명.
--   * 같은 사용자의 수락 재시도는 성공을 돌려주고 다른 사용자의 재사용은 거부한다.
--   * 초대 응답과 상태 조회에 토큰 해시·원문이 노출되지 않는다.

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\set ua '11111111-1111-4111-8111-111111111111'
\set ub '22222222-2222-4222-8222-222222222222'
\set uc '33333333-3333-4333-8333-333333333333'
\set ud '44444444-4444-4444-8444-444444444444'
\set ue '55555555-5555-4555-8555-555555555555'

select tests_support.make_user(:'ua', 'a.member@test.invalid');
select tests_support.make_user(:'ub', 'b.member@test.invalid');
select tests_support.make_user(:'uc', 'c.outsider@test.invalid');
select tests_support.make_user(:'ud', 'd.unverified@test.invalid', false);
select tests_support.make_user(:'ue', 'e.other@test.invalid');

-- ---------------------------------------------------------------------------
-- 1) 허용 목록이 비어 있으면 생성 불가
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

select tests_support.expect_error(
  $q$select public.create_space('우리 공간', '소개', null, gen_random_uuid())$q$,
  'GF403', '허용 목록이 비면 공간 생성 거부');

-- ---------------------------------------------------------------------------
-- 2) 운영자가 A를 등록하면 A만 생성할 수 있다
-- ---------------------------------------------------------------------------
reset role;
select app_private.add_bootstrap_creator('a.member@test.invalid', 'DB-001 테스트');
select app_private.add_bootstrap_creator('d.unverified@test.invalid', 'DB-001 테스트');

-- 확인되지 않은 이메일은 허용 목록에 있어도 거부한다.
select set_config('request.jwt.claims', tests_support.claims(:'ud'), true);
select set_config('request.jwt.claim.sub', :'ud', true);
set local role authenticated;
select tests_support.expect_error(
  $q$select public.create_space('미확인 공간', '', null, gen_random_uuid())$q$,
  'GF403', '이메일 미확인 계정은 공간 생성 거부');

-- 허용 목록에 없는 계정도 거부한다.
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'uc'), true);
select set_config('request.jwt.claim.sub', :'uc', true);
set local role authenticated;
select tests_support.expect_error(
  $q$select public.create_space('외부 공간', '', null, gen_random_uuid())$q$,
  'GF403', '허용 목록 밖 계정은 공간 생성 거부');

-- A는 생성할 수 있다.
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_request uuid := '99999999-9999-4999-8999-999999999901';
  v_result  jsonb;
  v_again   jsonb;
begin
  v_result := public.create_space('우리 공간', '둘이 쌓는 기록', current_date - 100, v_request);
  perform tests_support.put('space_id', v_result ->> 'spaceId');
  perform tests_support.ok(v_result ? 'spaceId', 'create_space가 spaceId를 반환한다');

  -- 같은 requestId 재시도는 같은 결과를 돌려준다.
  v_again := public.create_space('우리 공간', '둘이 쌓는 기록', current_date - 100, v_request);
  perform tests_support.eq(v_again ->> 'spaceId', v_result ->> 'spaceId',
    '같은 requestId 재시도는 같은 결과를 반환한다');

  -- 같은 키에 다른 입력이면 거부한다.
  perform tests_support.expect_error(
    format($q$select public.create_space('다른 이름', '', null, %L)$q$, v_request),
    'GF409', '같은 requestId에 다른 입력은 거부');

  -- 새 requestId로도 두 번째 공간은 만들 수 없다.
  perform tests_support.expect_error(
    $q$select public.create_space('두 번째 공간', '', null, gen_random_uuid())$q$,
    'GF409', '계정당 공간은 하나');
end;
$do$;

reset role;
select tests_support.eq(
  (select count(*) from public.space_members m where m.space_id = tests_support.get('space_id')::uuid)::bigint,
  1::bigint, '공간 생성 시 본인 소속 1행');
select tests_support.eq(
  (select count(*) from public.space_settings s where s.space_id = tests_support.get('space_id')::uuid)::bigint,
  1::bigint, '공간 생성 시 기본 설정 1행');
select tests_support.ok(
  (select s.theme_key from public.space_settings s
    where s.space_id = tests_support.get('space_id')::uuid) = 'cream',
  '기본 테마는 cream');

-- ---------------------------------------------------------------------------
-- 3) 초대 생성
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_first  jsonb;
  v_second jsonb;
begin
  perform tests_support.expect_error(
    $q$select public.create_invite('형식이상한주소', gen_random_uuid())$q$,
    'GF422', '잘못된 이메일 형식 거부');

  perform tests_support.expect_error(
    $q$select public.create_invite('a.member@test.invalid', gen_random_uuid())$q$,
    'GF422', '자기 자신 초대 거부');

  v_first := public.create_invite('B.Member@TEST.invalid', gen_random_uuid());
  perform tests_support.ok(v_first ? 'token', '초대 응답에 토큰이 한 번 포함된다');
  perform tests_support.ok(length(v_first ->> 'token') >= 40, '토큰 길이 충분');
  perform tests_support.eq(v_first ->> 'targetEmailMasked', 'b*******@test.invalid',
    '응답의 대상 이메일은 마스킹된다');
  perform tests_support.put('token_first', v_first ->> 'token');

  -- 두 번째 초대를 만들면 이전 초대는 폐기된다.
  v_second := public.create_invite('b.member@test.invalid', gen_random_uuid());
  perform tests_support.put('token_second', v_second ->> 'token');
  perform tests_support.ok(v_second ->> 'token' <> v_first ->> 'token', '새 토큰이 발급된다');
end;
$do$;

-- 저장된 것은 해시뿐이다.
reset role;
select tests_support.ok(
  exists (select 1 from public.space_invites i
           where i.token_hash = app_private.hash_token(tests_support.get('token_second'))),
  '초대는 토큰 해시로 저장된다');
select tests_support.ok(
  not exists (select 1 from public.space_invites i
               where i.token_hash = tests_support.get('token_second')),
  '토큰 원문은 저장되지 않는다');
select tests_support.eq(
  (select count(*) from public.space_invites i where i.revoked_at is not null)::bigint,
  1::bigint, '이전 활성 초대는 폐기된다');

-- 상태 조회에는 해시도 원문도 없다.
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

select tests_support.eq((select count(*) from public.list_space_invites())::bigint, 2::bigint,
  '초대 상태 목록 2건');
select tests_support.ok(
  (select bool_and(i.target_email_masked like '%*%') from public.list_space_invites() i),
  '상태 목록의 이메일은 마스킹된다');
select tests_support.ok(
  (select bool_or(i.status = 'revoked') from public.list_space_invites() i),
  '폐기된 초대 상태가 보인다');

-- ---------------------------------------------------------------------------
-- 4) 잘못된 수락 시도
-- ---------------------------------------------------------------------------
-- 폐기된(교체된) 초대
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

select tests_support.expect_error(
  format($q$select public.accept_invite(%L, gen_random_uuid())$q$, tests_support.get('token_first')),
  'GF410', '교체되어 폐기된 초대는 수락 불가');

select tests_support.expect_error(
  $q$select public.accept_invite('00000000000000000000000000000000000000000000', gen_random_uuid())$q$,
  'GF410', '존재하지 않는 토큰 거부');

-- 대상 이메일이 다른 사용자
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'uc'), true);
select set_config('request.jwt.claim.sub', :'uc', true);
set local role authenticated;
select tests_support.expect_error(
  format($q$select public.accept_invite(%L, gen_random_uuid())$q$, tests_support.get('token_second')),
  'GF410', '대상 이메일이 다르면 수락 불가');

-- 이메일 미확인 계정
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ud'), true);
select set_config('request.jwt.claim.sub', :'ud', true);
set local role authenticated;
select tests_support.expect_error(
  format($q$select public.accept_invite(%L, gen_random_uuid())$q$, tests_support.get('token_second')),
  'GF410', '이메일 미확인 계정은 수락 불가');

-- 만료된 초대
reset role;
update public.space_invites set expires_at = now() - interval '1 minute'
 where token_hash = app_private.hash_token(tests_support.get('token_second'));

select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;
select tests_support.expect_error(
  format($q$select public.accept_invite(%L, gen_random_uuid())$q$, tests_support.get('token_second')),
  'GF410', '만료된 초대는 수락 불가');

-- 만료 시각을 되돌린다(24시간 만료 규칙 자체는 아래에서 확인).
reset role;
update public.space_invites set expires_at = now() + interval '1 hour'
 where token_hash = app_private.hash_token(tests_support.get('token_second'));

select tests_support.ok(
  (select i.expires_at from public.space_invites i
    where i.token_hash = app_private.hash_token(tests_support.get('token_first')))
   between now() + interval '23 hours' and now() + interval '25 hours',
  '초대 기본 만료는 24시간');

-- ---------------------------------------------------------------------------
-- 5) 정상 수락과 재시도
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

do $do$
declare
  v_accept jsonb;
  v_retry  jsonb;
begin
  v_accept := public.accept_invite(tests_support.get('token_second'),
                                   '99999999-9999-4999-8999-999999999902');
  perform tests_support.eq(v_accept ->> 'spaceId', tests_support.get('space_id'),
    'B가 초대를 수락해 같은 공간에 들어간다');
  perform tests_support.eq(v_accept ->> 'alreadyAccepted', 'false', '첫 수락은 신규 처리');

  -- 같은 requestId 재시도 → 저장된 결과 재생
  v_retry := public.accept_invite(tests_support.get('token_second'),
                                  '99999999-9999-4999-8999-999999999902');
  perform tests_support.eq(v_retry ->> 'spaceId', tests_support.get('space_id'),
    '같은 requestId 재시도는 같은 결과');

  -- 다른 requestId로 같은 사용자가 다시 수락 → 기존 성공 반환
  v_retry := public.accept_invite(tests_support.get('token_second'), gen_random_uuid());
  perform tests_support.eq(v_retry ->> 'alreadyAccepted', 'true',
    '같은 사용자의 재수락은 기존 성공을 반환');
end;
$do$;

reset role;
select tests_support.eq(
  (select count(*) from public.space_members m where m.space_id = tests_support.get('space_id')::uuid)::bigint,
  2::bigint, '구성원 2명');

-- ---------------------------------------------------------------------------
-- 6) 사용된 초대 재사용과 정원 초과
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'uc'), true);
select set_config('request.jwt.claim.sub', :'uc', true);
set local role authenticated;
select tests_support.expect_error(
  format($q$select public.accept_invite(%L, gen_random_uuid())$q$, tests_support.get('token_second')),
  'GF410', '다른 사용자의 초대 재사용 거부');

-- 정원이 찼으면 새 초대를 만들 수 없다.
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;
select tests_support.expect_error(
  $q$select public.create_invite('c.outsider@test.invalid', gen_random_uuid())$q$,
  'GF411', '정원이 차면 초대 생성 거부');

-- 정원이 찬 뒤 남아 있던 초대로는 수락할 수 없다.
reset role;
insert into public.space_invites (space_id, invited_by, token_hash, target_email, expires_at)
values (tests_support.get('space_id')::uuid, :'ua',
        app_private.hash_token('leftover-token-0123456789012345678901234567890123456789'),
        'e.other@test.invalid', now() + interval '1 hour');

select set_config('request.jwt.claims', tests_support.claims(:'ue'), true);
select set_config('request.jwt.claim.sub', :'ue', true);
set local role authenticated;
select tests_support.expect_error(
  $q$select public.accept_invite('leftover-token-0123456789012345678901234567890123456789',
                                 gen_random_uuid())$q$,
  'GF411', '정원이 찬 공간은 남은 초대로도 들어갈 수 없다');

-- ---------------------------------------------------------------------------
-- 7) 이미 다른 공간 소속인 사용자
-- ---------------------------------------------------------------------------
reset role;
select tests_support.make_profile(:'uc', '씨이');
select tests_support.make_space('bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2', :'uc', '외부 공간');
insert into public.space_invites (space_id, invited_by, token_hash, target_email, expires_at)
values ('bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2', :'uc',
        app_private.hash_token('other-space-token-01234567890123456789012345678901'),
        'b.member@test.invalid', now() + interval '1 hour');

select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;
select tests_support.expect_error(
  $q$select public.accept_invite('other-space-token-01234567890123456789012345678901',
                                 gen_random_uuid())$q$,
  'GF409', '이미 다른 공간 소속이면 수락 거부');

reset role;
rollback;

\echo '40_space_and_invites.sql 완료 (모든 변경 롤백)'
