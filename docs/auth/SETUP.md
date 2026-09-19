# 인증 설정과 운영 절차 — AUTH-001

작성일: 2026-09-20 · 대상: 운영자(첫 계정 준비), 개발자(로컬 실행)

이 문서는 **코드에 구현된 것**과 **사람이 해야 하는 설정**을 나눠 적는다.
Supabase 프로젝트 설정·SMTP·배포는 이 작업에서 수행하지 않았다(미실행 항목은 마지막 절 참고).

## 1. 동작 모드

앱은 한 번에 하나의 모드로만 동작한다. 모드는 서버가 환경 변수로 판단한다.

| 모드 | 조건 | 화면 |
| --- | --- | --- |
| `demo` | `NEXT_PUBLIC_DEMO_MODE=true` (**명시적 진입만**) | 브라우저 메모리만 쓰는 데모. 로그인·서버 저장 없음. 인증 화면은 "데모 모드"라고 밝히고 동작하지 않는다 |
| `live` | Supabase 설정이 있고 데모를 켜지 않았을 때 | 실제 로그인·공간·초대 |
| `unconfigured` | 그 밖의 모든 경우 | 모든 화면이 "설정 필요"로 실패한다. 로그인 성공처럼 보이는 대체 동작이 없다 |

데모는 **켠다고 말해야 켜진다.** 설정이 없다고 해서 자동으로 데모가 되지 않는다.
설정을 빠뜨린 배포가 "동작하는 것처럼" 보이는 상황을 만들지 않기 위해서다.

그래서 데모 화면·데모 E2E·HTTP smoke를 볼 때는 서버를 띄울 때 플래그를 함께 준다.
`NEXT_PUBLIC_*`는 서버가 시작할 때(그리고 build 시) 읽히므로 나중에 바꿔도 반영되지 않는다.

```sh
# 데모 화면 확인 (개발 서버)
NEXT_PUBLIC_DEMO_MODE=true pnpm run dev

# 데모 E2E는 설정이 이미 들어 있다(playwright.config.ts의 webServer.env).
pnpm run test:e2e
```

`live`에서는 데모 저장소(`src/lib/demo/**`)를 **마운트하지 않는다**. 데모 데이터가 로그인한 화면에
섞일 수 없고, 데모의 저장 동작을 실제 저장처럼 표시하지 않는다.

이번 범위에서 실제로 동작하는 화면은 로그인·비밀번호 재설정·공간 생성·초대·설정·홈이다.
추억·맛집·꾸미기는 `live`에서 **준비 중 안내**만 보여 준다(MEM-001 / FOOD-001 / THEME-001).

## 2. 환경 변수

`.env.example`을 `.env.local`로 복사해 채운다. 실제 값은 저장소에 넣지 않는다.

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 예 | Supabase API 주소 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 예 | 공개용 키. 구버전 `NEXT_PUBLIC_SUPABASE_ANON_KEY`도 읽는다 |
| `NEXT_PUBLIC_SITE_URL` | 아니오 | 인증 메일 링크가 돌아올 앱 주소. 없으면 요청 출처를 쓴다 |
| `NEXT_PUBLIC_DEMO_MODE` | 아니오 | `true`일 때만 데모 모드. 그 밖의 값·미설정은 데모를 켜지 않는다 |

관리자 키(`service_role`)는 **앱의 어떤 경로에도 쓰지 않는다.** 일반 요청은 사용자 세션과 RLS만 쓴다.
관리자 키가 필요한 작업은 운영자의 수동 절차(아래)와 로컬 테스트 픽스처뿐이다.

## 3. Supabase 프로젝트에서 사람이 해야 하는 설정

> 이 절은 **미실행**이다. 실제 프로젝트·SMTP 설정은 이번 작업에서 건드리지 않았다.

1. **공개 가입 차단.** Authentication → Providers → Email에서 신규 가입을 끈다.
   이 서비스는 두 사람만 쓰는 비공개 공간이라 공개 가입을 받지 않는다(DESIGN.md 1).
   앱에도 회원가입 화면이 없다. 가입이 켜져 있으면 Auth API로 직접 가입할 수 있으므로 반드시 끈다.
2. **Site URL과 Redirect 허용 목록.** Site URL에 앱 주소를, Redirect URLs에
   `<앱 주소>/auth/callback`과 `<앱 주소>/auth/confirm`을 넣는다.
   앱은 돌아갈 내부 경로를 허용 목록으로 다시 제한하므로(`src/features/auth/redirects.ts`)
   외부 주소로는 보내지 않는다.
