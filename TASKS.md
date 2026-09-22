# 협업 작업 목록

갱신일: 2026-09-22 · 관리 담당: 총괄, 통합

상태: planned → assigned → in_progress → ready → integrated. 수정 요청은 changes_requested, 외부 조건 대기는 blocked로 기록한다. assigned는 지시 전달 완료, ready는 커밋·보고서 제출 완료, integrated는 총괄 검증·dev 반영 완료다. main 승격은 사용자 결정 후 별도로 기록한다.

## 작업과 의존성

| ID | 담당 | 범위·완료 기준 | 의존성 | 상태 |
| --- | --- | --- | --- | --- |
| OPS-001 | 총괄, 통합 | 협업 규칙, Worktree 분리, 첫 배분, 15분 자동화 등록 | 없음 | integrated |
| ENV-UI-001 | 홈, 추억, 꾸미기 (Codex) | 격리된 패키지 매니저 준비·설치 smoke test·포트 확인·환경 보고 | 없음 | integrated |
| ENV-DB-001 | DB (Codex) | Docker 엔진·가상화 상태 확인, 로컬 테스트 DB 도구 준비·실제 서비스 및 SQL 접속 확인 | 없음 | integrated |
| ENV-APP-001 | UI Codex → 로컬 Claude | Node 22·pnpm 고정·Next.js 골격·Dev Container 설정·설치/build 검증 | 저장소 일치 확인 | integrated |
| UI-001 | UI Codex → 로컬 Claude | 홈/추억/꾸미기 반응형 UI, 더미 데이터 경계, lint·타입·build | ENV-APP-001 | integrated |
| UI-DATE-001 | UI Codex → 로컬 Claude | 데모의 실제 관계 시작일 2025-01-27 반영, 한국 날짜 기준 일수 확인 | UI-001 | integrated |
| DB-001 | DB | DESIGN 기반 SQL migration, RLS·권한·초대·버전 처리 기반과 DB 테스트, 통합용 계약 문서 | 없음 | integrated |
| AUTH-001 | DB | 로그인·인증 콜백·세션·공간 초대 연결, 환경 변수 예제·설정 안내, 실제/로컬 검증 | UI-001, DB-001 통합 | integrated |
| MEM-001 | 홈, 추억, 꾸미기 | 추억 실제 CRUD·사진 업로드·필터 연결, 충돌·실패 처리 | AUTH-001 통합 | integrated |
| FOOD-001 | DB 담당 → 로컬 Claude | 맛집 목록·방문 상태·개인 후기, 권한·상태 전이 검증 | AUTH-001 통합 | in_progress |
| THEME-001 | 홈, 추억, 꾸미기 | 테마·커버·홈 구성의 실제 공유 저장과 미리보기 | MEM-001 통합 | planned |
| QA-001 | 총괄, 통합 | 전체 연결·모바일·외부 계정 접근 차단·업로드·백업 복원 확인 | 기능 구현 완료 | planned |

UI-001과 DB-001의 상세 지시는 각 Codex 담당 작업에 전달하고, 실제 구현과 코드 검토는 Claude Code CLI로 수행한다. 후속 작업은 의존성이 충족된 뒤 실제 결과에 맞춰 범위를 구체화한다. 앱 설정·lockfile은 UI-001에서만 생성하고 DB-001은 수정하지 않는다.

최신 배분(2026-09-21): AUTH-001 통합 후 UI 담당에게 MEM-001, DB 담당에게 FOOD-001을 각각 배정한다. 두 작업은 최신 dev에서 별도 Worktree·기능 브랜치를 만들고 로컬 Claude 구현과 새 세션의 읽기 전용 독립 검토를 관리한다. MEM 담당은 추억 화면·사진·홈의 추억 요약, FOOD 담당은 맛집 화면·후기·DB 계약을 소유한다. 공통 인증·앱 설정·홈의 맛집 요약은 사전 조율 없이 함께 수정하지 않는다.

2026-09-22 재개: 두 기존 담당 작업에 각자 미완료 검증·Claude 수정·새 Claude 독립 검토를 재배정했다. MEM-001은 검토·검증 후 dev에 통합했으며 FOOD-001은 담당 작업에서 계속 진행한다. 지정 Claude 클라우드 세션에는 이전 dev SHA의 읽기 전용 사전 검토 재개만 전달했고 실제 완료 응답은 아직 확인되지 않았다.

