# 협업 작업 목록

갱신일: 2026-09-19 · 관리 담당: 총괄, 통합

상태: planned → assigned → in_progress → ready → integrated. 수정 요청은 changes_requested, 외부 조건 대기는 blocked로 기록한다. assigned는 지시 전달 완료, ready는 커밋·보고서 제출 완료, integrated는 총괄 검증·dev 반영 완료다. main 승격은 사용자 결정 후 별도로 기록한다.

## 작업과 의존성

| ID | 담당 | 범위·완료 기준 | 의존성 | 상태 |
| --- | --- | --- | --- | --- |
| OPS-001 | 총괄, 통합 | 협업 규칙, Worktree 분리, 첫 배분, 15분 자동화 등록 | 없음 | integrated |
| ENV-UI-001 | 홈, 추억, 꾸미기 (Codex) | 격리된 패키지 매니저 준비·설치 smoke test·포트 확인·환경 보고 | 없음 | assigned |
| ENV-DB-001 | DB (Codex) | Docker 엔진·가상화 상태 확인, 로컬 테스트 DB 도구 준비·환경 보고 | 없음 | assigned |
| ENV-APP-001 | 지정 Claude 세션 | Node 22·pnpm 고정·Next.js 골격·Dev Container 설정·설치/build 검증 | 저장소 일치 확인 | assigned |
| UI-001 | 지정 Claude 세션 | 홈/추억/꾸미기 반응형 UI, 더미 데이터 경계, lint·타입·build | ENV-APP-001 | assigned |
| DB-001 | DB | DESIGN 기반 SQL migration, RLS·권한·초대·버전 처리 기반과 DB 테스트, 통합용 계약 문서 | 없음 | blocked |
| AUTH-001 | DB | 로그인·인증 콜백·세션·공간 초대 연결, 환경 변수 예제·설정 안내, 실제/로컬 검증 | UI-001, DB-001 통합 | planned |
| MEM-001 | 홈, 추억, 꾸미기 | 추억 실제 CRUD·사진 업로드·필터 연결, 충돌·실패 처리 | AUTH-001 통합 | planned |
| FOOD-001 | 총괄이 후속 배정 | 맛집 목록·방문 상태·개인 후기, 권한·상태 전이 검증 | AUTH-001 통합 | planned |
| THEME-001 | 홈, 추억, 꾸미기 | 테마·커버·홈 구성의 실제 공유 저장과 미리보기 | MEM-001 통합 | planned |
| QA-001 | 총괄, 통합 | 전체 연결·모바일·외부 계정 접근 차단·업로드·백업 복원 확인 | 기능 구현 완료 | planned |

UI-001과 DB-001의 상세 지시는 각 Codex 담당 작업에 전달하고, 실제 구현과 코드 검토는 Claude Code CLI로 수행한다. 후속 작업은 의존성이 충족된 뒤 실제 결과에 맞춰 범위를 구체화한다. 앱 설정·lockfile은 UI-001에서만 생성하고 DB-001은 수정하지 않는다.

최신 배분: 제품 골격·설정·lockfile·Dev Container는 지정 Claude 세션의 ENV-APP-001 소유다. Codex UI·DB 작업은 각각 docs/environments/UI.md, docs/environments/DB.md와 로컬 도구 준비만 담당한다. Claude 제품 브랜치는 feat/claude-foundation으로 요청했으며 원격 생성 여부는 실제로 확인한다. 첫 단계 후 DB-001을 별도로 배정한다.

## 역할별 작업 공간

| 역할 | 브랜치 계획 | 위치 |
| --- | --- | --- |
| 총괄, 통합 | dev | 기존 통합 checkout, dev로 전환 완료 |
| 홈, 추억, 꾸미기 | feat/ui-foundation | Codex 관리 Worktree 분리 완료 |
| DB | feat/db-foundation | Codex 관리 Worktree 분리 완료 |

개인 컴퓨터의 작업 ID·Worktree 절대 경로·자동화 ID는 총괄 대화에 보관한다. 공개 저장소의 문서는 다른 환경에서도 사용할 수 있도록 역할·작업 ID·브랜치 기준으로 작성한다.

## 통합 기록

| 작업 ID | 검토 커밋 | dev 반영 커밋 | 검증 결과 |
| --- | --- | --- | --- |
| - | - | - | 아직 구현 통합 없음 |

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