3. **이메일 템플릿.** 기본 템플릿(`{{ .ConfirmationURL }}`)이면 `/auth/callback`으로 돌아온다.
   `{{ .TokenHash }}`를 쓰는 템플릿이면 `/auth/confirm?token_hash=...&type=...`으로 돌아온다.
   두 경로 모두 구현돼 있다.
4. **SMTP.** 비밀번호 재설정 메일이 실제로 전달되려면 SMTP를 설정해야 한다.
   **이번 작업에서 검증하지 않았다.** 로컬에서는 테스트 메일 서비스(Mailpit)로만 확인한다.

## 4. 첫 계정과 공간 준비 (운영자 수동 절차)

무제한 공개 가입이 없으므로 **첫 사용자 계정은 운영자가 만든다.**

1. Supabase 대시보드 Authentication → Users → Add user로 계정을 만들고 이메일 확인을 완료한다.
   (또는 관리자 키로 Admin API `POST /auth/v1/admin/users`에 `email_confirm: true`를 보낸다.)
2. 그 계정에 **최초 공간 생성 권한**을 준다. 이 목록은 DB에만 있고 클라이언트가 바꿀 수 없다.

   ```sql
   -- service_role 또는 postgres 연결에서
   select app_private.add_bootstrap_creator('첫사용자@example.com');
   ```

   목록이 비어 있으면 아무도 공간을 만들 수 없다(deny closed). 권한이 없는 계정이
   `/onboarding`에서 시도하면 "만들 권한이 없습니다"가 그대로 보인다.
3. 첫 사용자가 로그인하면 `/onboarding`에서 공간을 만든다. 이때 spaces·space_members·space_settings가
   한 트랜잭션으로 생성된다.
4. 공간을 만든 뒤에는 허용 목록에서 빼도 된다.

   ```sql
   select app_private.remove_bootstrap_creator('첫사용자@example.com');
   ```

## 5. 두 번째 사람 초대

1. 첫 사용자가 `/settings` → 초대에서 **상대방 이메일**로 초대 링크를 만든다.
2. 토큰은 **그 응답에서 한 번만** 나온다. DB에는 SHA-256 해시만 저장하므로 링크를 잃어버리면
   다시 볼 수 없고 새 초대를 만들어야 한다. 새 초대를 만들면 이전 활성 초대는 자동으로 폐기된다.
3. 링크를 메신저·메일 등으로 상대방에게 전달한다. 링크는 24시간 뒤 만료되고 한 번만 쓸 수 있다.
   토큰은 URL fragment(`/invite#token=...`)에만 들어간다. 서버 로그·리퍼러에 남지 않는다.
4. 상대방은 **초대 대상 이메일로 로그인한 계정**으로 링크를 연다.
   계정이 없다면 1단계와 같은 방법으로 운영자가 먼저 만들어 준다.
5. `/invite`가 fragment에서 토큰을 읽고 즉시 주소에서 지운다. 로그인이 필요하면 그 탭에만
   10분 동안 보관했다가 로그인 후 이어서 수락한다. 수락·무효·로그아웃 시 보관한 값을 지운다.
6. 정원은 두 명이다. 두 명이 차면 남은 활성 초대가 폐기되고 새 초대를 만들 수 없다.

실패 문구는 사유를 구분해 보여 준다: 만료 / 이미 사용·폐기·대상 불일치 / 정원 초과 /
이미 다른 공간 소속 / 이메일 미확인 / 재시도 가능.

## 6. 구현된 코드의 위치

| 영역 | 파일 |
| --- | --- |
| 설정 읽기·검증 | `src/lib/supabase/config.ts` |
| 브라우저·서버 클라이언트 | `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts` |
| 세션 갱신 미들웨어 | `src/lib/supabase/middleware.ts`, `src/middleware.ts` |
| 모드 판정 | `src/features/auth/mode.ts` |
| 오류 매핑 | `src/features/auth/errors.ts` |
| 열린 리다이렉트 방지 | `src/features/auth/redirects.ts` |
| 멱등성 키 | `src/features/auth/request-id.ts` |
| 초대 토큰 취급 | `src/features/auth/invite-token.ts` |
| 서버 작업 | `src/features/auth/actions.ts` |
| 세션·공간 조회 | `src/features/auth/queries.ts`, `guards.ts` |
| 화면 | `src/app/{login,reset-password,onboarding,invite,settings}`, `src/app/auth/{callback,confirm}` |

## 7. 보안 규칙 (코드에 고정한 것)

