# AUTH-001 구현 인계

- 작업: 로그인·세션·공간 생성·초대 연결 (인증 기반)
- 브랜치: `codex/auth-foundation`
- 기준 커밋(base): `814615fdf3c12c9ef7f7d1c15cc989fd9e04ee4b`
- 상태: **구현 완료. 정적 검증(타입·lint·build·단위) 통과. 인증 E2E는 3차 수정 후 아직 실행하지 않았다.**
  - 총괄이 실행한 실제 E2E v2: 21개 중 17 통과 / 1 실패 / 3 미실행.
    그 1건(비밀번호 재설정 콜백)의 원인을 찾아 이번 회차에 고쳤다(0-A절).
- 이 보고서는 구현 세션의 자기 보고다. **독립 검토가 아니며 E2E 통과를 주장하지 않는다.**

## 0-A. 3차(이번 회차): 실제 E2E v2 결과에 대한 targeted 수정

총괄이 실제 로컬 환경에서 v2를 실행했다: **21개 중 17 통과 / 1 실패 / 3 미실행.**
초대·세션·갱신(실제 회전, 폐기 거부 포함) 시나리오는 모두 통과했다.
남은 실패 하나(`recovery.spec.ts` 새 비밀번호 화면)를 근본 원인까지 파고들어 고쳤다.

### A-1. 원인: 콜백이 **다른 host로** 리다이렉트하고 있었다

증상은 "verifyOtp는 성공했는데(오류 로그 없음, authError 없음) 세션이 없는 재설정 요청 화면"이었다.

실제 라우트를 로컬에서 재현해 확인한 결과(가짜 Auth 서버, 실제 키·계정 없음):

```text
요청:  GET http://127.0.0.1:3012/auth/confirm?token_hash=...&type=recovery&next=/reset-password
응답:  307, Set-Cookie: sb-...-auth-token   ← 쿠키는 정상적으로 심긴다
       Location: http://localhost:3012/reset-password   ← host가 바뀐다
```

`request.url`의 host로 절대 주소를 만들었는데, 개발 서버에서 그 값이 요청 host(`127.0.0.1`)가
아니라 `localhost`로 나왔다. 쿠키 관점에서 둘은 **다른 host**라 방금 심은 세션이 다음 요청에
실리지 않는다. 그래서 오류 없이 "로그인되지 않은 재설정 화면"이 뜬다.

부수적으로 확인한 사실(같은 방법):

- `@supabase/ssr` 0.12.7은 `verifyOtp()`가 **반환되기 전에** 쿠키 쓰기(setAll)를 끝낸다.
  즉 라이브러리 쪽 비동기 타이밍 문제는 아니었다.
- Next 15.5의 라우트 모듈은 리다이렉트 응답에도 쿠키 변경분을 병합한다(소스에서 확인).

### A-2. 수정: 인증 콜백은 상대 경로로만 이동한다

`src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts`를
`NextResponse.redirect(절대주소)` → `next/navigation`의 `redirect('/내부경로')`로 바꿨다.
`Location`에 상대 경로가 그대로 들어가 브라우저가 현재 출처로 풀고, 쿠키가 유지된다.
이동 경로는 여전히 허용 목록을 통과한 값만 쓴다.

실패 분기의 목적지를 `authLinkFailurePath()`로 모아 단위 테스트로 고정했다.
재설정 링크 실패는 재설정 화면에서, 그 밖의 확인 링크 실패는 로그인 화면에서 안내한다.
(이 정리로 "token_hash 없음 + type=recovery"의 목적지가 `/login` → `/reset-password`로 바뀌었고,
해당 E2E 단언도 같은 기준으로 맞췄다. 화면·안내 문구를 함께 단언하므로 약화가 아니다.)

수정 후 같은 방법으로 다시 확인했다.

```text
성공:            Location: /reset-password            → 같은 출처, 새 비밀번호 화면 렌더
확인 실패:        Location: /reset-password?authError=link
토큰 없음(recovery): Location: /reset-password?authError=link
알 수 없는 type:   Location: /login?authError=link
콜백 공급자 오류:   Location: /login?authError=link
콜백 코드 없음(+외부 next): Location: /login?authError=link
```

E2E에는 **출처가 바뀌지 않는지**를 단언하는 회귀 검사를 추가했다(성공 단언은 그대로 유지).

### A-3. 실패 산출물의 스냅샷 — 이전 보고를 정정한다