## 역할별 작업 공간

| 역할 | 브랜치 계획 | 위치 |
| --- | --- | --- |
| 총괄, 통합 | dev | 기존 통합 checkout, dev로 전환 완료 |
| 홈, 추억, 꾸미기 | feat/ui-foundation 완료; MEM-001은 최신 dev에서 새 기능 브랜치 | Codex 담당이 새 Worktree 준비 |
| DB | feat/db-foundation·codex/auth-foundation 완료; FOOD-001은 최신 dev에서 새 기능 브랜치 | Codex 담당이 새 Worktree 준비 |

개인 컴퓨터의 작업 ID·Worktree 절대 경로·자동화 ID는 총괄 대화에 보관한다. 공개 저장소의 문서는 다른 환경에서도 사용할 수 있도록 역할·작업 ID·브랜치 기준으로 작성한다.

## 통합 기록

| 작업 ID | 검토 커밋 | dev 반영 커밋 | 검증 결과 |
| --- | --- | --- | --- |
| ENV-UI-001 | 5d0475e | 6a32015 | 환경 문서 검토, 총괄이 pnpm 11.19.0·격리 패키지 Node 단언 재확인. 제품 앱은 아직 미구현 |
| ENV-DB-001 초기 조사 | c49549b, 23a13bc | dc70419, dbc3396 | 환경 조사 문서만 통합. 실제 DB 준비는 후속 확인 중 |
| ENV-DB-001 실행 검증 | 247be10 | 95c4425 | PostgreSQL SELECT 1, Auth/REST/Storage HTTP 200, 3개 호스트 포트 loopback 제한 확인. 제품 migration/RLS는 미실행 |

| DB-001 | 59fa491 (최종 제출 ff19d53) | 44f9285 | 독립 검토 승인, 총괄 단일 세션 7개/294 단언 재확인. 담당 동시성 5개 통과. 실제 파일 HTTP/앱 인증 연결은 후속 |

| ENV-APP-001 / UI-001 | UI 87d99e4, 환경 d429216 (최종 4c21725) | f384db6 | 새 Claude 독립 승인, 호스트 unit110 총괄 재확인, 컨테이너 실행 증거·격리 inspect 확인. 필수 검증 통과 |
| UI-DATE-001 | a198a5f (최종 제출 4124087) | 9bb9dd7, b1329d2 | 새 Claude 독립 승인, 한국 날짜 2026-09-21에 603일 확인, 날짜 단위 테스트 21개 통과 |
| AUTH-001 | 8d6a97d (최종 제출 5516ffb) | 0a2e6c3, ee8a38d, a90d927, 060ed10 | Claude 전체 검토·수정분 재검토 승인. 최종 실제 인증 E2E 23개, 총괄 단위 219개·타입 검사·diff check 재확인 |
| MEM-001 | dcfebc3 (최종 제출 ec60e5a) | 96c1230 | 새 Claude 독립 검토 승인. 담당 추억 E2E 22개·사진/Storage 27개·인증 9개·데모 48개 통과. 총괄 단위 282개·린트·타입 검사·빌드 재확인 |

## 운영 상태

