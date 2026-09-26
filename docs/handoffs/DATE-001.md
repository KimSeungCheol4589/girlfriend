# DATE-001 인계 — 독립 검토 기록 정정

갱신: 2026-09-26. 브랜치 `codex/date-records`. dev/main 변경 없음.
제품·테스트·진단에 대한 독립 검토 결과는 "기준과 검토 이력"의 고정 SHA 기록을 따른다.

## 기준과 검토 이력

- 기준 dev: `91dce48d2f0a1134ebf4d684838bde8d34f27c75` (CAL-001 통합). dev/main 변경 없음.
- 1차 구현 커밋: `b55691c` (42개 파일).
- 1차 자체 수정: `6ff1b8c` — PostgREST 중첩 select 제거.
- **1차 독립 검토**: 세션 `c5c45569-1a6e-4ed1-98f4-666dbd18a667`, 대상 base `91dce48` → head `6ff1b8c`.
  반영 커밋: `625dd2b`(제품 14개 파일) + `6dd80e7`(문서).
- **2차 독립 재검토**: 세션 `3b2f4051-61c0-410c-966a-259a6990dfc5`, 대상 head `6dd80e7`.
  **P0·P1 없음, P2 1건**. 그 P2를 이 문서의 "2차 재검토 P2" 절에서 처리했다.
- **전체 독립 검토**: 세션 `6a9e005e-400c-401e-b8d2-b6b26ba7951b`, 대상 base `91dce48` → head `fc4da6f`.
  **P0·P1·P2 없음.**
- **delta 독립 검토**: 세션 `a03f8416-9719-446f-8104-e6ddcea8af29`, 대상 `fc4da6f` → `9467970`.
  제품 `relative` 수정은 **타당**, **P2 4건**(회귀 테스트·QA 진단·문서).
- **delta 독립 재검토**: 세션 `6498301d-0deb-4deb-b312-d745804b5857`, 대상 `9467970` → `c47da60`.
  코드·테스트·진단 지적은 **해소**, 남은 것은 이 문서의 **검토 이력·다음 단계 P2 1건**이며 이번 정정이 그것이다.
- 이전 구현 세션: `ad028528-963c-4339-84ab-73773c708778`. 재개·수정 세션: `session_015jpN88JrPrHTJLvCa8iUdq`.
- 기존 Supabase 컨테이너·합성 계정은 reset/recreate하지 않았다.

## 2차 재검토 P2 — 부분 성공 상태에서 '고정' 체크박스가 열려 있던 문제

1차 반영에서 제목·날짜·장소·태그·이야기 입력과 사진 선택기는 `disabled={disabled}`로 잠갔지만
**'홈에 고정하기' 체크박스는 빠져 있었다.** 그래서 저장이 끝난 부분 성공 상태(`disabled === true`)에서도
고정을 켜거나 끌 수 있었고, 그 변경은 어디에도 저장되지 않고 조용히 사라졌다. 안내 문장도 바꿀 수 없는
항목으로 고정을 언급하지 않아, 화면이 사용자에게 잘못된 기대를 줬다.

수정 세 가지.

1. `LiveMemoryForm.tsx`의 고정 체크박스에 `disabled={disabled}`를 붙였다(`checked={form.isPinned}` 바로 뒤).
2. `PartialLinkNotice` 안내 문장의 항목 목록을 실제 잠금 범위와 맞췄다:
   `제목·날짜·장소·태그·이야기` → **`제목·날짜·장소·태그·이야기·사진·고정`**.
   사진 선택기도 이미 잠겨 있었으므로 같은 문장에서 함께 바로잡았다(문장 하나, 항목 두 개 추가).
3. 회귀 테스트를 `tests/unit/date-link-attempt.test.ts`에 추가했다(`부분 성공 상태에서 홈 고정 체크박스도
   잠근다(재검토 P2)`). 고정 체크박스는 `FIELD_IDS` 항목이 없어 `checked={form.isPinned}` 다음 줄의
   `disabled={disabled}`를 기준으로 확인하고, **파일 안의 모든 `type="checkbox"` 요소**가
   `disabled={disabled}`를 갖는지도 함께 검사해 앞으로 체크박스가 늘어나도 같은 누락이 재발하지 않게 했다.
   안내 문장의 항목 목록도 문자열로 고정했다.

