/**
 * 로컬 HTTP smoke test.
 *
 * 이미 떠 있는 개발/프로덕션 서버에 요청을 보내 각 경로의 상태 코드와
 * 화면에 반드시 있어야 하는 문구를 확인한다. 서버를 직접 띄우지는 않는다.
 *
 *   node .agent-runtime/tools/node_modules/pnpm/bin/pnpm.cjs start   # 다른 터미널에서
 *   node .agent-runtime/tools/node_modules/pnpm/bin/pnpm.cjs run test:smoke
 *
 * 기준 주소는 첫 번째 인자나 SMOKE_BASE_URL로 바꿀 수 있다. 기본값은 UI 검증 포트 3001이다.
 *
 *   pnpm run test:smoke -- http://127.0.0.1:3002
 */

const baseUrl = process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3001';

/** @type {{ path: string, expectStatus: number, expect?: string[] }[]} */
const checks = [
  {
    path: '/',
    expectStatus: 200,
    expect: ['데모 모드', '둘이 쌓는 공간', '함께한 지', '최근 추억'],
  },
  { path: '/memories', expectStatus: 200, expect: ['월·태그로 추리기', '새 추억 쓰기'] },
  { path: '/memories?month=2026-09', expectStatus: 200, expect: ['월·태그로 추리기'] },
  { path: '/memories?month=not-a-month', expectStatus: 200, expect: ['월·태그로 추리기'] },
  { path: '/memories/new', expectStatus: 200, expect: ['새 추억', '사진 고르기'] },
  {
    path: '/memories/demo-memory-1',
    expectStatus: 200,
    expect: ['한강 노을 산책', '홈에 고정'],
  },
  { path: '/memories/demo-memory-1/edit', expectStatus: 200, expect: ['기록 수정'] },
  {
    // 일반 화면에는 내부 오류 코드를 노출하지 않는다.
    path: '/memories/does-not-exist',
    expectStatus: 200,
    expect: ['이 기록을 찾지 못했어요'],
  },
  {
    path: '/customize',
    expectStatus: 200,
    expect: ['꾸미기', '포인트 색상', '커버 이미지', '미리보기'],
  },
  { path: '/restaurants', expectStatus: 200, expect: ['준비 중', '맛집'] },
  { path: '/settings', expectStatus: 200, expect: ['준비 중', '설정'] },
  { path: '/artwork/memory-01.svg', expectStatus: 200, expect: ['<svg'] },
  { path: '/icon.svg', expectStatus: 200, expect: ['<svg'] },
  { path: '/no-such-page', expectStatus: 404, expect: ['찾는 화면이 없어요'] },
];

let failures = 0;

for (const check of checks) {
  const url = `${baseUrl}${check.path}`;
  let status = 0;
  let body = '';

  try {
    const response = await fetch(url, { redirect: 'manual' });
    status = response.status;
    body = await response.text();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${check.path} — 요청 실패: ${error instanceof Error ? error.message : error}`);
    continue;
  }

  const problems = [];
  if (status !== check.expectStatus) {
    problems.push(`상태 코드 ${status} (기대 ${check.expectStatus})`);
  }
  for (const needle of check.expect ?? []) {
    if (!body.includes(needle)) problems.push(`문구 없음: ${needle}`);
  }

  if (problems.length > 0) {
    failures += 1;
    console.error(`FAIL ${check.path} — ${problems.join(', ')}`);
  } else {
    console.log(`ok   ${status} ${check.path}`);
  }
}

if (failures > 0) {
  console.error(`\nHTTP smoke 실패 ${failures}건 (기준 주소 ${baseUrl})`);
  process.exit(1);
}

console.log(`\nHTTP smoke ${checks.length}건 모두 통과 (기준 주소 ${baseUrl})`);
