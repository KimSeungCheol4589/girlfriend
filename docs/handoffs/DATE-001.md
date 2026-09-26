# DATE-001 인계 — 구현 재개 완료, 독립 검토 대기

갱신: 2026-09-26. 브랜치 `codex/date-records`. **독립 검토 전 / dev 통합 불가**.

## 기준과 실행

- 기준 dev: `91dce48d2f0a1134ebf4d684838bde8d34f27c75` (CAL-001 통합). dev/main 변경 없음.
- 별도 DATE Worktree(`codex/date-records`)에서만 작업했다.
- 2026-09-25 한도 차단으로 미커밋 보존했던 변경을 그대로 이어받아 완료했다. 새 구현을 처음부터
  다시 쓰지 않았고, 보존 파일을 덮어쓰지 않았다.
- 재개 세션: 사용자가 지정한 기존 Claude 데스크톱 세션 `session_015jpN88JrPrHTJLvCa8iUdq`.
  이전 구현 세션 `ad028528-963c-4339-84ab-73773c708778`의 산출물을 입력으로 삼았다.
- 기존 Supabase 컨테이너·합성 계정은 reset/recreate하지 않았다.

## 이번 재개에서 한 일

### 1. 제목 경계 단위 실패 수정 (이전 인계의 잔여 1건)

원인은 제품 코드가 아니라 **테스트 전제**였다. 실제로 세 층의 세는 단위가 다르다.

| 층 | 세는 단위 | `'😀' × 80` |
| --- | --- | --- |
| 브라우저 `maxLength`, 폼의 글자수 표시 | UTF-16 코드 유닛(160) | 초과로 보임 |
| Zod 4 `.max(80)` | 코드 포인트(80) | 통과 |
| PostgreSQL `char_length(title) <= 80` | 코드 포인트(80) | 통과 |

이전 테스트는 "자르지 않으면 Zod가 거부한다"고 단언했지만 Zod 4는 코드 포인트를 세므로 통과한다.
`fitTitle`의 코드 유닛 기준 자르기는 **폼까지 함께 만족시키려는 의도**라 그대로 두고, 근거 주석과
테스트를 사실에 맞게 고쳤다(`'😀' × 81`은 실제로 거부됨을 단언하고, 유닛 기준이 Zod보다 엄격하다는
사실을 별도 테스트로 명시).

- `src/features/memories/links/title.ts` (주석만)
- `tests/unit/date-title.test.ts`

### 2. 승인된 위시·일정 진입점과 연결 탐색, 삭제 거부 안내

- 새 공용 표시 컴포넌트 `src/features/memories/links/components/SourceMemoriesPanel.tsx`
  - 완료한 원본에만 "기록 남기기" 입구를 만든다(미완료면 안내만). DB 트리거의 `..._not_done`
    거부를 화면에서 먼저 막는다.
  - 입구 주소에는 `?source=&sourceId=`만 싣는다. 제목·날짜·장소는 URL에 넣지 않는다.
  - 연결된 기록을 목록으로 보여 주고, 연결이 있으면 원본을 지울 수 없다는 사실을 미리 알린다.
  - 조회 실패를 빈 목록으로 바꾸지 않고 실패로 알린다(연결이 사라진 것처럼 보이면 중복 기록이 생긴다).
- 새 조회 `listSourceMemories()` (`src/features/memories/links/server/queries.ts`,
  타입은 `../types.ts`): 사용자 세션 + RLS로만 읽는다. 서비스 키를 쓰지 않는다.
- 연결: `WishDetailView`, `EventDetailView`에 패널을 붙이고 각 상세 page에서 데이터를 전달한다
  (승인 범위의 최소 변경).
- 삭제 거부 문구: `CONFLICT:wishId:has_memories`, `CONFLICT:eventId:has_memories`를
  `src/features/wishes/errors.ts`, `src/features/calendar/errors.ts`에 추가했다. 일반 충돌 문장
  ("최신 내용을 불러온 뒤 다시 시도")을 쓰면 다시 시도해도 결과가 같아 사용자가 반복하게 된다.

### 3. 테스트

- 새 단위 `tests/unit/date-source-delete-messages.test.ts` (7개): 두 삭제 거부 문구가 일반 충돌
  문장과 다르고, 먼저 할 일을 담고, DB 힌트 원문(`has_memories`)을 노출하지 않는지 확인한다.