이 테스트가 실제로 회귀를 잡는지 확인했다: 고정 체크박스의 `disabled={disabled}`만 지우고 돌리면
`고정 체크박스에 disabled가 필요하다`로 실패하고, 되돌리면 7건 모두 통과한다.

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
화면으로 가라는 문장과 링크**를 추가했다. (이때 고정 체크박스를 빼먹었고, 2차 재검토가 그것을
지적했다 — 위 "2차 재검토 P2" 절.)

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

## QA 보강 실행 결과 — 확정 내용 (최종)

이 절이 **현재 사실**이다. 중간 과정에서 적었던 관찰 일부는 뒤에 "폐기된 중간 관찰"로 분리해 두었다.

### 1. `memory_links` 조회가 없는 열을 읽었다 — 해결

QA 보강 도우미(`.agent-runtime/qa-mvp/e2e/helpers.ts`의 `linkedSourceOf`)가 `memory_links`에서
`source, source_id`를 select해 **SQLSTATE 42703**으로 실패했다. 그 테이블에 **`source_id` 열은 없다.**
실제 계약은 `source`('event'|'wish')와 대응하는 **`calendar_event_id` / `wish_item_id`**이고,
`memory_links_exactly_one_source` CHECK가 둘 중 정확히 하나만 채워지게 한다.

- **제품 결함이 아니다.** 제품은 `links/server/queries.ts`의 `LINK_COLUMNS`로 올바르게 읽고
  `toMemoryLink()`가 `source === 'event' ? calendar_event_id : wish_item_id`로 매핑한다.
- 도우미를 **제품과 같은 매핑**으로 고쳤다. 스펙이 기대하는 `{ source, sourceId }` 모양은 그대로 두어
  단언을 약화하지 않았고, 대응 ID가 비어 있으면 예외를 던진다.
- 고친 파일은 `.agent-runtime/` 아래라 **커밋하지 않는다**(Git 제외 경로).

### 2. 375px 캘린더 가로 넘침 — 해결 (원인: 절대 배치 `sr-only` 배지)

**원인.** Tailwind `sr-only`는 `position: absolute`다. CSS에서 `overflow: hidden`은 **자기가 컨테이닝
블록이 아닌** 조상일 때 절대 배치 자손을 자르지 않는다. 월 보기 일정 칩(`<Link>`)이 `block truncate …`로
**정적 배치**였으므로, 긴 제목(`white-space: nowrap`) 뒤로 밀려난 완료·취소 배지가 **칩의 자르기를 그대로
통과해** 문서 스크롤 폭을 늘렸다. 제목 `span`과 배지의 `right`가 둘 다 같은 값인 것이 이 설명과 맞는다
(제목은 인라인이라 잘리고, 배지는 절대 배치라 안 잘린다).

**재현** (Chromium 375×812, `MonthGrid`의 실제 클래스 구조, 공백 없는 40자 제목 + 완료 배지):

| 상태 | `scrollWidth` | `clientWidth` | `innerWidth` | clientWidth 기준 | innerWidth 기준 |
| --- | --- | --- | --- | --- | --- |
| 수정 전 (`isMobile` 없음) | **577** | 375 | 375 | FAIL | FAIL |
| 수정 전 (`isMobile: true`) | **577** | 375 | **577** | FAIL | **PASS(가려진다)** |
| 수정 후 | 375 | 375 | 375 | PASS | PASS |

배지의 `getBoundingClientRect().right`는 두 경우 모두 577이다 — 달라지는 것은 **누가 자르는가**뿐이다.
실제 Windows 실행은 글꼴 폭 차이로 661이었다.

**제품 수정** (`src/features/calendar/components/MonthGrid.tsx`, 클래스 하나): 칩에 **`relative`** 추가.
칩이 컨테이닝 블록이 되어 `truncate`의 자르기가 배지에도 적용된다. 왜 필요한지 주석으로 남겼다.

내용을 숨겨 통과시킨 것이 아니다: `sr-only`는 애초에 눈에 보이지 않고 접근성 트리에 그대로 남으며,
제목 전체는 `title` 속성과 일정 상세 화면(`break-words`)에서 볼 수 있다. 전역 `overflow` 숨김이나
판정 완화는 하지 않았다.

