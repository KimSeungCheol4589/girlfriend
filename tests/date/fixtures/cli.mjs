#!/usr/bin/env node
/**
 * DATE-001 E2E 픽스처 준비·정리 — 로컬 Supabase 전용.
 *
 *   node tests/date/fixtures/cli.mjs setup
 *   node tests/date/fixtures/cli.mjs teardown
 *   node tests/date/fixtures/cli.mjs status
 *
 * 네임스페이스: 합성 계정 `date-e2e-{a,b,c}@test.invalid`만 만들고 지운다.
 *   - AUTH(`auth-e2e-*`)·MEM·FOOD(`food001-*`)·WISH(`wish-e2e-*`) 픽스처 계정은 읽지도 지우지도 않는다.
 *     접두사는 코드에 고정돼 있고 `AUTH_TEST_EMAIL_PREFIX` 환경 변수를 따르지 않는다.
 *   - 인증 픽스처의 안전장치(loopback 주소만, `.invalid` 도메인만, production 금지)를 그대로 쓴다
 *     (`tests/auth/fixtures/*.mjs`를 읽기 전용으로 가져온다).
 *   - 비밀번호는 실행마다 새로 만들고 `.agent-runtime/date-e2e/accounts.json`(Git 제외, 0600)에만 둔다.
 *   - 키·비밀번호·초대 토큰은 어떤 출력에도 넣지 않는다.
 *   - 컨테이너를 만들거나 지우거나 재시작하지 않는다. 이미 떠 있는 DB 컨테이너에서 psql만 쓴다.
 *
 * setup이 만드는 상태
 *   A(date-e2e-a): 공간 생성 → B 초대 → B(date-e2e-b) 수락 → 두 사람 공간
 *   C(date-e2e-c): 별도 공간(외부 계정 역할)
 *   setup은 먼저 date-e2e 계정의 공간·요청 기록을 지워 매 실행을 같은 출발점에서 시작한다.
 *   (공간을 지우면 그 공간의 추억·일정·위시·연결도 cascade로 함께 사라진다.)
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deleteUserByEmail, ensureUser, findUserByEmail } from '../../auth/fixtures/admin-api.mjs';
import {
  FixtureError,
  fail,
  generatePassword,
  isSyntheticEmail,
  readFixtureEnv,
  syntheticEmail,
} from '../../auth/fixtures/env.mjs';
import {
  canRunSql,
  grantBootstrapCreator,
  purgeSyntheticData,
  revokeBootstrapCreator,
  runSql,
} from '../../auth/fixtures/sql.mjs';

/** 이 스위트 전용 접두사. 바꾸지 않는다. */
export const DATE_PREFIX = 'date-e2e';
export const DATE_ACCOUNT_KEYS = /** @type {const} */ (['a', 'b', 'c']);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const ACCOUNTS_PATH = join(REPO_ROOT, '.agent-runtime', 'date-e2e', 'accounts.json');

function dateEmail(key) {
  const email = syntheticEmail(DATE_PREFIX, key);
  // 방어: 접두사가 바뀌어 다른 스위트 계정을 건드리는 일이 없게 한다.
  if (!email.startsWith(`${DATE_PREFIX}-`) || !isSyntheticEmail(email)) {
    fail('DATE-001 합성 계정만 다룹니다.');
  }
  return email;
}

function saveAccounts(accounts) {
  if (!ACCOUNTS_PATH.includes('.agent-runtime')) {
    fail('계정 정보는 .agent-runtime 아래에만 저장합니다.');
  }
  mkdirSync(dirname(ACCOUNTS_PATH), { recursive: true });
  writeFileSync(ACCOUNTS_PATH, `${JSON.stringify({ accounts }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function loadAccounts() {
  try {
    return JSON.parse(readFileSync(ACCOUNTS_PATH, 'utf8'))?.accounts ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 사용자 세션으로 호출 (공개 키 + 사용자 JWT). 응답 본문은 출력하지 않는다.
// ---------------------------------------------------------------------------

async function signIn(config, email, password) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) fail(`로그인 실패: ${email} → HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload?.access_token !== 'string') fail(`로그인 응답 형식 오류: ${email}`);
  return payload.access_token;
}

async function rpc(config, token, fn, args) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    // SQLSTATE만 남긴다. 메시지·DETAIL·토큰은 출력하지 않는다.
    fail(`${fn} 실패: HTTP ${response.status} code=${body?.code ?? 'unknown'}`);
  }
  return body;
}

