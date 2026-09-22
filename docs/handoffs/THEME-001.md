# THEME-001 인수인계 — Claude 서버 과부하로 구현 대기

- 작업: THEME-001 · 브랜치: `codex/customization`
- 시작 기준: `4c20acdb9ae41fc89f65f0ed256d1837f59d1d70` (`origin/dev` 확인 후 별도 Worktree 생성).
- 상태: **blocked — 제품 미구현, 통합 준비 아님.**
- 제품 변경: 없음. 이 보고서만 추가했다.

## 승인된 구현 범위

실제 인증 공간의 `/customize`에서 cream/rose/sage 테마, accent, 커버, 홈 섹션 표시·순서, 로컬 미리보기와 저장·취소·충돌 처리를 구현한다. 재로그인·상대방 새로고침 후 같은 저장 상태를 보여야 한다.

`save_customization`의 expectedVersion/requestId 계약을 사용한다. 추억 고정은 기존 `setMemoryPinnedAction`의 별도 명시적 저장으로 구분하며 꾸미기 저장과 부분 성공·실패를 혼동하지 않게 한다.

총괄 승인 범위:
- `src/app/customize/**`, `src/features/customize/**`, 관련 테스트·문서.
- `LiveHome.tsx`, `LiveMemorySummary.tsx`, `src/app/page.tsx`는 커버·섹션 표시·순서 연결만 수정.
- MEM `finalize-core.ts`에 호출자가 명시하는 필수 `memory | cover` 용도를 추가하고 기존 memory 호출 지점·관련 회귀 테스트만 조정. 업로더·공간·목적·상태·경로·실제 파일 검증과 객체 불변 조건 유지.
- 커버 전용 액션·비공개 사진 조회 경로. 기존 서버 전용 MEM 사진 검증·정리 재사용.
- SQL·맛집·공통 패키지·설정 변경 없음. 추가 공통 수정은 총괄과 먼저 조율.
- 실제 검증은 포트 3005, 합성 namespace `theme-e2e`, 제외된 전용 계정 파일로 분리.

## Claude 실행 결과

- 도구 없는 연결 확인: 성공 (`THEME_CONNECTION_OK`).
- 새 구현 세션: `46fa9f32-6265-44ce-859f-3764d01f3db5`.
- 구현 호출 결과: 종료 코드 1, `is_error: true`, `API Error: 529 Overloaded`.
- 도구 권한 거부: 없음. 서버 과부하로 구현 전에 종료했다.
- 독립 검토: 미실행. 구현 커밋이 없어 검토 대상 head SHA도 아직 없다.
- 원시 프롬프트·출력·실행 ID는 Git에서 제외한 `.agent-runtime/`에 보관한다. 비밀 값은 보고서에 기록하지 않는다.

## 준비·검증

- 현재 경로·브랜치·clean 상태와 최신 origin/dev SHA 확인.
- 프로젝트 기획·기술·설계·작업 목록·협업·Claude 실행 규칙 확인.
- 고정 lockfile로 `pnpm install --frozen-lockfile` 성공. 패키지/lockfile 변경 없음.
- 전용 포트 3005에서 기존 LISTEN 없음 확인.
- 로컬 테스트 키를 출력·파일 저장 없이 프로세스 환경으로만 전달하는 제외된 실행기 준비.
- 제품 lint/type/unit/build/E2E는 미실행. 기능 구현이 시작되지 않았으므로 완료 증거로 취급하지 않는다.
- 최종 커밋 SHA는 커밋 후 완료 응답으로 전달한다.

## 재개 조건

Claude 서버 과부하가 해소되거나 총괄이 후속 재개를 배정하면, 실행 중인 동일 작업이 없는지 확인한 뒤 위 구현 세션을 정확한 ID로 이어간다. 같은 실행에서 동일 실패를 반복 재시도하지 않는다. Codex가 제품 구현을 대신하지 않는다.

구현 완료 후 실제 저장·커버/권한·충돌·응답 유실·고정 별도 결과·모바일·기존 MEM/데모 회귀를 검증하고, 고정 base/head SHA에 대한 새 읽기 전용 Claude 독립 검토를 수행한다. dev/main 변경과 다음 기능 배정은 총괄 담당이다.
