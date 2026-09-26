# DATE-001 인계 — 독립 검토 지적 반영, 재검토 대기

갱신: 2026-09-26. 브랜치 `codex/date-records`. **재검토 전 / dev 통합 불가**.

## 기준과 검토 이력

- 기준 dev: `91dce48d2f0a1134ebf4d684838bde8d34f27c75` (CAL-001 통합). dev/main 변경 없음.
- 1차 구현 커밋: `b55691c` (42개 파일).
- 1차 자체 수정: `6ff1b8c` — PostgREST 중첩 select 제거.
- **독립 검토**: 세션 `c5c45569-1a6e-4ed1-98f4-666dbd18a667`, 대상 base `91dce48` → head `6ff1b8c`.
- 이 문서가 기록하는 수정은 그 검토의 통합 차단(P1)과 P2 전부, 그리고 가능한 P3다.
- 이전 구현 세션: `ad028528-963c-4339-84ab-73773c708778`. 재개·수정 세션: `session_015jpN88JrPrHTJLvCa8iUdq`.
- 기존 Supabase 컨테이너·합성 계정은 reset/recreate하지 않았다.

## 이번 수정 (독립 검토 반영)

### P1 — 연결과 무관한 저장에서 부분 성공 상태로 들어가던 문제

`LiveMemoryForm`이 저장 성공 직후 `savedMemory`를 **무조건** 설정했다. 이 값이 있으면 화면이
부분 성공(저장됨 + 연결 남음) 상태가 되고, 다시 제출하면 저장 대신 연결을 시도한다. 그래서

- 연결할 계획이 없는 저장에도 "연결만 다시 시도" 안내가 떴고,
- 사용자가 "연결 없이 기록하기"를 고른 뒤에도 재시도 버튼으로 연결이 생길 수 있었다.

수정: 판단 규칙을 순수 함수 `shouldAttemptLink()`(`links/link-attempt.ts`)로 분리하고,
`savedMemory` 설정과 `runLink` 진입 모두 이 규칙을 통과할 때만 하도록 했다. `runLink`의 방어
분기는 `setSubmitting(false)`로 버튼 잠금을 되돌린다(이전에는 켜진 채 남았다).

회귀 테스트: `tests/unit/date-link-attempt.test.ts`. 화면 단위 테스트 도구(jsdom/testing-library)가
이 저장소에 없고 추가하면 lockfile을 건드려야 해서, 규칙을 단위 테스트로 고정하고 **호출부 연결
여부까지 소스로 확인**한다.

### P2 — 부분 성공 상태에서 편집 입력이 조용히 버려지던 문제

제목·날짜·장소·태그·이야기 입력에 `disabled`가 없어 저장 뒤에도 타이핑이 가능했고 그 내용은
버려졌다. 다섯 입력 모두 `disabled={disabled}`를 붙이고, 부분 성공 안내에 **저장한 기록의 수정
화면으로 가라는 문장과 링크**를 추가했다.

### P2 — 커서 검증·따옴표

`links/cursor.ts`를 wishes/restaurants/memories와 같은 방식으로 바꿨다.

- 정렬 기준 값은 timestamptz 형식만 허용(`TIMESTAMP_PATTERN`), id는 UUID만.
- 길이 상한을 먼저 검사한 뒤 정규식을 적용한다.
- PostgREST `or` 필터의 타임스탬프를 따옴표로 감싼다(`+`·`:` 포함).
- 검증을 통과하지 못한 값으로는 필터 문자열을 만들지 않고 `RangeError`를 던진다.

테스트: `tests/unit/date-cursor.test.ts` — 정상 왕복, 여러 timestamptz 표기, 필터 따옴표,
형식 위반, 주입 시도, 빈 값, 길이 초과.

### P2 — E2E 스펙 두 건

- `01-create-from-source.spec.ts`: 저장 후 `?notice=saved-linked` 같은 쿼리가 붙으므로
  `waitForURL`이 이를 허용한다.
- `02-delete-contract.spec.ts`: 위시·일정의 **실제 version을 읽어** 삭제를 시도한다(`currentVersion`).
  상수 1을 보내면 `has_memories`가 아니라 `expectedVersion` 충돌로 거부돼 계약을 확인하지 못한다.
  완료 전환으로 version이 올라갔다는 사실도 함께 단언한다.

### P2 — 문서

`docs/database/CONTRACTS.md`에 4.3절(데이트 기록 연결)을 추가하고, `delete_wish`·
`delete_calendar_event`의 `has_memories` 거부, `memory_links` 조회 계약, 커서 형식·상한을 반영했다.
`### 4.2`의 제목 단계도 형제 절과 맞췄다.

### P3

- 쓰이지 않던 `SOURCE_DELETE_BLOCKED_MESSAGES`를 제거했다. 실제 문구는 각 기능의 매퍼
  (`wishes/errors.ts`, `calendar/errors.ts`)에 있고 `tests/unit/date-source-delete-messages.test.ts`가
  그 매퍼를 기준으로 확인한다. 관련 빈 테스트 블록도 정리했다.
