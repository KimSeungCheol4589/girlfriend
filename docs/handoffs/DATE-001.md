# DATE-001 인계 — QA 보강 실행 결과 반영, 재검토 대기

갱신: 2026-09-26. 브랜치 `codex/date-records`. **재검토 전 / dev 통합 불가**.

## 기준과 검토 이력

- 기준 dev: `91dce48d2f0a1134ebf4d684838bde8d34f27c75` (CAL-001 통합). dev/main 변경 없음.
- 1차 구현 커밋: `b55691c` (42개 파일).
- 1차 자체 수정: `6ff1b8c` — PostgREST 중첩 select 제거.
- **1차 독립 검토**: 세션 `c5c45569-1a6e-4ed1-98f4-666dbd18a667`, 대상 base `91dce48` → head `6ff1b8c`.
  반영 커밋: `625dd2b`(제품 14개 파일) + `6dd80e7`(문서).
- **2차 독립 재검토**: 세션 `3b2f4051-61c0-410c-966a-259a6990dfc5`, 대상 head `6dd80e7`.
  **P0·P1 없음, P2 1건**으로 아직 통합 승인 전. 그 P2를 이 문서의 "2차 재검토 P2" 절에서 처리했다.
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

## QA 보강 실행에서 나온 두 건 (2026-09-26)

총괄이 QA 보강 스위트를 실제로 돌려 나온 실패 두 건이다. 제품 head `fc4da6f`는 그대로다.

### 1. 해결 — `memory_links` 조회가 없는 열을 읽었다 (QA 도우미 결함)

QA 보강 도우미(`.agent-runtime/qa-mvp/e2e/helpers.ts`의 `linkedSourceOf`)가 `memory_links`에서
`source, source_id`를 select해 **SQLSTATE 42703**으로 실패했다. 그 테이블에 **`source_id` 열은 없다.**
실제 계약은 `source`('event'|'wish')와 대응하는 **`calendar_event_id` / `wish_item_id`**이고,
`memory_links_exactly_one_source` CHECK가 둘 중 정확히 하나만 채워지게 한다.

- **제품 결함이 아니다.** 제품은 같은 테이블을 `links/server/queries.ts`의 `LINK_COLUMNS`로 올바르게 읽고
  `toMemoryLink()`가 `source === 'event' ? calendar_event_id : wish_item_id`로 매핑한다.
- 도우미를 **제품과 같은 매핑**으로 고쳤다. 스펙이 기대하는 `{ source, sourceId }` 모양은 그대로 두어
  단언을 약화하지 않았고, 대응 ID가 비어 있으면 조용히 `null`을 돌려주는 대신 예외를 던진다.
- 고친 파일은 `.agent-runtime/` 아래라 **커밋하지 않는다**(Git 제외 경로).

### 2. 해결 — 375px 캘린더 가로 넘침 (원인: 절대 배치 `sr-only` 배지가 자르기를 통과)

`03-mobile-375.spec.ts:82`의 `/calendar` `expectNoOverflow`가 실패했다. **원인을 찾지 못했고,
근거 없이 제품을 고치지 않았다.** 확인한 내용은 아래와 같다.

먼저 캘린더 스위트에는 **모바일 뷰포트 검증이 없었다**(`tests/calendar/playwright.config.ts`는
1280×900 하나뿐). 그래서 이 화면이 375px에서 측정된 것은 이번이 처음이고, 실제 결함일 가능성이 있었다.

`MonthGrid.tsx`·`CalendarView.tsx`의 **클래스 문자열을 그대로 옮긴 복제 DOM**을 제품 CSS(프로젝트
Tailwind 설정으로 빌드)와 함께 Chromium 375×812에서 실측했다. 공백 없는 40자 제목을 오늘 칸에 넣었다.

| 변형 | `documentElement.scrollWidth` | 표 너비 | 판정 |
| --- | --- | --- | --- |
| 제품 클래스 그대로 | 375 | 341 | **PASS** |
| 래퍼 `overflow-hidden` 제거 | 375 | 341 | PASS |
| 칩 `truncate` 제거 | 375 | 341 | PASS |
| `table-fixed` 제거 | 375 | **603** | PASS(래퍼가 자른다) |

- 긴 제목 칩은 칸 밖으로 **약 267px** 삐져나가지만, `table-fixed`가 표를 컨테이너에 묶고 래퍼의
  `overflow-hidden`이 남은 삐져나감을 자르므로 **문서 가로 스크롤은 생기지 않는다.**