같은 패턴(`truncate` 요소 안의 `sr-only`)을 `src/` 전체에서 찾았고 **`MonthGrid.tsx` 한 곳뿐이다.**
`MonthGrid`의 `<caption className="sr-only">`도 절대 배치지만 정적 위치가 표 왼쪽 위(right≈17)라
넘침에 기여하지 않는다 — 확인만 하고 건드리지 않았다. 허용 범위 밖 공통 컴포넌트는 손대지 않았다.

### 회귀 테스트 (`tests/unit/calendar-month-grid-mobile.test.ts`)

독립 검토 지적을 두 차례 반영해 좁혔다.

- **고정하는 것**: 칩이 `truncate`와 `relative`를 **함께** 갖는지, 그리고 칩 안에 `sr-only` **배지 요소**가
  있는지(있어야 `relative` 고정에 의미가 있다). 이번 재현으로 인과가 확인된 조건만이다.
- **뺀 것**: `table-fixed`·`overflow-hidden`·`min-w-0` 고정. 인과가 확인되지 않았다
  (특히 `min-w-0` 주장은 근거가 없었다).
- **문자열 검사 누수를 두 번 막았다**: ① 마크업 전체를 보면 *주석의 "relative"*까지 통과해서
  `className` 템플릿의 고정 토큰만 보게 했다. ② `sr-only`도 글자 검사라 주석만으로 통과해서
  `<span className="sr-only">` **여는 태그 개수**를 세게 했다.
- **세 방향으로 확인했다**: `relative` 제거 → 실패, `truncate` 제거 → 실패, 배지 2개 제거 → 실패,
  원래대로 → 통과.
- 실제 렌더 회귀는 QA 보강 스위트의 375px 검사가 담당한다(실제 DB 필요, 총괄 실행).

### QA 진단·판정 (`.agent-runtime/`, 커밋 안 함)

- **판정 기준**을 `window.innerWidth` → **`documentElement.clientWidth`**로 바꿨다. 위 표 두 번째 줄이
  이유다: `isMobile: true`에서 Chromium이 `innerWidth`를 내용 폭까지 늘려 보고해 실제 넘침이 통과한다.
  **더 엄격해진 것이고 완화가 아니다.** 초과량 표기도 `scrollWidth − clientWidth`로 맞췄다.
- **클리핑 분류를 보수적으로** 바꿨다. `overflow: hidden`이 절대 배치 자손을 자르는지는 그 조상이
  컨테이닝 블록인지에 달렸고, 그 판정은 `transform`·`filter`·`contain` 등까지 봐야 해서 재구현하면 또
  틀린다. 그래서 "클리핑 **후보**(실제 클리핑 미확정)"까지만 말하고, **절대·스티키 배치는 1순위 후보에서
  빼지 않는다.** 이번 원인이 정확히 그 경우였고, 1차 진단은 그것을 "잘린다"고 단정해 원인을 놓쳤다.
- 실패 시 네 갈래로 보고한다: 1순위 후보 / 클리핑 후보 조상이 있는 요소 / `fixed` 요소 /
  스크롤 내용만 넓은 요소, 그리고 **`body` 직계 자식 이등분**(가장 확실한 단서. shadow DOM도 잡힌다).
- 보강 뒤 같은 구조로 다시 재현해 확인했다: 절대 배치 `sr-only` 배지가 **1순위 후보로, 이유와 함께**
  보고되고(`position=absolute … 컨테이닝 블록이 아니면 잘리지 않는다`), 수정된 구조는 통과한다.

### 총괄이 실행한 확인 (SHA별)

이 세션이 아니라 **총괄이 로컬에서** 실행한 결과다.

`9467970`

| 항목 | 결과 |
| --- | --- |
| 모바일 인증 QA 375px 검사 | **1 pass** |
| 단위 테스트 | **828 pass / 62 files** |
| lint · typecheck · build | pass |
| 기존 DB baseline | 불변 |

`c47da60`

| 항목 | 결과 |
| --- | --- |
| 바뀐 단위 테스트 2개 | 통과 |
| 배지 2개 삭제 변이(메모리상) | 단언 실패 확인 |
| 전체 스위트 재실행 | **하지 않음** — 제품 코드 변경이 없다 |

### 폐기된 중간 관찰 (기록용, 더 이상 유효하지 않다)

원인을 좁히는 과정에서 적었던 다음 서술은 **모두 폐기한다.** 최신 확정 내용은 위 2번 항목이다.

1. **"복제 DOM 측정으로 캘린더 마크업은 원인이 아니다"** — 틀렸다. 그 복제에는 `sr-only` 배지가 없었다.
   원인은 캘린더 마크업 안에 있었다.