- DATE fixture CLI의 calendar 잔여 문구를 date-e2e 기준으로 고쳤다(SQL 식별자는 그대로).
- "이 위시로 기록 남기기" 조사를 `SOURCE_ENTRY_LABELS` 상수로 분리해 바로잡았다.
- 연결 조회 실패와 "연결 없음"을 구분하는 문장을 넣었다(실패를 없음으로 읽지 않게).
- 완료 상태 검사가 **연결 시점**의 규칙임을 CONTRACTS 4.3에 명시했다.
- **P3-4 상한**: 원본 상세의 기록 목록에 상한 20건을 두고, 넘치면 화면에서 일부 결과임을 알린다
  (`SOURCE_MEMORIES_LIMIT`, `truncated`). 커서까지 만들지 않고 범위를 좁게 유지했다.

## 설계 결정과 이유 (검토 요청 항목)

| 결정 | 이유 | 영향 |
| --- | --- | --- |
| 추억당 링크 1행, 원본은 **정확히 하나** | 한 기록이 여러 계획을 가리키면 "이 데이트가 무엇이었나"가 흐려지고 원본 삭제 판정이 복잡해진다 | `memory_id` PK + CHECK로 DB가 강제. DESIGN 5.2의 "둘 중 하나 이상"보다 좁다 |
| 원본 삭제를 **거부**(연쇄 삭제 안 함) | 완료한 계획은 기록의 출처로 남아야 한다. CAL-001이 위시에 대해 고른 방향과 같다 | `GF409 has_memories`. 사용자는 기록의 연결을 먼저 해제하거나 기록을 지운다 |
| `unlink_memory_plan` 신설 | 삭제를 거부하는 이상, 연결을 푸는 수단이 없으면 사용자가 막힌다 | 추억·원본은 남고 연결만 사라진다 |
| 연결·해제가 **추억 version을 올림** | 연결 전 스냅샷으로 저장·고정·삭제하면 조용한 덮어쓰기가 된다(DESIGN 8.4) | 오래된 스냅샷의 요청은 `GF409` |
| 완료 상태 검사는 **연결 시점** 규칙 | 이미 남긴 기록은 원본이 다시 예정으로 바뀌어도 유지돼야 한다 | 연결 시 `not_done` 거부, 이후 상태 변화는 막지 않는다 |

## 실행한 검증 (최종 head 기준)

검증은 **클라우드 리눅스 거울**에서 했다. 기준 커밋 `91dce48`에 이 브랜치의 커밋 차이를 그대로
적용한 사본이며 같은 lockfile로 `pnpm install --frozen-lockfile`을 썼다.
(로컬 Worktree의 `node_modules`는 Windows 전용 링크라 리눅스 셸에서 실행할 수 없다.)

| 검증 | 결과 |
| --- | --- |
| frozen install (pnpm 11.19.0, Node 22) | 통과, package/lockfile 변경 없음 |
| `pnpm exec tsc --noEmit` | 통과 |
| `pnpm exec eslint .` | 통과 |
| `pnpm test` (vitest, 저장소 실제 스크립트) | **825 passed / 61 files** (수정 전 809 → 새 테스트 16개 추가) |
| `pnpm build` | 통과 |

`--runInBand`는 이 저장소의 스크립트가 Jest가 아니라 vitest라 해당 옵션이 없다. 기본 `pnpm test`로 실행했다.

## 미실행 검증 — 이유와 재개 조건

이 세션은 사용자 PC의 **파일**에는 접근하지만, Windows에서 loopback에 묶여 실행 중인
**Supabase 컨테이너에는 접근할 수 없다**(원격 셸이 별도 리눅스 VM이라 Windows의 localhost에 닿지
않는다). DB가 필요한 검증은 모두 미실행이다. 성공으로 표시하지 않는다.

1. **migration 미적용.** `20260925120100_memory_links_date001.sql`은 아직 어떤 DB에도 적용하지
   않았다. DB·Storage 데이터 변경 없음.
2. **SQL 테스트 미실행.** `supabase/tests/92_memory_links_date001.sql`.
3. **E2E 전부 미실행.** `tests/date/**`는 타입 검사·lint만 통과했다. 이번에 고친 두 스펙도 실제로
   돌리지 않았다.
4. **회귀 E2E 미실행.** 기존 추억·위시·캘린더·사진 업로드·외부 접근 차단·재로그인·모바일.
5. 비밀 값·브라우저 번들은 정적 확인만 했다(서비스 키 import 경로 없음).

재개: Windows에서 `node tests/date/fixtures/cli.mjs setup` → migration 적용 →
`supabase/tests/92_*.sql` → `tests/date/playwright.config.ts`(포트 3008) 순으로 실행한다.

## 남은 위험

- **3회 분할 조회의 실환경 미검증.** `6ff1b8c`에서 PostgREST 중첩 select를 제거하고
  `memory_links` → `memories` → `memory_photos`를 따로 읽어 JS에서 합치도록 바꿨다.
  MEM-001의 검증된 조회와 같은 방식이지만, 이 함수 자체는 아직 실제 DB로 돌려 보지 않았다.
  첫 실행에서 확인해야 할 1순위다.
- E2E 선택자(`getByLabel('제목')`, `기록 남기기` 링크 이름 등)는 실행으로 확인하지 않았다.
- 원본 상세는 상세 조회와 별개 쿼리라 화면당 조회가 늘어난다(상한 20건).

## 다음 단계

1. 로컬에서 위 미실행 검증 수행, 실패 시 같은 브랜치에서 수정.
2. **새 Claude 세션의 읽기 전용 재검토**(고정 base/head). 이 문서의 자기 보고는 독립 검토가 아니다.
3. 지적 반영 후 총괄 dev 통합.