2차 보고에서 "`PLAYWRIGHT_NO_COPY_PROMPT=1`로 페이지 스냅샷 수집을 껐다"고 적었다.
**그 판단은 틀렸다.** 설치된 1.63.0으로 직접 실험한 결과는 다음과 같다.

| 방법 | `error-context.md` | 스냅샷(yaml) | 입력값 노출 |
| --- | --- | --- | --- |
| 기본 | 생성됨 | 있음 | 있음(`type="password"` 값까지) |
| 설정 파일에서 `PLAYWRIGHT_NO_COPY_PROMPT=1` | 생성됨 | **있음** | 있음 |
| 러너 프로세스 env로 전달 | 생성됨 | **있음** | 있음 |
| **리포터로 스냅샷 블록 제거** | 생성됨 | **없음** | **없음** |

그래서 공개 리포터 API를 쓰는 `tests/auth/reporters/redact-error-context.ts`를 추가하고
인증 설정의 reporter에 연결했다. 파일이 만들어진 뒤 ```` ```yaml ```` 블록만 덜어 내며
오류 메시지·호출 로그·테스트 소스는 그대로 남겨 진단을 유지한다. 단위 테스트로 규칙을 고정했다.

### A-4. smoke 기록 정정

2차 보고의 "HTTP smoke 14건 통과"는 **두 번째 시도** 결과다. 첫 시도는 포트 3011 서버가
HTTP 500/응답 지연 상태였고 총괄이 해당 smoke 프로세스(30684)를 종료했다. 그 뒤 같은 절차로
다시 실행해 14건이 모두 통과했다. 이번 회차에서는 앱 라우트만 바뀌어 smoke를 다시 돌리지 않았다.

### A-5. 이번 회차 검증

| 검증 | 결과 |
| --- | --- |
| `tsc --noEmit` | 통과(오류 0) |
| ESLint | 통과(경고·오류 0) |
| 단위 테스트 | **14개 파일 200개 통과** (직전 193 + 리다이렉트 목적지 3 + 스냅샷 제거 4) |
| `next build` | 성공(15개 라우트 + 미들웨어). 라우트 핸들러 변경 때문에 다시 실행했다 |
| 인증 설정 로드 | `--list`로 리포터 경로 포함 로드 확인, **21개 테스트 인식** |
| 라우트 재현 확인 | 위 A-1·A-2 표. 사용한 서버는 모두 종료(3012 해제 확인) |

데모 E2E·HTTP smoke는 이번에 앱 라우트만 바뀌었고 데모 경로와 무관해 다시 돌리지 않았다.

**인증 E2E는 이 수정 이후 아직 실행하지 않았다.** 재설정 스펙만 다시 볼 때는 상태를 건드리지
않는다(계정 D 전용):

```sh
pnpm run test:e2e:auth -- recovery.spec.ts
```

초대·정원 시나리오까지 다시 돌릴 때만 `teardown` → `setup`이 필요하다.

## 0. 이번 회차(2차)에 한 일

1차 제출 이후 총괄이 의존성을 설치하고(`@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.116.0,
lockfile 갱신) 타입·lint·build·단위 검증과 **첫 인증 E2E 실행**을 해 주었다.
그 결과(2 통과 / 2 실패 / 10 미실행)를 근거로 다음을 고쳤다.

| # | 내용 |
| --- | --- |
| 1 | E2E 실패의 **실제 원인**(스트리밍 리다이렉트 가정 오류)을 찾아 테스트 판정 방식을 고쳤다. 단언을 약화하지 않았다 |
| 2 | 데모 모드를 **명시적 진입만** 허용하도록 바꿨다. 설정이 없으면 데모로 흘러가지 않고 "설정 필요"로 실패한다 |
| 3 | **실제 세션 갱신(refresh token) E2E**를 추가했다. 폐기된 refresh token 시나리오도 함께 넣었다 |
| 4 | **콜백·비밀번호 재설정 E2E**를 추가했다(로컬 관리 API의 `token_hash` 사용). 잘못된 링크·열린 리다이렉트도 확인한다 |
| 5 | Playwright 실패 산출물의 **페이지 스냅샷 수집을 껐고**, 비밀 값이 단언 메시지로 새지 않도록 비교를 boolean으로 바꿨다 |
| 6 | 픽스처 안전장치(loopback 전용, production 거부, `.invalid` 도메인 고정 등)를 **단위 테스트로 고정**했다 |