- 새 E2E 스위트 `tests/date/**`: 포트 3008, 합성 namespace `date-e2e`.
  - `e2e/01-create-from-source.spec.ts`: 입구 노출, URL에 enum·UUID만, 제목 미리 채우기,
    저장 후 원본에서 재발견, 미완료 원본에는 입구 없음.
  - `e2e/02-delete-contract.spec.ts`: 연결된 원본 삭제 거부(GF409 `has_memories`), 추억 삭제 시
    링크만 삭제되고 원본 유지, 연결 해제 후 삭제 가능, 다른 공간·비로그인 격리.
  - `fixtures/cli.mjs`, `global-setup.ts`, `playwright.config.ts`, `README.md`.

## 실행한 검증

검증은 **클라우드 리눅스 거울**에서 수행했다. 기준 커밋 `91dce48`에 이 작업의 변경 26개 파일을
그대로 얹어 만든 사본이며, `pnpm install --frozen-lockfile`로 같은 lockfile을 썼다.
(로컬 Worktree의 `node_modules`는 Windows 전용 링크라 리눅스 셸에서 실행할 수 없다.)

| 검증 | 결과 |
| --- | --- |
| frozen install (pnpm 11.19.0, Node 22) | 통과, package/lockfile 변경 없음 |
| `tsc --noEmit` | 통과 (새 E2E 스펙 포함 — tsconfig가 `tests/**`를 포함한다) |
| `eslint .` | 통과 |
| 전체 단위 | **809 passed / 59 files** (이전 800 passed + 1 failed → 실패 0) |
| production build | 통과. `/memories/[id]/link` 라우트 생성 확인 |
| `git diff --check` | 통과 |

## 미실행 검증 — 실행 못 한 이유와 재개 조건

이 세션은 사용자 PC의 **파일**에는 접근했지만, Windows에서 loopback에 묶여 실행 중인
**Supabase 컨테이너에는 접근할 수 없다**(원격 셸은 별도 리눅스 VM이라 Windows의 localhost에
닿지 않는다). 따라서 DB가 필요한 검증은 모두 미실행이다.

1. **DATE migration 실제 적용 미실행.** `supabase/migrations/20260925120100_memory_links_date001.sql`은
   아직 어떤 DB에도 적용하지 않았다. DB·Storage 데이터 변경 없음.
2. **SQL 테스트 미실행.** `supabase/tests/92_memory_links_date001.sql` (670줄) 미검증.
3. **E2E 전부 미실행.** `tests/date/**`는 타입 검사·lint만 통과했고 실제 브라우저·DB에서 한 번도
   돌리지 않았다. 픽스처 CLI는 CAL 스위트에서 옮겨 온 것이라 `setup`의 실제 동작 확인이 필요하다.
4. **회귀 E2E 미실행.** 기존 추억·위시·캘린더·사진 업로드·외부 접근 차단·재로그인·모바일·사진 OFF.
5. 비밀 값·브라우저 번들 검사는 정적 확인만 했다(서비스 키 import 경로 없음).

재개 조건: Windows에서 `node tests/date/fixtures/cli.mjs setup` → migration 적용 →
`supabase/tests/92_*.sql` → `tests/date/playwright.config.ts` 순으로 실행한다.

## 남은 위험

- E2E 스펙의 선택자(`getByLabel('제목')`, `기록 남기기` 링크 이름 등)는 실제 실행으로 확인하지
  않았다. 첫 실행에서 선택자 조정이 필요할 수 있다.
- `listSourceMemories`의 중첩 select(`memories!inner(...)`)는 타입 검사만 통과했고 실제 PostgREST
  응답으로 확인하지 않았다.
- 원본 상세의 데이트 기록 칸은 상세 조회와 별개 쿼리라 화면당 조회가 1회 늘어난다.

## 다음 단계

1. 로컬에서 위 미실행 검증 수행, 실패 시 같은 브랜치에서 수정.
2. **별도 새 Claude 읽기 전용 독립 검토**(고정 base/head). 이 문서의 자기 보고는 독립 검토가 아니다.
3. 지적 반영 후 재검토 → 총괄 dev 통합.
