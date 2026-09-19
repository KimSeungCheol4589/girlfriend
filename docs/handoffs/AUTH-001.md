# AUTH-001 인수인계

- 담당 브랜치: `codex/auth-foundation` · 통합 대상: `dev`
- 기준 SHA: `814615fdf3c12c9ef7f7d1c15cc989fd9e04ee4b`
- 제품 구현 SHA / 독립 검토 대상: `6c24736d92ae3e59e0f8c8356fa16aed32dc57a6`
- 상태: **구현·로컬 검증 완료, 필수 독립 검토 대기**.
- 통합 준비: **미완료**. 새 Claude 검토 호출이 사용 한도에 차단됐으며 검토 결과는 없다.
- 재개 조건: 안내된 2026-09-20 03:20 KST 한도 초기화 이후 새 읽기 전용 Claude 세션으로 위 base/head 검토. 구현 세션의 자기 평가를 승인으로 취급하지 않는다.

## 변경 요약과 파일 범위

Supabase SSR 브라우저/요청별 서버 클라이언트, 서버 검증 사용자와 쿠키 갱신, 로그인·로그아웃·인증 콜백·비밀번호 재설정을 연결했다. 기존 DB RPC/RLS로 최초 허용 계정의 공간 생성, 초대 생성·폐기·수락, 구성원 표시, 본인 프로필과 공유 공간 설정을 처리한다. 일반 앱 요청에는 service_role 키를 사용하지 않는다.

데모는 `NEXT_PUBLIC_DEMO_MODE=true`로 명시한 경우에만 켜진다. 설정이 없으면 설정 필요 화면을 표시하고, 실제 모드에서는 데모 저장소를 마운트하지 않는다. 추억·맛집·꾸미기 실제 CRUD는 후속 범위이며 현재 실제 모드에서는 준비 중 안내를 표시한다.

변경 범위:

- `src/lib/supabase/**`, `src/features/auth/**`, `src/middleware.ts`.
- `src/app/auth/**`, 로그인·온보딩·초대·재설정·설정 routes, 인증/데모 분리에 필요한 기존 route와 layout.
- `src/components/AppShell.tsx`, `src/components/DemoShell.tsx`.
- `package.json`, `pnpm-lock.yaml`, `.env.example`, Playwright 인증/데모 설정.
- `tests/auth/**`, `tests/unit/auth-*.test.ts`.
- [설정 가이드](../auth/SETUP.md), [테스트 안내](../../tests/auth/README.md), 이 보고서.

DB migration·SQL 테스트·TASKS·공통 설계·Dev Container는 변경하지 않았다. 기존 DB의 16개 migration을 재적용하거나 reset·컨테이너 재생성·백업 컨테이너 시작을 하지 않았다.

## 검증 결과

| 검증 | 최종 결과 / 실행 주체 |
| --- | --- |
| 의존성 설치 | Node 22.22.3, pnpm 11.19.0. 담당 Worktree에 설치, lockfile 갱신. Codex |
| 전체 타입 검사·lint | 통과. Codex 초기 직접 확인, Claude 최종 콜백 수정 후 재확인 |
| 단위 테스트 | **200개 / 14파일 통과**. Claude 최종 실행 로그 확인 |
| production build | **통과, 15 routes + middleware**. Codex 초기 직접 확인, Claude 최종 재확인 |
| 데모 E2E | **48개 통과**. Claude 실행 로그 확인 |
| 데모 HTTP smoke | **14개 통과**. 첫 HTTP500/정지 실행은 실패로 구분하고 후속 재실행 성공 확인 |
| 실제 로컬 인증 E2E | **21개 전부 통과, 종료 코드0**. Codex가 제품 SHA에서 최종 전체 실행 |
| 픽스처 정리 | A/B/C/D 계정·합성 공간·요청 기록·허용 목록·로컬 비밀번호 파일 정리 성공, 종료 코드0 |
| 독립 Claude 검토 | **실행되지 않음**. 새 세션 호출 결과 is_error=true, session limit |

인증 E2E는 비로그인 직접 URL, 로그인/로그아웃/새 탭, 캐시 no-store, 허용 목록과 외부 계정 거부, 초대 만료/대상 불일치/재사용/정원2명, 본인 프로필 격리, 실제 토큰 갱신과 폐기된 갱신 토큰 거부, 복구 token_hash 확인·새 비밀번호 저장·재로그인·링크 재사용 거부, 잘못된 콜백과 외부 리다이렉트 거부를 포함한다.

Auth 로그의 Invalid Refresh Token은 폐기된 토큰 거부 시나리오에서 발생한 예상 오류다. 키·토큰·비밀번호 값은 출력하지 않았다. 인증 테스트 reporter는 실패 문맥 파일의 페이지 snapshot 블록을 제거하며 실제 생성 파일에서 제거 결과를 확인했다.

