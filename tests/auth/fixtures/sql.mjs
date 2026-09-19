/**
 * 로컬 DB에 직접 실행해야 하는 준비 작업.
 *
 * `app_private.*`는 PostgREST로 노출되지 않으므로(의도된 설계) 최초 공간 생성 허용 목록
 * 등록과 픽스처 정리는 로컬 DB 컨테이너의 psql로 한다.
 *
 * 안전장치
 *   - 컨테이너 이름을 주지 않으면 **아무것도 실행하지 않고** 필요한 SQL만 알려 준다.
 *   - 합성 계정(.invalid) 범위 밖의 행은 건드리지 않는다.
 *   - 컨테이너를 만들거나 지우거나 재시작하지 않는다. 이미 떠 있는 컨테이너에서 psql만 쓴다.
 */

import { spawnSync } from 'node:child_process';

import { fail } from './env.mjs';

const CONTAINER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function canRunSql(config) {
  return config.dbContainer !== '';
}

/** psql을 표준 입력으로 실행한다. 출력에는 키·비밀번호가 포함되지 않는다. */
export function runSql(config, sql) {
  if (!canRunSql(config)) {
    return { ok: false, reason: 'no_container', sql };
  }
  if (!CONTAINER_PATTERN.test(config.dbContainer)) {
    fail('AUTH_TEST_DB_CONTAINER 이름 형식이 올바르지 않습니다.');
  }

  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      config.dbContainer,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-f',
      '-',
    ],
    { input: sql, encoding: 'utf8' },
  );

  if (result.error) {
    return { ok: false, reason: 'spawn_failed', message: String(result.error.message ?? '') };
  }
  if (result.status !== 0) {
    return { ok: false, reason: 'sql_failed', message: (result.stderr ?? '').trim() };
  }
  return { ok: true, stdout: (result.stdout ?? '').trim() };
}

function emailLiteral(email) {
  // 합성 이메일만 들어오지만 따옴표는 항상 이스케이프한다.
  return `'${email.replace(/'/g, "''")}'`;
}

/** 최초 공간 생성 허용 목록에 합성 계정을 넣는다. */
export function grantBootstrapCreator(config, email) {
  return runSql(config, `select app_private.add_bootstrap_creator(${emailLiteral(email)});`);
}

export function revokeBootstrapCreator(config, email) {
  return runSql(config, `select app_private.remove_bootstrap_creator(${emailLiteral(email)});`);
}

/**
 * 합성 계정이 만든 공간과 멱등성 기록을 지운다.
 * `spaces.created_by`가 RESTRICT라 계정 삭제 전에 먼저 실행해야 한다.
 */
export function purgeSyntheticData(config, emails) {
  if (emails.length === 0) return { ok: true, stdout: '' };
  const list = emails.map(emailLiteral).join(', ');

  return runSql(
    config,
    `
begin;
create temporary table _fixture_users on commit drop as
  select id from auth.users where lower(email) in (${list});

delete from public.spaces s
 where s.id in (select m.space_id from public.space_members m
                 where m.user_id in (select id from _fixture_users))
    or s.created_by in (select id from _fixture_users);

delete from public.mutation_requests r
 where r.user_id in (select id from _fixture_users);
commit;
`.trim(),
  );
}

// 초대 만료 시나리오는 스펙에서 직접 실행한다(tests/auth/e2e/helpers.ts의 expireInvitesFor).
// 같은 SQL을 두 곳에 두면 한쪽만 바뀔 수 있어 여기서는 제공하지 않는다.