## 1. 1차 E2E 실패의 원인 (근거와 수정)

### 증거

- `session.spec.ts` "A는 로그인 후 …": `expect(page).toHaveURL(/\/$/)`는 **통과**했는데
  그다음 홈 제목 단언이 실패했고, 스냅샷에는 **온보딩 화면**이 찍혀 있었다.
- `invite.spec.ts` "만료된 초대 …": `/settings`에서 '상대방 이메일' 입력을 기다리다 타임아웃.
  A의 공간이 아직 없어 `/settings`가 온보딩으로 넘어간 상태였다.

### 원인

`ensureSpace()`가 `page.goto('/')` **직후의 주소**로 화면을 판정했다.
그 시점의 주소는 아직 `/`라서 "공간이 있다"고 잘못 판단하고 아무것도 만들지 않았다.
이어지는 URL 단언도 중간 상태에서 통과했다.

직접 확인한 앱의 실제 동작(로컬 개발 서버, 비로그인 요청):

```text
GET /          → 200, Location 없음, cache-control: no-store, must-revalidate
GET /settings  → 200, Location 없음
GET /memories  → 200, Location 없음
```

즉 서버 컴포넌트의 `redirect()`가 **스트리밍 응답 안에서** 전달되고 이동은 클라이언트 라우터가
수행한다. `goto()`가 돌아온 시점의 주소는 최종 주소가 아니다.
(같은 확인에서 Auth 서버에 연결할 수 없을 때도 500이 아니라 로그인 화면으로 가는 것을 보았다.)

### 수정

- `waitForScreen(page, [...])`를 도입해 **실제로 그려진 화면**을 기다린 뒤 판정한다.
  `ensureSpace`는 홈/온보딩 중 무엇이 떴는지 보고 필요할 때만 공간을 만든다.
- 주소 단언은 화면이 확정된 **뒤에** 하고, 토큰이 들어갈 수 있는 주소는 `pathnameOf(page)`로
  경로만 비교한다.
- 앱 동작을 바꾸지 않았다. 접근 제어는 화면마다 서버에서 다시 확인하는 구조 그대로다.
- 개발 서버의 첫 경로 컴파일이 느려 1차에서 타임아웃이 났으므로 인증 스위트의 테스트 제한 시간을
  90초로 두었다(판정 기준이 아니라 대기 시간만 조정).

## 2. 데모 모드: 명시적 진입만 (변경)

`resolveAppMode`를 바꿨다.

| 조건 | 이전 | 지금 |
| --- | --- | --- |
| `NEXT_PUBLIC_DEMO_MODE=true` | demo | demo |
| 설정 있음 + 플래그 없음 | live | live |
| **설정 없음 + 플래그 없음** | **demo(자동)** | **unconfigured** |
| 설정 없음 + 플래그 `false` | unconfigured | unconfigured |

설정을 빠뜨린 배포가 "동작하는 것처럼" 보이지 않게 하려는 것이다. 이제 데모는 켠다고 말해야 켜진다.

영향:

- 데모 화면을 보려면 서버를 띄울 때 `NEXT_PUBLIC_DEMO_MODE=true`를 준다.
  `NEXT_PUBLIC_*`는 서버 시작(그리고 build) 시점에 읽힌다.
- 데모 E2E(`playwright.config.ts`)는 `webServer.env`에 이미 플래그가 들어 있어 그대로 동작한다.
- **`pnpm run test:smoke`는 데모 화면을 검사하므로, 검사 대상 서버를 데모 모드로 띄워야 한다.**
- 단위 테스트를 새 규칙으로 갱신했다.

## 3. 새로 추가한 인증 E2E (총 14개)

파일 이름 순으로 실행된다(`workers: 1`, 파일 간 순서 의존 없음 — 각 파일이 필요한 상태를 직접 만든다).

### `tests/auth/e2e/refresh.spec.ts` (신규)

1. **실제 갱신**: 저장된 세션의 `expires_at`만 과거로 바꾸고(= 클라이언트가 가진 만료 정보)
   보호된 화면에 들어간다. 그러면
   - 응답에 **갱신된 세션 쿠키가 실리고**(`Set-Cookie`, 이름 패턴만 확인),
   - 응답이 `no-store`이며,
   - 저장된 **access token이 실제로 새 값으로 바뀌고**(값이 아니라 `!==` boolean으로 단언),
   - 화면이 정상 동작한다.