## 실패와 수정 이력

1. 첫 인증 E2E는 스트리밍 리다이렉트 완료 전에 URL로 화면을 판단해 공간 생성 단계를 건너뛰었다. 실제 화면 표식을 기다리도록 Claude가 테스트를 수정했다.
2. 다음 실행은 17통과/1실패/3미실행이었다. 복구 콜백에서 127.0.0.1 → localhost로 이동해 쿠키 호스트가 달라졌다. 두 인증 콜백을 검증된 내부 상대 경로로 이동하도록 수정했다.
3. 복구만 실행하려던 `pnpm run ... -- recovery.spec.ts`가 전체 실행으로 해석돼 이미 정원2명인 공간의 초대 시나리오가 실패했다. 복구5개는 통과했으나 그 실행 전체는 실패다. 이후 이번 작업 픽스처만 teardown/setup하고 최종 전체21개를 통과했다. 선택 실행에는 `pnpm exec playwright test --config playwright.auth.config.ts recovery.spec.ts` 형태를 사용한다.
4. 샌드박스 spawn EPERM과 Claude의 pnpm PATH 문제는 승인된 Codex 실행에서 정상 설치·검증했다. 권한 우회/전역 설정 변경은 하지 않았다.
5. Playwright의 NO_COPY_PROMPT 설정만으로 snapshot이 꺼진다는 초기 가정은 실제 실패 파일로 반증됐다. Claude가 인증 전용 reporter를 추가하고 회귀 검증했다.

## Claude 실행·검토 증거

- 구현 세션: `43d1322c-85ab-4e06-b753-3b651161b238`. 최초 구현과 두 차례 수정 호출 모두 동일 세션. 제품 코드를 Codex가 대신 작성하지 않았다.
- 새 독립 검토 시도: `c7b95e13-9618-41e6-a706-33ef7b88a599`. base/head 고정, Read/Glob/Grep·읽기 전용 Git만 제공, Edit/Write 제외.
- 검토 결과: `You've hit your session limit`, 03:20 KST 재개 안내. 실제 검토는 시작하지 못했다. 같은 실패를 반복 호출하지 않았다.
- 프롬프트·실행 결과·원시 증거: Git 제외 `.agent-runtime/AUTH-001-implement.*`, `AUTH-001-fix-v1.*`, `AUTH-001-fix-v2.*`, `AUTH-001-review-v1.*`, `AUTH-001-e2e-v4.log`, `AUTH-001-fixture-final-teardown.log`.
- 총괄 자동 보고는 자동 승인 검토가 대상/전송 내용 승인 미확인을 이유로 차단했다. 사용자 승인 질문은 미응답이며 우회 전송하지 않았다. 원격 push도 기존 대상 전송 승인 문제가 해소되기 전 보류했다. 로컬 커밋으로 인수 가능하다.

## 제한과 후속

- **독립 검토 후에만 통합 판단**. 검토 지적은 같은 브랜치에서 Claude로 수정하고 변경 SHA를 새 세션으로 재검토한다.
- 실제 SMTP 발송·수신과 메일의 앱 복귀 주소는 미검증이다. 로컬 관리 API가 만든 복구 token_hash를 앱 확인 경로에 직접 전달해 검증했다. 기존 Auth의 SITE_URL/허용 목록3000과 테스트 앱3002 차이는 유지했다.
- 운영 공개가입 차단 설정은 미실행이다. 앱에 공개가입 UI/API를 추가하지 않았지만 기존 로컬 Auth는 DISABLE_SIGNUP=false이므로 Auth 직접 가입은 가능하다. 운영에서는 가이드에 따라 가입을 반드시 비활성화하고 운영자 수동 계정 준비/초대 절차를 사용해야 한다.
- 갱신 검증은 저장된 세션 expires_at을 과거로 바꾸고 유효한 refresh token으로 실제 갱신·쿠키 회전을 확인했다. 서버 JWT_EXP=3600을 줄이거나 벽시계 만료까지 기다린 검증은 아니다.
- 합성 계정은 이메일 확인 상태로 준비했다. 미확인 이메일의 전체 앱 흐름, 실제 모바일 기기·접근성, 배포 환경은 미검증이다.
- `tests/unit/auth-redirects.test.ts`는 리터럴 제어문자로 Git이 binary로 표시한다. 독립 검토 시 읽기 도구로 내용을 확인하고 필요하면 Claude가 이스케이프로 바꿔 검토 가능성을 개선한다.
- AUTH 전용 FORBIDDEN 오류 목록과 기존 UI 공통 계약 목록은 별도로 존재한다. 통합 시 확인 대상이다.

다음 기능은 총괄 배정 전 시작하지 않는다. dev/main에는 직접 반영하지 않았다.
