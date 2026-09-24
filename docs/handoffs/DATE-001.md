# DATE-001 중간 인계 — Claude 사용 한도 차단

갱신: 2026-09-25. 브랜치 `codex/date-records`. **미완료 / 통합 불가**.

## 기준과 실행

- 기준 dev: `91dce48d2f0a1134ebf4d684838bde8d34f27c75` (CAL-001 통합).
- 별도 DATE Worktree에서 작업했다. dev/main 변경 없음.
- 구현 Claude 세션: `ad028528-963c-4339-84ab-73773c708778`.
- Codex 실행 ID: `74246`, 종료 코드 1, `is_error=true`, `terminal_reason=api_error`.
- 종료 사유: `You've hit your session limit · resets 3:30am (Asia/Seoul)`.
- 한도 해제 후 같은 구현 세션으로 재개해야 한다. 같은 실패 재호출·Codex 대체 구현은 하지 않았다.
- 로그: 제외된 `.agent-runtime/DATE-001-implement.jsonl`, 프롬프트 `.agent-runtime/DATE-001-implement.prompt.txt`.
- 내부 CLI의 제한된 Bash 권한 거부 5건이 있었다. 이후 Codex가 타입·단위·린트 검증을 직접 수행했다. 이 권한 거부와 최종 세션 한도 오류는 별개다.

## 보존된 미커밋 제품 변경

Claude가 아래 파일을 작성했으나 작업 도중 한도에 도달했다. 작성 여부는 기능 완료·검증 통과를 의미하지 않는다.

- `src/app/memories/new/page.tsx`, `src/app/memories/[id]/link/page.tsx`
- `src/features/memories/live/components/LiveMemoryForm.tsx`, `LiveMemoryScreens.tsx`, `LiveMemoryDetail.tsx`
- `src/features/memories/server/actions.ts`, 새 `member-session.ts`
- 새 `src/features/memories/links/**`: source·초기값·제목·cursor·입력·오류·타입, 조회·서버 작업, 연결 선택·상세·초안 컴포넌트
- `supabase/migrations/20260925120100_memory_links_date001.sql`
- `supabase/tests/92_memory_links_date001.sql`
- `tests/unit/date-{source,prefill,title,link-errors}.test.ts`

새 SQL과 SQL 테스트는 아직 실행하지 않았다. 제품 변경은 그대로 미커밋 보존했다. 이 보고서만 문서 커밋한다.

## 승인 범위 및 미완료 작업

최초 승인 범위는 memories, DATE 전용 migration/SQL/unit/E2E/handoff다. 실행 중 총괄이 다음 좁은 이관을 추가 승인했다.

- `src/features/wishes/components/WishDetailView.tsx`
- `src/features/calendar/components/EventDetailView.tsx`
- `src/features/wishes/errors.ts`, `src/features/calendar/errors.ts`
- 해당 상세 page의 데이터 전달에 필요한 최소 변경

목적은 완료 원본에서 추억 작성/연결 기록 탐색 및 `has_memories` GF409 안내뿐이다. 아직 이 후속 구현은 실행하지 않았다. 중앙 문서·AppShell·auth·package/lockfile은 금지 범위를 유지한다.

필수 삭제 계약: 추억 삭제는 링크만 함께 삭제하고 원본을 유지한다. 연결된 추억이 남은 일정·위시 삭제는 전용 RPC에서 GF409로 거부하며 먼저 연결된 추억을 삭제하라고 안내한다. 기존 캘린더 개인 일정 소유권·위시의 일정 참조 삭제 제한도 유지해야 한다.

## 실제 실행한 검증

| 검증 | 결과 |
| --- | --- |
| Node / pnpm | Node 22.22.3, pnpm 11.19.0 |
| frozen install | 397개 패키지 설치 성공, package/lockfile 수정 없음 |
| 타입 검사 | PASS (`tsc --noEmit`, 실행 25643) |
| 전체 lint | PASS (실행 6181) |
| 전체 단위 | **800 PASS / 1 FAIL, 총 801개**, 58파일 중 57 PASS / 1 FAIL (실행 66165) |
| git diff --check | PASS |
| 로컬 DB 상태 | 기존 6개 서비스 동작, loopback 포트 유지. 적용 전 집계 users7/spaces3/memories75/wishes0/events0, memory_links 없음 |

단위 실패: `tests/unit/date-title.test.ts:142`의 ‘자르지 않은 원문은 Zod 검증에서 거부된다’ 단언. `😀` 80개를 전달했을 때 기대 false와 달리 `saveMemoryInputSchema.safeParse(...).success`가 true였다. 제목 자르기 규칙·현재 Zod 길이 처리·테스트 전제를 같은 Claude 구현 세션에서 대조해야 한다. Codex가 제품이나 테스트를 임의 수정하지 않았다.

## 미실행 검증 / 잔여 작업

1. 추가 승인된 위시·일정 진입점/연결 탐색/삭제 오류 문구 구현.
2. 제목 경계 단위 실패 수정 및 구현의 미완료 구간 확인.
3. `tests/date/**`의 fixture·Playwright config·실제 E2E·동시성 검증 작성. 현재 이 디렉터리는 아직 없다.
4. DATE migration 실제 적용 및 SQL/RLS/공간 복합 FK/버전·멱등/삭제 경합 검증. DB·Storage 데이터 변경은 아직 없다.
5. 기존 추억·위시·캘린더 회귀, 사진 업로드·외부 접근 차단·재로그인·모바일·사진 OFF 검증.
6. 최종 타입/lint/unit/build, 비밀 값·브라우저 번들 검사.
7. 제품 SHA 커밋 후 **별도 새 Claude 읽기 전용 고정 base/head 독립 검토**, 지적 수정 후 새 검토.

독립 검토·제품 커밋·원격 push·PR·dev 통합·main 승격·배포는 모두 미수행이다. 최종 제품 SHA는 아직 없다.

## 재개 절차

한도 해제 뒤 활성 실행이 없는지 확인하고 `.agent-runtime/resume-date-claude.ps1`로 정확한 기존 세션에 추가 승인과 실패 증거를 전달한다. 새 구현 세션으로 중복 시작하지 않는다. runtime의 `DATE-001-approved-extension.txt`에 승인 기록, `DATE-001-state.md`에 실행 상태, `run-date-local.ps1`에 비밀 값 비출력 로컬 검증 실행기가 있다. 검증 예정 포트는 3008, 합성 namespace는 date-e2e다. 기존 CAL/MEM/WISH 계정이나 컨테이너를 초기화하지 않는다.