- 초기에는 사용자가 만든 담당 작업 두 개를 재사용한다. 별도 작업을 임의로 추가 생성하지 않는다.
- 서비스 자격 증명 없이 가능한 UI·SQL·테스트 작성부터 진행한다.
- 작업 보고서는 docs/handoffs/에 저장한다. 담당자는 중앙 TASKS.md를 수정하지 않는다.
- 일정 확인 자체로 코드 완료나 실제 서비스 설정 완료를 주장하지 않는다.
- 2026-09-19: 담당 Worktree 2개와 기능 브랜치 분리 완료. Claude Code 2.1.273 실행·로그인 확인 완료. UI-001·DB-001 지시 전달 후 두 Codex 작업의 active 상태 확인.
- 2026-09-19: 총괄 대화에서 15분 간격 heartbeat 활성화. 구현·독립 코드 검토는 Claude 담당이며 중요 변화만 보고하도록 설정.
- 2026-09-19 후속: 두 로컬 Claude 구현 호출은 ConnectionRefused로 종료했고 제품 코드 변경은 없다. UI 차단 보고서 커밋 071b3794a50c05372c09f1dcc4c6d8e570da8019, DB 차단 보고서 커밋 05807f0a925c5dc9b1252d844a86f3cd0551addd는 각각 담당 브랜치에 있으며 구현 완료로 취급하지 않는다.
- 사용자가 기존 Claude 데스크톱 세션을 지정했다. 총괄의 공식 CLI 메시지 전달은 성공했으나 세션의 저장소·답변 확인은 대기 중이다. 개인 세션 ID는 총괄의 로컬 .agent-runtime/claude-target.json에 기록한다.
- 재개 조건: 지정 세션과 girlfriend 저장소의 연결 확인. 이후 지시는 총괄만 전달하며 담당 Codex 작업은 새 로컬 Claude 세션을 생성하지 않는다. DB 실제 검증에는 실행 가능한 테스트 DB 환경도 필요하다.
- 2026-09-19 최신 지시: 사용자가 격리 개발환경 준비와 작업 시작을 요청했다. Codex UI·DB 환경 준비 작업을 배정했다. 지정 Claude 세션에 저장소 일치 확인을 선행 조건으로 ENV-APP-001 → UI-001 구현 지시를 전달했고 CLI 전송 성공을 확인했다. 실행·완료는 브랜치와 보고서로 추가 확인한다.
- 2026-09-19 브랜치 정책 변경: 2590e2e에서 dev 생성·원격 push 완료. 앞으로 기능 브랜치 → dev에서 개발·검증하고, 사용자가 확정한 범위만 main으로 승격한다. 이전 main 반영 기록은 정책 변경 전 이력이다.
- 2026-09-19 Docker 후속: 사용자가 Docker를 실행한 뒤 총괄이 Server 29.6.1과 docker ps 응답을 확인했다. 기존 실행 컨테이너 없음. DB 담당에 독립 로컬 Supabase 환경 init/start 및 SQL·서비스 health 검증을 재배정했다.
- 2026-09-19 DB 환경 완료: 프로젝트 전용 6개 서비스 실행 및 접속 확인. API 127.0.0.1:56321, PostgreSQL 127.0.0.1:56322, 테스트 메일 127.0.0.1:56324. 환경 유지·중지·재개는 docs/environments/DB.md의 지정 컨테이너 명령을 사용한다. pre-loopback 백업 컨테이너는 시작하지 않는다.

- 2026-09-19 로컬 전환: 사용자 승인으로 기존 클라우드 전용 규칙 해제. UI/DB 로컬 구현과 새 세션 독립 검토를 허용했다. 과거 클라우드·신규 세션 금지 관련 기록은 이 최신 결정으로 대체된다.
- UI-001 제출: feat/ui-foundation 95221682e5c3dc00562f4de0a245dc5f581b6c52, 제품 검토 SHA 87d99e4ab6f87da70e9a551efb2f280dda3f8268 독립 승인. 총괄 unit110 재확인. ENV-APP-001 Dev Container 생성/실행 검증 미완료로 전체 통합 대기. 정상 파일 승인 경로 조사와 해당 환경 항목만 후속 배정.

## AUTH-001 후속 배정

DB 담당은 최신 dev에서 codex/auth-foundation 브랜치로 시작한다. 소유 범위를 인증용 src/lib/supabase, src/features/auth, 로그인·콜백·온보딩·초대·설정 화면, 세션 갱신 미들웨어, 인증 연결에 필요한 app layout/AppShell, .env.example, package.json/pnpm-lock.yaml, 인증 테스트·문서로 확장한다. UI 담당은 이 작업 동안 공통 앱 파일을 수정하지 않는다. 기존 데모 UI는 명시적 데모 진입으로 구분하고 환경 누락 시 실제 인증 성공으로 표시하지 않는다. 로컬 Supabase 합성 계정으로 로그인·로그아웃·세션·공간 생성·초대·외부 계정 차단을 검증하며 운영 계정/SMTP/배포 설정은 변경하지 않는다. DB SQL 계약 변경은 사유·영향과 회귀 검증을 보고한다. 구현·새 독립 검토를 Claude가 수행하며 다음 기능은 별도 배정한다.
- 2026-09-20 AUTH-001: 제품 6c24736, 보고 e69b89e. 담당 보고상 unit200/demo E2E48/실제 인증 E2E21 통과. Claude session limit으로 독립 검토 미실행. 03:20 KST 이후 새 읽기전용 검토 재배정, 승인 전 통합 보류. 기존 보고·push 승인 문제는 총괄이 로컬 보고서를 읽어 인수했으며 사용자의 저장소 통합 승인 범위에서 후속 처리한다.
- 2026-09-21 AUTH-001: 독립 전체 검토와 수정분 재검토 완료. 최종 제품 8d6a97d, 인수인계 5516ffb. 총괄이 단위 219개·타입 검사·diff check를 재확인하고 dev 060ed10까지 통합했다. 운영 SMTP·가입 차단·재인증 설정은 미검증이며 QA-001 범위로 남긴다.

