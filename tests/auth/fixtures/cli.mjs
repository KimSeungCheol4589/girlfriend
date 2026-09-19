#!/usr/bin/env node
/**
 * 인증 E2E 픽스처 준비·정리.
 *
 *   node tests/auth/fixtures/cli.mjs setup
 *   node tests/auth/fixtures/cli.mjs teardown
 *   node tests/auth/fixtures/cli.mjs status
 *
 * 필요한 환경 변수는 `.env.example`의 "로컬 인증 E2E 픽스처 전용" 절을 따른다.
 * 어떤 명령도 키·비밀번호를 출력하지 않는다. 컨테이너를 만들거나 지우지 않는다.
 */

import { deleteUserByEmail, ensureUser, findUserByEmail } from './admin-api.mjs';
import { loadAccounts, removeAccounts, saveAccounts, accountsPath } from './accounts.mjs';
import { ACCOUNT_KEYS, FixtureError, generatePassword, readFixtureEnv, syntheticEmail } from './env.mjs';
import { canRunSql, grantBootstrapCreator, purgeSyntheticData, revokeBootstrapCreator } from './sql.mjs';

function emailsFor(config) {
  return ACCOUNT_KEYS.map((key) => ({ key, email: syntheticEmail(config.prefix, key) }));
}

async function setup(config) {
  const accounts = {};

  for (const { key, email } of emailsFor(config)) {
    const password = generatePassword();
    const id = await ensureUser(config, email, password);
    accounts[key] = { email, password, userId: id };
    console.log(`계정 준비: ${email}`);
  }

  saveAccounts(accounts);
  console.log(`계정 정보 저장: ${accountsPath()} (Git 제외 경로, 비밀번호는 출력하지 않습니다)`);

  // A만 첫 공간을 만들 수 있다. B는 초대로, C는 외부 계정으로 쓴다.
  const creatorEmail = accounts.a.email;
  if (canRunSql(config)) {
    const result = grantBootstrapCreator(config, creatorEmail);
    if (result.ok) {
      console.log(`공간 생성 허용 목록 등록: ${creatorEmail}`);
    } else {
      console.log(`공간 생성 허용 목록 등록 실패(${result.reason}). 아래 SQL을 직접 실행하세요.`);
      console.log(`  select app_private.add_bootstrap_creator('${creatorEmail}');`);
    }
  } else {
    console.log('AUTH_TEST_DB_CONTAINER가 없어 허용 목록을 등록하지 않았습니다. 직접 실행하세요.');
    console.log(`  select app_private.add_bootstrap_creator('${creatorEmail}');`);
  }
}

async function teardown(config) {
  const emails = emailsFor(config).map((entry) => entry.email);

  // spaces.created_by가 RESTRICT라 공간을 먼저 지운다.
  if (canRunSql(config)) {
    const purge = purgeSyntheticData(config, emails);
    console.log(purge.ok ? '합성 공간·요청 기록 정리 완료' : `공간 정리 실패(${purge.reason})`);
    const revoke = revokeBootstrapCreator(config, syntheticEmail(config.prefix, 'a'));
    if (revoke.ok) console.log('공간 생성 허용 목록에서 제거');
  } else {
    console.log('AUTH_TEST_DB_CONTAINER가 없어 공간 정리를 건너뜁니다. 계정 삭제가 실패할 수 있습니다.');
  }

  for (const email of emails) {
    const removed = await deleteUserByEmail(config, email);
    console.log(`${removed ? '삭제' : '없음'}: ${email}`);
  }

  removeAccounts();
  console.log('저장한 계정 정보 파일 삭제');
}

async function status(config) {
  const stored = loadAccounts();
  console.log(`계정 정보 파일: ${stored ? '있음' : '없음'}`);
  console.log(`DB 컨테이너 지정: ${canRunSql(config) ? '있음' : '없음'}`);

  for (const { email } of emailsFor(config)) {
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
  // 예외 메시지에 키·비밀번호가 들어가지 않도록 픽스처 오류만 문구를 그대로 쓴다.
  if (error instanceof FixtureError) {
    console.error(`픽스처 중단: ${error.message}`);
  } else {
    console.error(`픽스처 실패: ${error?.name ?? 'Error'}`);
  }
  process.exitCode = 1;
});
