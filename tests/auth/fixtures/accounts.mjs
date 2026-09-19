/**
 * 합성 계정 정보를 Git 제외 경로에만 보관한다.
 *
 * 저장 위치: `.agent-runtime/auth-e2e/accounts.json` (`.gitignore`에 포함된 경로)
 * 비밀번호는 실행할 때마다 새로 만들며 화면·로그에 찍지 않는다.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { fail, isSyntheticEmail } from './env.mjs';

const REPO_ROOT = resolve(process.cwd());
const ACCOUNTS_PATH = join(REPO_ROOT, '.agent-runtime', 'auth-e2e', 'accounts.json');

function assertSafePath(path) {
  // Git에서 제외된 경로 밖으로는 절대 쓰지 않는다.
  if (!path.includes(`${'.agent-runtime'}`)) {
    fail('합성 계정 정보는 .agent-runtime 아래에만 저장합니다.');
  }
}

export function accountsPath() {
  return ACCOUNTS_PATH;
}

export function saveAccounts(accounts) {
  assertSafePath(ACCOUNTS_PATH);
  for (const account of Object.values(accounts)) {
    if (!isSyntheticEmail(account.email)) fail('합성 계정(.invalid)만 저장합니다.');
  }

  mkdirSync(dirname(ACCOUNTS_PATH), { recursive: true });
  writeFileSync(ACCOUNTS_PATH, `${JSON.stringify({ accounts }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function loadAccounts() {
  try {
    const raw = readFileSync(ACCOUNTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.accounts ?? null;
  } catch {
    return null;
  }
}

export function removeAccounts() {
  assertSafePath(ACCOUNTS_PATH);
  rmSync(ACCOUNTS_PATH, { force: true });
}