## MEM-001·FOOD-001 병렬 배분

- MEM-001(UI 담당): 실제 인증 공간에서 추억 생성·목록/월·태그 필터·상세·수정·삭제, 사진 업로드/조회/정리, 버전 충돌·중복 제출·실패 표시를 구현한다. `src/app/memories/**`, `src/features/memories/**`, 추억 카드와 홈의 추억 요약을 소유한다. 홈 연결은 `src/app/page.tsx`의 추억 child 전달과 `src/features/auth/components/LiveHome.tsx`의 추억 slot만 최소 변경할 수 있다. `tests/memories/**`, `tests/unit/memories-*`, `playwright.memories.config.ts`도 담당 소유다. 기존 데모 화면은 유지하고 실제 저장 성공처럼 보이지 않게 분리한다. 로컬 합성 두 계정·외부 계정으로 RLS/Storage 접근과 새 로그인 후 지속성을 검증하되 전용 합성 계정·namespace·포트 3003으로 FOOD 테스트와 충돌을 피한다. 맛집 요약·인증 판단·공통 설정·의존성 변경은 총괄과 먼저 조율한다.
- MEM-001 사진 예외 승인: `DESIGN.md` 8.2와 DB-001의 `finalize_upload`는 신뢰 서버 역할만 허용한다. MEM 담당은 `sharp`·`server-only` 직접 의존성에 필요한 `package.json`/`pnpm-lock.yaml`, 서버 비밀 변수 이름 설명만 담는 `.env.example`, 구현된 사진 워커에 맞춘 `docs/auth/SETUP.md`의 한정 예외를 소유한다. 관리자 키는 별도 서버 전용 모듈에서만 사용하고 인증 사용자·asset 소유·공간·경로 검증 후 실제 파일 디코딩·치수·바이트·MIME 검사와 확정에 쓴다. 브라우저·로그·저장소·SSR 쿠키 클라이언트로 전달하지 않는다. 초기 삭제 정리는 수동 절차를 우선하며, 반드시 필요한 SQL wrapper는 service_role 전용 권한·상태 재검증·테스트를 갖춘 MEM 고유 migration 파일로 제안한다. FOOD 담당은 이 공통 파일과 MEM 사진 migration을 수정하지 않는다.
- MEM-001 인증 테스트 예외 승인: 실제 `/memories` 연결에 따라 기존 `tests/auth/e2e/session.spec.ts`의 추억 화면 기대값 한 곳과 `tests/auth/README.md`의 관련 설명만 MEM 담당이 조정할 수 있다. 인증·초대 동작이나 다른 인증 테스트 범위는 변경하지 않으며, 변경 이유와 인증 E2E 회귀 결과를 MEM-001 인수인계에 남긴다.
- FOOD-001(DB 담당): 실제 인증 공간에서 맛집 등록·목록/검색/필터·방문 상태/날짜·사용자별 별점과 한 줄 후기·수정/삭제를 구현한다. `src/app/restaurants/**`, `src/features/restaurants/**`, 필요 시 `supabase/migrations/**`와 `supabase/tests/**`를 소유한다. 두 구성원의 공용 수정 권한과 개인 후기 본인 수정 권한, 입력 검증, 버전 충돌·중복 제출·실패 표시를 확인한다. 검증은 FOOD 전용 합성 계정·namespace·포트 3004로 MEM의 3003과 분리한다. 홈·추억·인증·공통 설정 수정은 총괄과 먼저 조율한다.
- 양쪽 모두 최신 dev에서 별도 Worktree·기능 브랜치를 시작하고 Claude 구현·별도 새 읽기 전용 검토 후 커밋 SHA·검증·잔여 문제를 `docs/handoffs/<작업ID>.md`로 보고한다. 담당자는 dev/main을 직접 수정하지 않는다.