2. **"원인을 특정하지 못했다 / 개발 서버 오버레이일 수 있다"** — 이등분이 `app-shell-root`를 지목해
   앱 subtree임이 확인됐고, 그 뒤 절대 배치 배지로 좁혀졌다.
3. **"`table-fixed`와 래퍼 `overflow-hidden`이 함께 모바일 배치를 지탱한다"는 4건 회귀 테스트** —
   과도한 클래스 고정이었고 `min-w-0` 인과 주장은 근거가 없었다. 위 회귀 테스트로 대체했다.
4. **"`html`/`body`의 계산된 `overflow-x`가 모든 후보를 지운다"** — 아니었다. 둘 다 `visible`이다.
   진짜 원인은 박스 사각형만 보는 스캔과 클리핑 단정이었다.

## 이 세션이 실행한 검증

총괄이 로컬에서 실행한 결과는 위 "총괄이 실행한 최종 확인" 절에 따로 적었다. 아래는 **이 세션**이
클라우드 리눅스 거울에서 직접 돌린 것이며, 어느 SHA가 "최종"인지 판정하지 않는다.

검증은 **클라우드 리눅스 거울**에서 했다. 기준 커밋 `91dce48`에 이 브랜치의 커밋 차이를 그대로
적용한 사본이며 같은 lockfile로 `pnpm install --frozen-lockfile`을 썼다.
(로컬 Worktree의 `node_modules`는 Windows 전용 링크라 리눅스 셸에서 실행할 수 없다.)

| 검증 | 결과 |
| --- | --- |
| frozen install (pnpm 11.19.0, Node 22) | 통과, package/lockfile 변경 없음 |
| `pnpm exec tsc --noEmit` | 통과 |
| `pnpm exec eslint .` | 통과 |
| `pnpm test` (vitest, 저장소 실제 스크립트) | **828 passed / 62 files** (기준 809 → 825 → 826 → 월 보기 회귀 2건 추가) |
| `pnpm build` | 통과 |

`--runInBand`는 이 저장소의 스크립트가 Jest가 아니라 vitest라 해당 옵션이 없다. 기본 `pnpm test`로 실행했다.

## 미실행 검증 — **당시 구현 세션의 과거 기록**

> 아래 "미실행 검증"·"남은 위험"은 **DATE-001 구현 당시** 이 세션이 남긴 기록이다. 그 뒤 총괄이
> 로컬에서 실행한 현재 결과와 충돌할 수 있다. **현재 상태는 QA-001 기록(`docs/handoffs/QA-001.md`)이
> 우선한다.** 여기 적힌 SQL·E2E 미실행은 그 시점의 사실이며, 지금도 미실행이라는 뜻이 아니다.

**QA 보강 스위트는 총괄이 head `9467970`에서 실행해 375px 검사까지 통과를 확인했다**(위 표 참조).
연결·취소·부분실패 3개는 그 이전 head `4b053b7`에서 통과했다. 이 세션은 로컬 Supabase에 닿을 수 없어
QA 스위트를 직접 실행한 적이 없다.


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

## 남은 위험 — **당시 구현 세션의 과거 기록**

> 위 상자와 같다. 현재 상태는 QA-001 기록이 우선한다.

- **3회 분할 조회의 실환경 미검증.** `6ff1b8c`에서 PostgREST 중첩 select를 제거하고
  `memory_links` → `memories` → `memory_photos`를 따로 읽어 JS에서 합치도록 바꿨다.
  MEM-001의 검증된 조회와 같은 방식이지만, 이 함수 자체는 아직 실제 DB로 돌려 보지 않았다.
  첫 실행에서 확인해야 할 1순위다.
- E2E 선택자(`getByLabel('제목')`, `기록 남기기` 링크 이름 등)는 실행으로 확인하지 않았다.
- 원본 상세는 상세 조회와 별개 쿼리라 화면당 조회가 늘어난다(상한 20건).

## 다음 단계

1. 총괄이 이 문서 정정분의 확인과 통합 기록을 마친다. 제품 검토·검증은 위 "기준과 검토 이력"의
   고정 SHA 증거를 참조한다.
2. 이 문서의 자기 보고는 독립 검토가 아니다. 제품·테스트·진단에 대한 판단은 고정 base/head를 명시한
   위 세 독립 검토 기록이 근거다.