2. **폐기된 refresh token**: 로컬 Auth의 `POST /auth/v1/logout?scope=global`로 그 사용자의
   refresh token을 모두 폐기한 뒤 같은 상황을 만들면 갱신이 실패하고 로그인 화면으로 간다.

> **모의와 진짜의 구분(그대로 보고한다)**: 바꾸는 값은 브라우저에 저장된 `expires_at` 하나뿐이다.
> refresh token은 로컬 Auth가 발급한 **유효한 값 그대로**이고, 갱신 호출·새 토큰 발급·쿠키 재작성은
> 실제로 일어난다. **서버 벽시계로 실제 만료되는 상황(JWT_EXP 단축)은 검증하지 않았고,
> Auth 설정·컨테이너도 바꾸지 않았다.**
> 브라우저 클라이언트가 먼저 갱신해 결과가 흐려지지 않도록, 쿠키를 고치기 전에 앱 화면을 닫고
> 새 탭으로 들어가 서버 응답을 관찰한다.

### `tests/auth/e2e/recovery.spec.ts` (신규)

1. 재설정 메일 요청은 계정 존재 여부를 알려 주지 않는다.
2. 로컬 관리 API(`/admin/generate_link`)로 만든 **token_hash** → 앱의 `/auth/confirm` →
   새 비밀번호 저장 → **그 비밀번호로 실제 로그인** → 같은 토큰 재사용은 거부.
3. 잘못된 `token_hash`·허용하지 않는 `type`·토큰 없음 → 안내와 함께 거부.
4. PKCE 콜백 실패·공급자 오류·코드 없음 → 내부 화면으로만 이동.
5. 콜백의 `next`로 외부 주소에 나갈 수 없다.

> **한계(그대로 보고한다)**: **실제 메일 발송·수신 경로는 검증하지 않았다.**
> 로컬 Auth는 `SITE_URL=http://127.0.0.1:3000`, `URI_ALLOW_LIST=https://127.0.0.1:3000`이고
> 앱은 3002에서 돈다. 따라서 **메일에 담기는 링크가 앱(3002)으로 돌아오는지는 확인되지 않았다.**
> 이 스펙은 "token_hash를 받은 앱 경로가 올바르게 동작하는가"만 확인한다.
> 운영에서는 Redirect 허용 목록에 실제 앱 주소를 넣어야 한다.
> 비밀번호가 바뀌는 계정은 **D 전용**이라 다른 시나리오의 자격 증명은 그대로 유효하다.

### 기존 스펙 보강

- `session.spec.ts`: 로그아웃 뒤 **세션 쿠키가 남지 않는지** 확인, 실제 모드의 `/memories`에
  데모 문구가 전혀 없는지 확인, 열린 리다이렉트는 앱 출처를 벗어나지 않는지 확인.
- `invite.spec.ts`: 만료 후 공간에 못 들어가는지, 같은 사용자의 재수락은 멱등 성공인지,
  **다른 계정의 재사용은 거부**되는지까지 확인.

## 4. 비밀 값 취급 (요청 4번)

- `playwright.auth.config.ts`에서 `PLAYWRIGHT_NO_COPY_PROMPT=1`을 설정해 실패 시 만들어지는
  `error-context.md`의 **페이지 스냅샷 수집을 끈다**(trace·video·screenshot은 이미 off).
  Playwright 1.63이 이 환경 변수로 스냅샷 수집을 건너뛰는 것을 소스에서 확인했다.
- 토큰·비밀번호·초대 링크를 단언 **값**으로 쓰지 않는다. `expect(a !== b).toBe(true)` 형태와
  설명 문구를 쓴다. 토큰이 든 주소는 `pathnameOf(page)`로 경로만 비교한다.
- 픽스처는 키·비밀번호를 출력하지 않는다. 계정 파일은 `.agent-runtime/auth-e2e/accounts.json`
  (Git 제외, 0600)에만 쓴다.
- 1차 실행이 남긴 `test-results/**/error-context.md`를 확인했다. 실제 자격 증명은 없고
  테스트 소스의 고정 오답 문자열만 들어 있었다(`test-results/`는 Git 제외 경로다).

## 5. 이번 회차에 실제로 실행한 검증

명령은 모두 이 워크트리에서 `node`로 직접 실행했다(설치·전역 설정 변경 없음).