- `isMobile` 유무(overlay/classic 스크롤바) 양쪽에서 같은 결과였다.
- 필터·달 이동·보기 전환 줄도 `flex-wrap`이라 375px에서 줄바꿈으로 들어간다(픽셀 계산 확인).
- 공통 셸(`AppShell`)의 하단 메뉴는 6항목 `flex-1`이고 `position: fixed`라 문서 스크롤에 기여하지 않는다.

**따라서 복제로 재현되는 범위에서는 캘린더 마크업이 원인이 아니다.** 같은 실행에서 `/wishes`와
위시 상세는 같은 긴 제목으로 통과했으므로 공통 셸 단독 원인도 아니다. 남은 후보는 이 세션에서 복제할 수
없는 부분(실제 서버 렌더 상태, Windows Chromium의 실제 스크롤바 동작, 또는 내가 재현하지 못한 화면 상태)이다.

**한 가지만 바꿨다 — 진단을 실패 메시지에 담았다.** `expectNoOverflow`가 실패할 때
`innerWidth / clientWidth / scrollWidth`와 **넘친 요소 목록**(태그·너비·오른쪽 끝·클래스, 조상이 자르는
요소와 `fixed` 요소는 제외)을 함께 알린다. 판정 기준은 그대로다(약화하지 않았다).
다음 실행 한 번으로 원인 요소가 이름으로 나온다.

**제품에 추가한 회귀 테스트**: `tests/unit/calendar-month-grid-mobile.test.ts` (4건).
위 실측으로 드러난 사실 — `table-fixed`와 래퍼 `overflow-hidden`이 **함께** 모바일 배치를 지탱한다 —
를 소스로 고정한다. 칩은 `truncate`로 줄이되 `title` 속성에 전체 제목을 남기므로 **내용을 숨겨서
통과시키는 것이 아니다**(상세 화면은 `break-words`로 전체 제목을 보여 준다).
이 테스트는 보고된 실패를 **고치는 것이 아니다.** 같은 화면에서 확인된 사실을 지키는 것이다.

## 375px 캘린더 넘침 — 2차 실행 결과와 진단 보강 (head `4b053b7`)

총괄이 head `4b053b7`에서 실제 Windows 인증 QA 4개를 재실행했다. **연결·취소·부분실패 재시도 3개는
통과**했고(1번 `linkedSourceOf` 수정이 통했다는 뜻이다), `03-mobile-375.spec.ts`의 `/calendar`만 실패했다.

### 받은 수치

```
innerWidth=375  clientWidth=375  scrollWidth=660  (+285px)
진단: "넘친 요소를 특정하지 못했다(조상이 자르는 요소뿐이거나 fixed 요소다)"
```

`clientWidth === innerWidth`이므로 **고전 스크롤바 때문이 아니다.** 실제로 내용이 285px 넘친다.
1차 진단이 빈손으로 돌아온 것은 **진단의 결함**이다.

### 1차 진단의 결함 — 무엇을 놓쳤나

먼저 의심했던 "`html`/`body`의 계산된 `overflow-x`가 모든 후보를 지운다"는 **사실이 아니다.**
Chromium에서 직접 확인했다: 둘 다 `visible`이고, 조상 규칙은 단순한 페이지에서 올바르게 동작한다.

진짜 구멍은 **박스 사각형만 본다는 점**이다. 다음 세 경우는 `getBoundingClientRect()` 스캔으로 잡히지 않는다.

1. 자기 박스는 화면 안인데 **스크롤 내용만** 넓은 요소(표·스크롤 컨테이너).
2. `querySelectorAll('*')`로 **열거되지 않는 shadow DOM** 안의 내용.
3. 가상 요소(`::before`/`::after`)나 마진으로 넓어진 경우.

### 보강한 진단 (`.agent-runtime/qa-mvp/e2e/helpers.ts`, 판정은 그대로)

실패했을 때만 돌고, 네 갈래로 보고한다.

1. 문서·루트 수치 + `html`/`body`의 계산된 `overflow-x`.
2. **1순위 후보** — 조상이 자르지 않는 넘친 요소.
3. **참고** — 조상이 자르는 넘친 요소와 **자르는 조상의 이름**, `fixed` 요소(조용히 버리지 않는다).
4. **이등분** — `body` 직계 자식을 하나씩 잠깐 감춰 `scrollWidth`가 화면 폭으로 돌아오는지 본다.
   돌아오면 그 subtree가 원인이다. **shadow DOM·가상 요소라도 잡힌다.** 측정 뒤 원래 `display`를 되돌린다.

