#!/usr/bin/env node
/**
 * MEM-001 실제 백엔드 테스트 픽스처 — 로컬 전용.
 *
 *   node tests/memories/fixtures/cli.mjs setup      합성 계정 A·B(같은 공간), C(별도 공간) 준비
 *   node tests/memories/fixtures/cli.mjs teardown   이 픽스처가 만든 공간·파일·요청 기록·계정만 정리
 *   node tests/memories/fixtures/cli.mjs status
 *
 * 안전장치
 *   - Supabase 주소가 loopback이 아니면 멈춘다(인증 픽스처의 assertLocalUrl을 그대로 쓴다).
 *   - 계정은 `mem-e2e-{a,b,c}@test.invalid`만 만들고 지운다. 인증 E2E 계정(auth-e2e-*)은 건드리지 않는다.
 *   - 비밀번호는 매번 새로 만들고 `.agent-runtime/memories-e2e/accounts.json`(Git 제외, 0600)에만 저장한다.
 *   - 키·비밀번호·토큰·파일 경로를 출력하지 않는다.
 *   - 컨테이너를 만들거나 지우거나 재시작하지 않는다. 떠 있는 DB 컨테이너에서 psql만 쓴다.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { deleteUserByEmail, ensureUser, findUserByEmail } from '../../auth/fixtures/admin-api.mjs';
import { FixtureError, assertLocalUrl, fail, generatePassword } from '../../auth/fixtures/env.mjs';

const PREFIX = 'mem-e2e';
const KEYS = /** @type {const} */ (['a', 'b', 'c']);
const BUCKET = 'space-assets';
const ACCOUNTS_PATH = join(resolve(process.cwd()), '.agent-runtime', 'memories-e2e', 'accounts.json');
const CONTAINER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function emailFor(key) {
  return `${PREFIX}-${key}@test.invalid`;
}

function readConfig(env = process.env) {
  if (env.NODE_ENV === 'production') fail('NODE_ENV=production에서는 실행하지 않습니다.');
  const rawUrl = (env.MEM_TEST_SUPABASE_URL ?? env.AUTH_TEST_SUPABASE_URL ?? '').trim();
  if (rawUrl === '') fail('MEM_TEST_SUPABASE_URL이 필요합니다.');
  const url = assertLocalUrl(rawUrl, 'Supabase URL');
  const serviceRoleKey = (env.MEM_TEST_SERVICE_ROLE_KEY ?? env.AUTH_TEST_SERVICE_ROLE_KEY ?? '').trim();
  if (serviceRoleKey === '') fail('MEM_TEST_SERVICE_ROLE_KEY가 필요합니다(값은 출력하지 않습니다).');
  const anonKey = (env.MEM_TEST_ANON_KEY ?? env.AUTH_TEST_ANON_KEY ?? '').trim();
  if (anonKey === '') fail('MEM_TEST_ANON_KEY가 필요합니다.');
  const dbContainer = (env.MEM_TEST_DB_CONTAINER ?? env.AUTH_TEST_DB_CONTAINER ?? '').trim();
  return { supabaseUrl: url.origin, serviceRoleKey, anonKey, dbContainer };
}

// ---------------------------------------------------------------------------
// 로컬 psql (출력은 -At 형식, 키·비밀번호 없음)
// ---------------------------------------------------------------------------

function runSql(config, sql) {
  if (config.dbContainer === '') return { ok: false, reason: 'no_container' };
  if (!CONTAINER_PATTERN.test(config.dbContainer)) fail('DB 컨테이너 이름 형식이 올바르지 않습니다.');
  const result = spawnSync(
    'docker',
    [
      'exec', '-i', config.dbContainer,
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
      '-q', '-At', '-f', '-',
    ],
    { input: sql, encoding: 'utf8' },
  );
  if (result.error) return { ok: false, reason: 'spawn_failed' };
  if (result.status !== 0) {
    // 원문(stderr)에는 값·SQL 조각이 들어갈 수 있어 출력하지 않는다. SQLSTATE만 남긴다.
    return { ok: false, reason: 'sql_failed', sqlState: sqlStateFromStderr(result.stderr) };
  }
  return { ok: true, stdout: (result.stdout ?? '').trim() };
}

/** psql verbose 오류(`ERROR:  23503: ...`)에서 SQLSTATE만 뽑는다. 메시지·DETAIL은 버린다. */
function sqlStateFromStderr(stderr) {
  const match = /ERROR:\s+([0-9A-Z]{5}):/.exec(String(stderr ?? ''));
  return match ? match[1] : 'unknown';
}