| 검증 | 명령 | 결과 |
| --- | --- | --- |
| 타입 | `node node_modules/typescript/bin/tsc --noEmit` | **통과(오류 0)** |
| lint | `node node_modules/eslint/bin/eslint.js .` (pnpm과 같은 모듈 경로로 실행) | **통과(경고·오류 0)** |
| 단위 | `node node_modules/vitest/vitest.mjs run` | **13개 파일 193개 통과** (기존 185 + 픽스처 안전장치 8) |
| build | `node node_modules/next/dist/bin/next build` | **성공, 15개 라우트 + 미들웨어** |
| 데모 E2E | `node node_modules/@playwright/test/cli.js test --workers=2` | **48개 통과** (모바일·데스크톱). 데모 플래그를 명시적으로 주는 기존 설정 그대로 |
| HTTP smoke | 데모 모드 서버(포트 3011)를 띄우고 `tests/smoke/http-smoke.mjs` | **14건 통과** |
| 앱 동작 확인 | 일회용 개발 서버(포트 3010, loopback, 더미 설정) | 보호 경로가 200·`Location` 없이 스트리밍 리다이렉트로 로그인 화면에 도달, `no-store` 확인 |

데모 E2E와 smoke는 이번 데모 모드 규칙 변경(명시적 진입)과 1차의 `AppShell`·레이아웃 분리가
기존 UI 동작을 깨지 않았다는 것을 확인해 준다. 확인에 쓴 서버는 모두 종료했고 포트 해제도 확인했다
(3001·3010·3011). 컨테이너·DB·Auth 설정은 건드리지 않았다.

> lint는 `pnpm run lint`와 달리 모듈 경로가 자동으로 잡히지 않아
> `NODE_PATH=node_modules/.pnpm/node_modules`에 해당하는 설정을 준 뒤 실행했다. 결과는 오류 0이다.

## 6. 아직 실행하지 않은 것 (통과로 취급하지 않음)

| 항목 | 상태 |
| --- | --- |
| 인증 E2E 14개 | **미실행.** 이번 수정 이후 한 번도 돌리지 않았다. 총괄이 실행한다 |
| 실제 메일 발송·수신, 운영 Redirect 허용 목록 | 미실행(3절 한계 참고) |
| 서버 벽시계 기준 토큰 만료 | 미실행(3절 구분 참고) |
| 모바일 뷰포트·실기기, 접근성 자동 검사 | 미실행 |

**E2E를 다시 돌리기 전에 픽스처를 새로 만들어야 한다.** 계정 D가 추가됐고, 초대·정원 시나리오는
"A의 공간에 아직 B가 없는" 상태를 전제로 한다.

```sh
node tests/auth/fixtures/cli.mjs teardown
node tests/auth/fixtures/cli.mjs setup
pnpm run test:e2e:auth
```

## 7-A. 변경·추가한 파일 (3차)

```text
수정
  src/app/auth/callback/route.ts            상대 경로 리다이렉트로 변경
  src/app/auth/confirm/route.ts             상대 경로 리다이렉트 + 실패 목적지 정리
  src/features/auth/redirects.ts            authLinkFailurePath 추가
  playwright.auth.config.ts                 스냅샷 제거 리포터 연결(효과 없던 env 설정 제거)
  tests/auth/e2e/recovery.spec.ts           출처 회귀 단언 추가, 실패 목적지 단언 정리
  tests/unit/auth-redirects.test.ts         실패 목적지 테스트 추가
  docs/auth/SETUP.md / tests/auth/README.md 관찰된 동작·정책 갱신

추가
  tests/auth/reporters/redact-error-context.ts   실패 산출물에서 페이지 스냅샷만 제거
  tests/unit/auth-error-context-redaction.test.ts 그 규칙의 단위 테스트
```

## 7. 변경·추가한 파일 (2차)

```text
수정
  src/features/auth/mode.ts                 데모는 명시적 진입만
  tests/unit/auth-config-mode.test.ts       새 규칙 반영
  tests/auth/e2e/helpers.ts                 화면 기준 판정, 세션 쿠키·로컬 Auth 도우미, 비밀 값 비노출
  tests/auth/e2e/session.spec.ts            화면 기준 판정 + 로그아웃 후 쿠키 확인
  tests/auth/e2e/invite.spec.ts             화면 기준 판정 + 재사용/만료 후 상태 확인
  tests/auth/fixtures/env.mjs               계정 D 추가
  tests/auth/fixtures/sql.mjs               중복 SQL 제거(만료는 스펙에서 수행)
  playwright.auth.config.ts                 스냅샷 수집 차단, 설정 누락 시 즉시 중단, 시간 제한
  .env.example / docs/auth/SETUP.md / tests/auth/README.md   데모 규칙·한계·실행 절차 갱신

추가
  tests/auth/e2e/refresh.spec.ts            세션 갱신·폐기 시나리오
  tests/auth/e2e/recovery.spec.ts           콜백·비밀번호 재설정·열린 리다이렉트
  tests/unit/auth-fixture-guards.test.ts    픽스처 안전장치 단위 테스트
```