`html`·`body`는 자르는 조상에서 제외했다(루트의 넘침은 "잘린 것"이 아니라 우리가 재는 그 값이다).

### 보강 진단을 실제로 시험했다 (Chromium 375×812, 사례 3종)

| 사례 | 1차 진단 | 보강 진단 |
| --- | --- | --- |
| 조상이 자르지 않는 660px 요소 | 잡음 | 1순위 후보로 이름·너비 보고 + 이등분도 지목 |
| 자르는 조상 안의 900px + 별도 660px | 660px만 잡음 | 둘 다 보고(자르는 조상 이름 포함), 이등분이 원인 지목 |
| **shadow DOM 안의 660px** | **"특정하지 못했다"** | **이등분이 `<qa-overlay>`를 원인으로 지목** |

세 사례 모두 `scrollWidth=660 (+285px)`로, 받은 수치와 같은 모양이다. 특히 세 번째가 이번 실패와
**같은 증상**(박스 스캔은 빈손, 문서는 285px 넘침)이다.

### 남은 원인 후보 — 아직 확정하지 않았다

- 복제 DOM 측정(1차 보고)으로 캘린더 마크업을 **배제하지 않는다.** 복제는 shadow DOM·개발 서버 주입
  요소를 포함하지 않았으므로 실제 페이지를 대표하지 못한다.
- 이 스위트는 `next dev`로 앱을 띄운다. 개발 서버가 넣는 오버레이 계열 요소(shadow DOM)는 위 세 번째
  사례와 정확히 같은 모양의 증상을 만든다. **가설이고, 다음 실행의 이등분 결과로 확인해야 한다.**
- 이등분이 지목한 `body` 자식이 **앱 마크업인지 개발 서버 요소인지**를 먼저 가려야 한다.
  앱 마크업이면 그 subtree를 좁혀 들어간다. 개발 서버 요소라면 제품 결함이 아니다.
- 원인이 **허용 범위 밖 공통 컴포넌트**(예: `src/components/AppShell.tsx`, `src/app/layout.tsx`)로
  드러나면 고치지 않고 파일·근거만 보고한다.

**이번에도 제품 코드는 고치지 않았다.** 판정을 완화하거나 `overflow`를 전역으로 숨기지 않았다.

## 375px 캘린더 넘침 — 원인 확정과 수정 (3차 실행 근거)

총괄의 3차 실행이 원인을 좁혀 줬다. `body` 직계 자식 이등분에서 **`app-shell-root`를 감추면 375로
돌아왔다** → 개발 서버 오버레이가 아니라 **앱 subtree**다. 그리고 후보로
`[data-testid=calendar-day-event] a`(truncate, clientWidth 36, scrollWidth 351) 안의
제목 `span`(폭 298, right 661)과 그 뒤 `sr-only` `span`(폭 1, right 661)이 지목됐다.

### 원인

Tailwind `sr-only`는 **`position: absolute`**다(빌드된 CSS에서 확인). CSS에서 `overflow: hidden`은
**자기가 컨테이닝 블록이 아닌** 조상일 때 절대 배치 자손을 자르지 않는다. 칩(`<Link>`)은
`block truncate …`로 **정적 배치**였으므로, 칩 안의 완료·취소 배지의 컨테이닝 블록은 칩이 아니었다.
긴 제목(`white-space: nowrap`) 뒤로 밀려난 배지가 **칩의 자르기를 그대로 통과해** 문서 스크롤 폭을 늘렸다.

제목 `span`과 배지의 `right`가 **둘 다 661**인 것이 이 설명과 맞는다. 제목은 인라인이라 칩이 자르지만,
배지는 절대 배치라 자르지 못한다. 그래서 문서가 661이 된다.

### 재현 (Chromium 375×812, MonthGrid의 실제 클래스 구조)

공백 없는 40자 제목 + 완료 배지로 재현했다.

| 상태 | `scrollWidth` | `clientWidth` | `innerWidth` | clientWidth 기준 | innerWidth 기준 |
| --- | --- | --- | --- | --- | --- |
| 수정 전 (`isMobile` 없음) | **577** | 375 | 375 | FAIL | FAIL |
| 수정 전 (`isMobile: true`) | **577** | 375 | **577** | FAIL | **PASS(가려진다)** |
| 수정 후 (`isMobile` 없음) | 375 | 375 | 375 | PASS | PASS |
| 수정 후 (`isMobile: true`) | 375 | 375 | 375 | PASS | PASS |

