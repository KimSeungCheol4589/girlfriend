# THEME-001 테스트

꾸미기(테마·포인트 색상·커버·홈 섹션) 실제 저장 검증이다. 다른 작업과 **계정·포트·계정 파일**을 모두 분리한다.

| 구분 | 위치 | 실행 조건 |
| --- | --- | --- |
| 단위(순수 함수) | `tests/unit/customize-*.test.ts` | 없음. `pnpm test`에 포함된다 |
| 단위(서버 모듈) | `tests/customize/unit/**` | 없음. 가짜 클라이언트만 쓴다 |
| 통합(실제 DB) | `tests/customize/integration/**` | `THEME_TEST_*` 환경 변수와 픽스처 계정 |
| E2E | `tests/customize/e2e/**` | 위와 같음. 앱은 포트 3005 |

## 분리 기준

- 합성 계정: `theme-e2e-{a,b,c}@test.invalid` (A·B 같은 공간, C 외부 공간)
- 계정 파일: `.agent-runtime/customize-e2e/accounts.json` (Git 제외, 0600, **출력 금지**)
- 포트: 3005 (데모 3001 · 인증 3002 · 추억 3003 · 맛집 3004)
- 환경 변수: `THEME_TEST_SUPABASE_URL`, `THEME_TEST_ANON_KEY`, `THEME_TEST_SERVICE_ROLE_KEY`,
  `THEME_TEST_DB_CONTAINER`, 선택 `THEME_TEST_PHOTOS=off`, `THEME_E2E_PORT`

다른 작업의 픽스처(`tests/memories/fixtures/cli.mjs`, `tests/auth/fixtures/cli.mjs`)는 **실행하지 않는다.**
그쪽 계정(`mem-e2e-*`, `auth-e2e-*`)을 지우거나 덮어쓰지 않기 위해서다. 로그인 화면 조작 도우미와
Auth 관리 API 헬퍼는 읽기 전용으로 import만 한다.

## 실행

```bash
node tests/customize/fixtures/cli.mjs setup
pnpm exec vitest run --config tests/customize/vitest.config.ts
pnpm exec playwright test --config playwright.customize.config.ts
node tests/customize/fixtures/cli.mjs teardown
```

사진(커버) 기능이 꺼진 동작만 볼 때:

```bash
THEME_TEST_PHOTOS=off pnpm exec playwright test --config playwright.customize.config.ts \
  tests/customize/e2e/photos-disabled.spec.ts
```

## 안전 규칙

- 로컬(loopback) Supabase에서만 실행한다. 주소가 loopback이 아니면 픽스처가 멈춘다.
- 키·비밀번호·토큰·파일 경로를 출력하거나 단언 메시지에 넣지 않는다.
- 앱 서버에는 `MEM_SUPABASE_SERVICE_ROLE_KEY` 하나만 넘긴다. 나머지 `*SERVICE_ROLE*` 이름은
  `buildWebServerEnv`가 빈 값으로 덮어써 상속을 막는다.
- 픽스처는 컨테이너를 만들지·지우지·재시작하지 않고, 만료 정리나 트리거를 끄지 않는다.
  이 픽스처가 만든 공간·파일·요청 기록·계정만 정리한다.
- trace·video·screenshot은 꺼져 있고, 실패 문맥 파일의 페이지 스냅샷은 인증 리포터가 지운다.