1차에서 만든 제품 코드(`src/lib/supabase/**`, `src/features/auth/**`, 인증 화면·라우트, 미들웨어)는
`mode.ts` 외에는 바뀌지 않았다. DB migration·컨테이너·Auth 설정은 건드리지 않았고 SQL 변경도 없다.

## 8. 설계 결정 (1차에서 이어짐)

### 8.1 데모/실제 분리 방식

URL을 나누는 대신 **모드**를 나눴다(`/demo` 경로 없음). 총괄이 "모드 분리 자체는 허용"으로 확인해 주었다.
`live`에서는 `DemoStoreProvider`가 트리에 들어가지 않으므로 데모 데이터가 로그인 화면에 섞일 수 없다.
`/memories`·`/restaurants`·`/customize`는 live에서 준비 중 안내만 보여 주고,
`/memories/new`·`/memories/[id]`·`/memories/[id]/edit`는 `/memories`로 보낸다.

### 8.2 오류 코드·멱등성·토큰 취급

- SQLSTATE(`GF4xx`/`GF503`)로만 분기한다. `42501` → `NOT_FOUND`, `23505` → `CONFLICT`.
- `DETAIL`의 `path`는 진단 예약 키이므로 `fieldErrors`로 옮기지 않는다.
- `requestId`는 브라우저에서 만들고, 입력이 같으면 유지·고치면 새로 만든다.
- 초대 토큰은 fragment로만 전달하고 즉시 주소에서 지우며 그 탭에 10분만 보관한다.

## 9. 남은 위험과 후속

1. **3차 수정 이후의 인증 E2E가 아직 실행되지 않았다.** v2에서 17개가 통과했고 이번에 고친 것은
   콜백 리다이렉트 경로다. 재설정 스펙부터 확인하면 된다(계정 D 전용이라 상태 영향 없음).
2. **데모 규칙 변경의 파급**: 데모 플래그 없이 서버를 띄우면 "설정 필요" 화면이 된다.
   데모 E2E는 설정에 플래그가 들어 있어 그대로 통과하지만(48건 확인),
   `pnpm run test:smoke`와 수동 확인은 **서버를 띄울 때 플래그를 줘야 한다**
   (`NEXT_PUBLIC_DEMO_MODE=true`). 이 값은 서버 시작·build 시점에 읽힌다.
3. **운영 공개 가입 차단이 아직 설정되지 않았다.** 로컬은 `DISABLE_SIGNUP=false`다.
   앱에 가입 화면이 없어도 Auth API로 직접 가입할 수 있으므로 운영 전에 반드시 꺼야 한다.
4. **메일 링크 경로 미검증**(3절). 운영 Redirect 허용 목록에 실제 앱 주소를 넣고 다시 확인해야 한다.
5. **`src/lib/contracts.ts`의 `ERROR_CODES`에 `FORBIDDEN`이 없다.** UI 소유 파일이라 고치지 않았고
   인증 코드는 자체 목록을 쓴다. 통합 시 한쪽으로 모으는 편이 낫다.
6. **이메일 미확인 계정 흐름**은 단위 테스트(오류 매핑)까지만 확인했다. 픽스처는 확인된 계정을 만든다.

## 10. 검토 상태

- 이 문서는 구현 세션의 자기 보고다. **독립 검토를 수행하지 않았고 E2E 통과를 주장하지 않는다.**
- 총괄이 커밋한 뒤 고정된 base/head SHA로 **새 Claude 세션의 읽기 전용 독립 검토**를 배정해야 한다.
- 커밋·push·브랜치 전환은 하지 않았다. 워크트리 밖 파일도 변경하지 않았다.
- 비밀 키·실제 계정·토큰을 읽거나 출력하지 않았다. `.env`·자격 증명 저장소에 접근하지 않았다.