function describeFailure(result) {
  return result.sqlState ? `${result.reason}, SQLSTATE ${result.sqlState}` : result.reason;
}

function literal(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const EMAIL_LIST = () => KEYS.map((key) => literal(emailFor(key))).join(', ');

// ---------------------------------------------------------------------------
// REST (사용자 세션)
// ---------------------------------------------------------------------------

async function signIn(config, account) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!response.ok) fail(`합성 계정 로그인 실패: HTTP ${response.status}`);
  const payload = await response.json();
  return payload.access_token;
}

async function rest(config, token, path, init = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

async function rpcOrFail(config, token, fn, args) {
  const result = await rest(config, token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!result.ok) fail(`${fn} 실패: HTTP ${result.status} code=${result.body?.code ?? '-'}`);
  return result.body;
}

async function currentSpaceId(config, token, userId) {
  const result = await rest(config, token, `space_members?select=space_id&user_id=eq.${userId}`);
  return result.ok && Array.isArray(result.body) && result.body[0] ? result.body[0].space_id : null;
}

async function setNickname(config, token, userId, nickname) {
  const profile = await rest(config, token, `profiles?select=version,nickname&id=eq.${userId}`);
  const row = Array.isArray(profile.body) ? profile.body[0] : null;
  if (row?.nickname === nickname) return;
  await rpcOrFail(config, token, 'update_profile', {
    p_nickname: nickname,
    p_expected_version: row?.version ?? 0,
    p_request_id: randomUUID(),
  });
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

function saveAccounts(accounts) {
  mkdirSync(dirname(ACCOUNTS_PATH), { recursive: true });
  writeFileSync(ACCOUNTS_PATH, `${JSON.stringify({ accounts }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function loadAccounts() {
  try {
    return JSON.parse(readFileSync(ACCOUNTS_PATH, 'utf8')).accounts ?? null;
  } catch {
    return null;
  }
}

async function setup(config) {
  if (config.dbContainer === '') {
    fail('MEM_TEST_DB_CONTAINER가 없어 공간 생성 허용 목록을 등록할 수 없습니다.');
  }

  const accounts = {};
  for (const key of KEYS) {
    const email = emailFor(key);
    const password = generatePassword();
    const userId = await ensureUser(config, email, password);
    accounts[key] = { email, password, userId };
    console.log(`계정 준비: ${email}`);
  }
  saveAccounts(accounts);
  console.log('계정 정보 저장: .agent-runtime/memories-e2e/accounts.json (비밀번호는 출력하지 않습니다)');

  const grant = runSql(
    config,
    `select app_private.add_bootstrap_creator(${literal(accounts.a.email)});
     select app_private.add_bootstrap_creator(${literal(accounts.c.email)});`,
  );
  if (!grant.ok) fail(`허용 목록 등록 실패(${describeFailure(grant)})`);

  try {
    const tokenA = await signIn(config, accounts.a);
    const tokenB = await signIn(config, accounts.b);
    const tokenC = await signIn(config, accounts.c);

    if (!(await currentSpaceId(config, tokenA, accounts.a.userId))) {
      await rpcOrFail(config, tokenA, 'create_space', {
        p_name: 'mem-e2e 공간',
        p_introduction: '',
        p_relationship_start_date: null,
        p_request_id: randomUUID(),
      });
      console.log('A 공간 생성');
    }
    await setNickname(config, tokenA, accounts.a.userId, 'mem-a');

    const spaceA = await currentSpaceId(config, tokenA, accounts.a.userId);
    const spaceB = await currentSpaceId(config, tokenB, accounts.b.userId);
    if (!spaceB) {
      const invite = await rpcOrFail(config, tokenA, 'create_invite', {
        p_target_email: accounts.b.email,
        p_request_id: randomUUID(),
      });
      if (!invite?.token) fail('초대 토큰을 받지 못했습니다.');
      await rpcOrFail(config, tokenB, 'accept_invite', { p_token: invite.token, p_request_id: randomUUID() });
      console.log('B가 A의 공간에 참여');
    } else if (spaceB !== spaceA) {
      fail('B가 다른 공간에 있습니다. teardown 후 다시 setup하세요.');
    }
    await setNickname(config, tokenB, accounts.b.userId, 'mem-b');

    if (!(await currentSpaceId(config, tokenC, accounts.c.userId))) {
      await rpcOrFail(config, tokenC, 'create_space', {
        p_name: 'mem-e2e 외부 공간',
        p_introduction: '',
        p_relationship_start_date: null,
        p_request_id: randomUUID(),
      });
      console.log('C(외부) 공간 생성');
    }
    await setNickname(config, tokenC, accounts.c.userId, 'mem-c');
  } finally {
    runSql(
      config,
      `select app_private.remove_bootstrap_creator(${literal(accounts.a.email)});
       select app_private.remove_bootstrap_creator(${literal(accounts.c.email)});`,
    );
  }
  console.log('준비 완료: A·B 같은 공간, C 외부 공간');
}

async function removeObjects(config, paths) {
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100);
    const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: batch }),
    });
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok) fail(`Storage 객체 정리 실패: HTTP ${response.status}`);
  }
}

async function teardown(config) {
  if (config.dbContainer === '') {
    fail('MEM_TEST_DB_CONTAINER가 없어 합성 공간을 정리할 수 없습니다. 계정도 지우지 않았습니다.');
  }

  const spacesSql = `
    select distinct s.id from public.spaces s
     where s.id in (select m.space_id from public.space_members m
                     join auth.users u on u.id = m.user_id
                    where lower(u.email) in (${EMAIL_LIST()}))
        or s.created_by in (select u.id from auth.users u where lower(u.email) in (${EMAIL_LIST()}))`;

  // 1) 이 픽스처 공간의 Storage 객체(경로는 DB 생성 열에서만 얻는다)
  const listed = runSql(config, `select a.object_path from public.assets a where a.space_id in (${spacesSql});`);
  if (!listed.ok) fail(`파일 목록 조회 실패(${describeFailure(listed)})`);
  const paths = listed.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  await removeObjects(config, paths);
  console.log(`Storage 객체 정리: ${paths.length}개`);

  // 2) 이 픽스처 공간의 행과 요청 기록
  const purge = runSql(
    config,
    `begin;
     create temporary table _mem_spaces on commit drop as ${spacesSql};
     delete from public.memory_photos p where p.space_id in (select id from _mem_spaces);
     delete from public.memories m where m.space_id in (select id from _mem_spaces);
     -- 버전 트리거(새 버전 = 이전 + 1)를 지킨다. 커버가 있는 행만 바꾼다(1차 teardown 결함 수정).
     update public.space_settings s
        set cover_asset_id = null,
            version = s.version + 1
      where s.space_id in (select id from _mem_spaces)
        and s.cover_asset_id is not null;
     delete from public.assets a where a.space_id in (select id from _mem_spaces);
     delete from public.spaces s where s.id in (select id from _mem_spaces);
     delete from public.mutation_requests r
      where r.user_id in (select u.id from auth.users u where lower(u.email) in (${EMAIL_LIST()}));
     commit;
     select app_private.remove_bootstrap_creator(${literal(emailFor('a'))});
     select app_private.remove_bootstrap_creator(${literal(emailFor('c'))});`,
  );
  if (!purge.ok) {
    // 트랜잭션이라 실패하면 행은 그대로 남는다. 객체는 이미 지웠을 수 있으나 다시 실행하면 같은 목록으로 멱등 정리된다.
    fail(`합성 공간 정리 실패(${describeFailure(purge)}) — 행은 롤백됐다. 원인을 고친 뒤 teardown을 다시 실행한다.`);
  }
  console.log('합성 공간·요청 기록 정리 완료');

  // 3) 계정
  for (const key of KEYS) {
    const removed = await deleteUserByEmail(config, emailFor(key));
    console.log(`${removed ? '삭제' : '없음'}: ${emailFor(key)}`);
  }
  rmSync(ACCOUNTS_PATH, { force: true });
  console.log('저장한 계정 정보 파일 삭제');
}

async function status(config) {
  console.log(`계정 정보 파일: ${loadAccounts() ? '있음' : '없음'}`);
  console.log(`DB 컨테이너 지정: ${config.dbContainer !== '' ? '있음' : '없음'}`);
  for (const key of KEYS) {
    const user = await findUserByEmail(config, emailFor(key));
    console.log(`${user ? '존재' : '없음'}: ${emailFor(key)}`);
  }
}

async function main() {
  const command = process.argv[2] ?? 'status';
  const config = readConfig();
  if (command === 'setup') return setup(config);
  if (command === 'teardown') return teardown(config);
  if (command === 'status') return status(config);
  console.error(`알 수 없는 명령: ${command} (setup | teardown | status)`);
  process.exitCode = 2;
}

main().catch((error) => {
  if (error instanceof FixtureError) console.error(`픽스처 중단: ${error.message}`);
  else console.error(`픽스처 실패: ${error?.name ?? 'Error'}`);
  process.exitCode = 1;
});