첫 줄이 받은 수치와 같은 모양이다(실제 Windows는 글꼴 폭 차이로 661). 배지의
`getBoundingClientRect().right`는 두 경우 모두 577이다 — 달라지는 것은 **누가 자르는가**뿐이다.

### 제품 수정 (한 곳, 클래스 하나)

`src/features/calendar/components/MonthGrid.tsx` — 일정 칩에 **`relative`**를 추가했다.
칩이 컨테이닝 블록이 되어 `truncate`의 자르기가 절대 배치 배지에도 적용된다. 왜 필요한지 주석으로 남겼다.

**내용을 숨겨 통과시킨 것이 아니다.** 배지는 접근성 트리에 그대로 있고(시각적으로만 잘린다. `sr-only`는
애초에 눈에 보이지 않는다), 제목 전체는 `title` 속성과 일정 상세 화면(`break-words`)에서 볼 수 있다.
전역 `overflow` 숨김이나 판정 완화는 하지 않았다.

같은 패턴(`truncate` 요소 안의 `sr-only`)을 `src/` 전체에서 찾아봤다. **`MonthGrid.tsx` 한 곳뿐이다.**
`MonthGrid`의 `<caption className="sr-only">`도 절대 배치지만 정적 위치가 표 왼쪽 위(right≈17)라
넘침에 기여하지 않는다 — 확인만 하고 건드리지 않았다. 허용 범위 밖 공통 컴포넌트는 손대지 않았고,
손댈 필요도 없었다.

### 독립 검토 지적 반영 — 회귀 테스트를 좁혔다

`tests/unit/calendar-month-grid-mobile.test.ts`를 다시 썼다.

- **뺀 것**: `table-fixed`·`overflow-hidden`·`min-w-0` 고정. 인과가 확인되지 않았다(특히 `min-w-0`
  주장은 근거가 없었다. 지적이 맞다).
- **남긴 것**: 칩이 **`truncate`와 `relative`를 함께** 갖는지. 이번 재현으로 인과가 확인된 유일한 조건이다.
- 마크업 전체 문자열이 아니라 **`className` 템플릿의 고정 클래스 토큰**만 검사한다
  (처음엔 마크업 전체를 봐서 *주석에 적힌 "relative"*까지 통과했다. 그 누수를 확인하고 좁혔다).
- **두 방향으로 확인했다**: `relative`를 빼면 실패, `truncate`를 빼면 실패, 원래대로면 통과.
- 실제 렌더 회귀는 QA 보강 스위트의 375px 검사가 담당한다(실제 DB 필요, 총괄 실행).

### QA 판정 기준도 한 군데 고쳤다 (`.agent-runtime/`, 커밋 안 함)

`hasHorizontalOverflow`의 기준을 `window.innerWidth` → **`documentElement.clientWidth`**로 바꿨다.
위 표 두 번째 줄이 이유다: `isMobile: true`에서는 Chromium이 `innerWidth`를 **내용 폭까지 늘려** 보고해
실제 넘침이 통과해 버린다. `clientWidth`는 늘어나지 않는다. **더 엄격해진 것이고 완화가 아니다.**

## 실행한 검증 (2차 재검토 반영 후 최종 head 기준)

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

## 미실행 검증 — 이유와 재개 조건

**QA 보강 재실행이 필요한 항목**(총괄 담당): `03-mobile-375.spec.ts`의 `/calendar` 검사를 다시 돌려
`relative` 수정이 실제 화면에서 통하는지 확인해야 한다(복제 재현에서는 577 → 375). 연결·취소·부분실패
3개는 head `4b053b7`에서 이미 통과했다. 이 세션은 로컬 Supabase에 닿을 수 없어 직접 실행하지 못했다.
판정 기준을 `clientWidth`로 바꿨으므로, 통과하더라도 수치(`scrollWidth`/`clientWidth`)를 함께 봐 주면 좋다.


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
2. **새 Claude 세션의 읽기 전용 3차 재검토**(고정 base `91dce48` → 이번 head). 이 문서의 자기 보고는
   독립 검토가 아니다. 2차 재검토 세션 `3b2f4051-61c0-410c-966a-259a6990dfc5`는 `6dd80e7`까지만 봤고,
   이번 P2 수정은 아직 어떤 독립 검토도 거치지 않았다.
3. 지적 반영 후 총괄 dev 통합.