async function selectRows(config, token, path) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) fail(`조회 실패: ${path.split('?')[0]} → HTTP ${response.status}`);
  return response.json();
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

function requireSql(config) {
  if (!canRunSql(config)) {
    fail(
      'AUTH_TEST_DB_CONTAINER가 필요합니다. 공간 생성 허용 목록 등록과 date-e2e 데이터 초기화를 로컬 DB 컨테이너의 psql로 합니다.',
    );
  }
}

function checkSql(result, label) {
  if (!result.ok) fail(`${label} 실패(${result.reason})`);
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * 허용 목록에 date-e2e 계정이 남아 있지 않은지 DB에서 다시 확인한다.
 * 남아 있으면 psql이 예외로 끝나 ok=false가 된다(출력 파싱에 기대지 않는다).
 */
function verifyBootstrapRemoved(config, emails) {
  const list = emails.map(sqlLiteral).join(', ');
  return runSql(
    config,
    `do $$ begin
       if exists (select 1 from app_private.bootstrap_creators where email in (${list})) then
         raise exception 'date-e2e 계정이 공간 생성 허용 목록에 남아 있다';
       end if;
     end $$;`,
  );
}

/** date-e2e 계정의 공간·요청 기록이 남아 있지 않은지 확인한다. */
function verifyDataPurged(config, emails) {
  const list = emails.map(sqlLiteral).join(', ');
  return runSql(
    config,
    `do $$ begin
       if exists (select 1 from public.space_members m join auth.users u on u.id = m.user_id
                   where lower(u.email) in (${list}))
          or exists (select 1 from public.spaces s join auth.users u on u.id = s.created_by
                      where lower(u.email) in (${list}))
          or exists (select 1 from public.calendar_events e join auth.users u on u.id = e.created_by
                      where lower(u.email) in (${list}))
          or exists (select 1 from public.mutation_requests r join auth.users u on u.id = r.user_id
                      where lower(u.email) in (${list})) then
         raise exception 'date-e2e 공간·기록이 남아 있다';
       end if;
     end $$;`,
  );
}

/** 허용 목록에서 A·C를 빼고 실제로 빠졌는지 확인한다. 실패하면 이유 목록을 돌려준다. */
function removeBootstrap(config) {
  const problems = [];
  const creators = [dateEmail('a'), dateEmail('c')];
  for (const email of creators) {
    const result = revokeBootstrapCreator(config, email);
    if (!result.ok) problems.push(`허용 목록 제거 실패(${email}, ${result.reason})`);
  }
  const verified = verifyBootstrapRemoved(config, creators);
  if (!verified.ok) problems.push(`허용 목록 제거 확인 실패(${verified.reason})`);
  return problems;
}

async function setup(config) {
  if (config.anonKey === '') fail('AUTH_TEST_ANON_KEY(공개 키)가 필요합니다.');
  requireSql(config);

  const emails = DATE_ACCOUNT_KEYS.map(dateEmail);

  // 매 실행을 같은 출발점에서: date-e2e 계정의 공간(일정·위시 포함)과 요청 기록만 지운다.
  // 공간 삭제가 calendar_events·wish_items를 cascade로 지우므로 별도 삭제문이 필요 없다.
  checkSql(purgeSyntheticData(config, emails), 'date-e2e 기존 데이터 정리');
  checkSql(verifyDataPurged(config, emails), 'date-e2e 기존 데이터 정리 확인');

  const accounts = {};
  for (const key of DATE_ACCOUNT_KEYS) {
    const email = dateEmail(key);
    const password = generatePassword();
    const userId = await ensureUser(config, email, password);
    accounts[key] = { email, password, userId };
    console.log(`계정 준비: ${email}`);
  }
  saveAccounts(accounts);
  console.log(`계정 정보 저장: ${ACCOUNTS_PATH} (Git 제외 경로, 비밀번호는 출력하지 않습니다)`);

  // A·C만 잠시 첫 공간 생성 허용 목록에 넣고, 공간을 만든 뒤 바로 뺀다.
  let setupError = null;
  try {
    checkSql(grantBootstrapCreator(config, accounts.a.email), '허용 목록 등록(A)');
    checkSql(grantBootstrapCreator(config, accounts.c.email), '허용 목록 등록(C)');
    const tokenA = await signIn(config, accounts.a.email, accounts.a.password);
    await rpc(config, tokenA, 'create_space', {
      p_name: 'CAL001 캘린더 공간',
      p_introduction: '',
      p_relationship_start_date: null,
      p_request_id: randomUUID(),
    });
    const invite = await rpc(config, tokenA, 'create_invite', {
      p_target_email: accounts.b.email,
      p_request_id: randomUUID(),
    });
    const token = typeof invite?.token === 'string' ? invite.token : null;
    if (!token) fail('초대 토큰을 받지 못했습니다.');

    const tokenB = await signIn(config, accounts.b.email, accounts.b.password);
    await rpc(config, tokenB, 'accept_invite', { p_token: token, p_request_id: randomUUID() });

    const tokenC = await signIn(config, accounts.c.email, accounts.c.password);
    await rpc(config, tokenC, 'create_space', {
      p_name: 'CAL001 외부 공간',
      p_introduction: '',
      p_relationship_start_date: null,
      p_request_id: randomUUID(),
    });

    const members = await selectRows(config, tokenA, 'space_members?select=user_id');
    if (!Array.isArray(members) || members.length !== 2) fail('A 공간 구성원이 두 명이 아닙니다.');
    console.log('공간 준비: A·B 공유 공간, C 별도 공간');
  } catch (error) {
    setupError = error;
  }

  // 성공·실패와 관계없이 허용 목록을 되돌리고, 되돌리기 결과도 확인한다.
  const problems = removeBootstrap(config);
  if (problems.length === 0) {
    console.log('공간 생성 허용 목록에서 A·C 제거 확인');
  } else {
    for (const problem of problems) console.error(problem);
  }

  // 원래 오류를 우선 보고한다. 허용 목록 정리 실패도 성공으로 넘어가지 않는다.
  if (setupError) throw setupError;
  if (problems.length > 0) fail('setup 뒤 허용 목록 정리를 확인하지 못했습니다. 직접 확인하세요.');
}

async function teardown(config) {
  const emails = DATE_ACCOUNT_KEYS.map(dateEmail);
  // 정리는 DB 컨테이너 없이는 끝까지 할 수 없다. 반쯤 정리하고 성공이라고 말하지 않는다.
  requireSql(config);

  const problems = [];
  const purge = purgeSyntheticData(config, emails);
  if (!purge.ok) problems.push(`공간·요청 기록 정리 실패(${purge.reason})`);
  const purged = verifyDataPurged(config, emails);
  if (!purged.ok) problems.push(`공간·요청 기록 정리 확인 실패(${purged.reason})`);
  else console.log('date-e2e 공간·기록 정리 확인');

  problems.push(...removeBootstrap(config));

  // 데이터가 남아 있으면 계정 삭제가 FK로 실패하거나 흔적이 남는다. 먼저 멈춘다.
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    fail('teardown 중 정리를 확인하지 못해 계정 삭제 전에 멈췄습니다. 계정 정보 파일은 남겨 둡니다.');
  }

  for (const email of emails) {
    const removed = await deleteUserByEmail(config, email);
    console.log(`${removed ? '삭제' : '없음'}: ${email}`);
  }
  for (const email of emails) {
    if (await findUserByEmail(config, email)) fail(`계정 삭제 확인 실패: ${email}`);
  }
  console.log('date-e2e 계정 삭제 확인');

  rmSync(ACCOUNTS_PATH, { force: true });
  console.log('저장한 계정 정보 파일 삭제');
}

async function status(config) {
  console.log(`계정 정보 파일: ${loadAccounts() ? '있음' : '없음'}`);
  console.log(`DB 컨테이너 지정: ${canRunSql(config) ? '있음' : '없음'}`);
  for (const key of DATE_ACCOUNT_KEYS) {
    const email = dateEmail(key);
    const user = await findUserByEmail(config, email);
    console.log(`${user ? '존재' : '없음'}: ${email}`);
  }
}

async function main() {
  const command = process.argv[2] ?? 'status';
  const config = readFixtureEnv();

  if (command === 'setup') return setup(config);
  if (command === 'teardown') return teardown(config);
  if (command === 'status') return status(config);

  console.error(`알 수 없는 명령: ${command} (setup | teardown | status)`);
  process.exitCode = 2;
}

main().catch((error) => {
  if (error instanceof FixtureError) {
    console.error(`픽스처 중단: ${error.message}`);
  } else {
    console.error(`픽스처 실패: ${error?.name ?? 'Error'}`);
  }
  process.exitCode = 1;
});