- 서버는 `getUser()`로 **Auth 서버가 검증한 사용자**만 신뢰한다. 쿠키의 세션 값을 그대로 믿지 않는다.
- 변경은 모두 DB의 `SECURITY DEFINER` RPC로만 한다. 테이블 직접 쓰기 권한은 어떤 역할에도 없다.
- 모든 변경 호출에 `requestId`를 보낸다. 같은 입력 재시도는 같은 키, 입력을 고치면 새 키다.
- 인증이 붙은 응답에는 `Cache-Control: private, no-store`를 붙인다(계정 전환 시 화면 재사용 방지).
- 로그에는 작업명·오류 코드·요청 ID만 남긴다. 토큰·비밀번호·이메일·본문은 남기지 않는다.
- 로그인 실패는 계정 존재 여부를 알려 주지 않는다. 재설정 메일 요청도 성공·실패 문구가 같다.
- 조회 권한 오류(42501)는 `NOT_FOUND`로 통일한다.

### 7.1 보호된 화면의 리다이렉트는 스트리밍으로 전달된다 (관찰된 동작)

로그인하지 않은 상태로 `/`·`/settings`·`/memories`를 요청하면 **HTTP 200에 `Location` 헤더가 없다.**
`redirect()`가 스트리밍 응답 안에서 전달되고 클라이언트 라우터가 `/login`으로 이동시킨다.
(로컬 개발 서버에서 직접 확인했다. `cache-control`은 `no-store, must-revalidate`로 내려온다.)

의미:

- 접근 제어는 화면마다 서버에서 다시 확인하므로 **동작은 올바르다.**
- 다만 "주소가 바뀌었는지"로 접근 차단을 판단하는 테스트·모니터링은 잘못된 결론을 낼 수 있다.
  `page.goto()` 직후의 주소는 아직 중간 상태다. 렌더된 화면으로 판정해야 한다
  (AUTH-001 1차 E2E 실패의 실제 원인이며, 지금 테스트는 화면 기준으로 기다린다).
- Auth 서버에 연결할 수 없을 때도 500이 아니라 로그인 화면으로 보낸다(같은 방법으로 확인).

### 7.2 인증 콜백은 반드시 **상대 경로**로 이동한다

`/auth/callback`·`/auth/confirm`은 세션 쿠키를 심은 직후 다음 화면으로 보낸다.
이때 `request.url`의 host로 절대 주소를 만들면 **요청 host와 달라질 수 있다.**
로컬에서 실제로 `127.0.0.1:3002`로 들어온 요청이 `http://localhost:3002/...`로 나갔다.

`localhost`와 `127.0.0.1`은 쿠키 관점에서 **다른 host**다. 그래서 방금 심은 세션 쿠키가
다음 요청에 실리지 않고, 사용자는 "확인은 됐는데 로그인이 안 된 화면"을 보게 된다.
오류도 남지 않아 원인을 찾기 어렵다(AUTH-001 2차 E2E에서 실제로 이 증상이 나왔다).

그래서 두 라우트는 `next/navigation`의 `redirect('/내부경로')`만 쓴다.

- `Location` 헤더에 상대 경로가 그대로 들어가고 브라우저가 **현재 출처** 기준으로 푼다.
- Next가 그 응답에 쿠키 변경분을 함께 실어 준다(라우트 모듈이 리다이렉트 응답에도 병합한다).
- 이동 경로는 여전히 허용 목록(`parseSafeNextPath`)을 통과한 값만 쓴다.

새 인증 경로를 추가할 때도 절대 주소를 만들지 않는다.

## 8. 이 작업에서 검증하지 않은 것

- **실제 메일 발송·수신 경로.** 재설정 확인은 로컬 관리 API로 만든 `token_hash`를 앱의
  `/auth/confirm`에 직접 넣어 검증한다. 메일에 담기는 링크가 앱 주소로 돌아오는지는 검증되지 않았다.
  현재 로컬 Auth는 `SITE_URL=http://127.0.0.1:3000`, `URI_ALLOW_LIST=https://127.0.0.1:3000`이고
  앱은 3002에서 돌기 때문이다. 이 설정은 이 작업에서 바꾸지 않았다.
- **운영 프로젝트의 공개 가입 차단.** 로컬 인스턴스는 `DISABLE_SIGNUP=false`다. 앱에 가입 화면이
  없더라도 Auth API로 직접 가입할 수 있으므로 **운영에서는 반드시 가입을 꺼야 한다**(3절 1번).
- **서버 벽시계 기준 토큰 만료.** 갱신 경로는 실제로 실행해 검증하지만(저장된 만료 시각을 과거로
  바꾸고 유효한 refresh token으로 갱신), `JWT_EXP=3600`을 줄여 실제 시간이 지난 뒤의 만료는
  확인하지 않았다. 컨테이너·Auth 설정을 바꾸지 않기 위해서다.
- 배포 환경(Vercel) 동작, 운영 계정·운영 데이터.
