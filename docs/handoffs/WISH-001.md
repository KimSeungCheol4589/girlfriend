# WISH-001 인수인계

갱신: 2026-09-23. 담당 브랜치 `codex/wishes`, 통합 대상 `dev`.

- 기준 SHA: `184a8ba9e6e993f351f3f95515f3719b6b3037a1` (dev, "docs: design shared wishes calendar and date records").
- 1차 제품 SHA(독립 검토 대상): `3f7660db4059d33ec432a5f6146c7b4c23735ee6` ("feat: add shared wish list").
- 독립 검토 세션: `d395713e-8638-467a-a3db-2d464d443cc1`. P2 1건 수정 필수, P3 다수는 기록 대상.
- 수정 제품 SHA: `461c3ef31377369a0f2da51dd70f8a5f6dfa2553` ("`fix: keep wish status version current`").
- 독립 재검토 세션: `6e6b2dc2-5f34-4f36-b945-0781ea5080d8`. 고정 SHA `461c3ef` 승인, P0/P1/P2 없음.
- 상태: 독립 재검토 승인과 전체 검증 완료. dev 통합 준비.
- 제품 구현과 검증은 로컬 Claude 구현 세션에서 수행했다. 구현 세션의 자기 평가는 독립 검토가 아니다.

## 구현 범위

맛집과 분리된 공유 위시 저장소를 실제 인증 공간에 연결했다. 두 구성원이 같은 위시를 조회·생성·수정·상태 전환·삭제한다. 조회는 사용자 세션 + RLS로 하고, 변경은 전용 RPC로만 한다. 다른 공간·비로그인은 존재 여부도 알 수 없다.

- 분류 `place | activity | trip | shopping | other`, 상태 `wish | planned | done`.
- 제목 1~100자, 메모 2,000자 이하, 선택적 HTTPS 링크, 선택적 계획일.
- 목록: 상태·분류 필터와 제목 검색, `created_at DESC, id DESC` 커서로 20개씩. 필터는 URL에 남아 뒤로 가기에도 유지된다.
- 변경은 `expectedVersion`(충돌)과 `requestId`(중복 요청)를 함께 쓴다.

### 검토 후 변경 파일 (`3f7660d` → 현재)

| 파일 | 변경 |
| --- | --- |
| `src/features/wishes/components/WishStatusPanel.tsx` | P2 수정: `serverVersion` 상태 도입 |
| `tests/wishes/e2e/04-conflict-retry.spec.ts` | P2 회귀 테스트 1개 추가 |
| `docs/handoffs/WISH-001.md` | 이 보고서(검토 반영·P3 기록) |

### 전체 변경 파일 (기준 SHA 대비, 신규 45개)

| 범위 | 파일 |
| --- | --- |
| 화면 | `src/app/wishes/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `[id]/edit/page.tsx`, `[id]/not-found.tsx`, `loading.tsx` 2개 |
| 기능 | `src/features/wishes/` 18개 (constants, schema, filters, mappers, types, errors, queries, actions, request-key, components 9개) |
| DB | `supabase/migrations/20260923120100_wish_items_wish001.sql` |
| SQL 테스트 | `supabase/tests/90_wishes_wish001.sql` |
| 단위 테스트 | `tests/unit/wish-{schema,filters,mappers,errors,request-key,actions}.test.ts` |
| E2E | `tests/wishes/` 7개 (playwright.config.ts, global-setup.ts, fixtures/cli.mjs, e2e/helpers.ts, 스펙 4개) |
| 문서 | 이 보고서 |

**기존 파일은 하나도 수정하지 않았다.** CAL-001·공통 내비게이션·홈·theme/customize·restaurants·memories·auth·`package.json`·`pnpm-lock.yaml`·루트 설정·`TASKS.md`·공통 설계 문서·`src/lib/**`는 그대로다. 기존 auth helper(`request-id`, `schemas`, `errors`, `queries`, `LivePageFrame`), 공통 UI(`ErrorNotice`, `EmptyState`, `ConfirmDialog`, `Skeletons`, `UpcomingNotice`), 인증 테스트 fixture·리포터는 읽기 전용으로 재사용했다.

## DB 계약 추가 (CONTRACTS.md 미반영)

새 테이블 `public.wish_items`와 RPC 3개를 추가했다. `docs/database/CONTRACTS.md`는 총괄 소유 공유 문서라 수정하지 않았다. **통합 시 아래 내용을 CONTRACTS.md에 반영해야 한다.**

### `save_wish(p_wish_id uuid, p_title text, p_category text, p_memo text, p_link_url text, p_expected_version integer, p_request_id uuid) → jsonb`

상태·계획일은 다루지 않는다. 새로 만들면 항상 `wish`다(`save_restaurant`와 같은 분리).

- 생성: `p_wish_id = null`, `p_expected_version = 0`. 수정: 행을 잠그고 버전 확인 후 `version + 1`.
- 작성자·공간은 세션에서 정한다. 생성 후 바꿀 수 없다. 공유 기록이므로 두 구성원 모두 수정한다.
- 반환: `{"wishId", "version", "status", "category"}`
- 오류: `GF401`, `GF404`(없음/타 공간), `GF422`(제목 1~100자, 분류 허용값, 메모 ≤2000자, 링크, 생성 시 expectedVersion≠0), `GF409`(버전 불일치, requestId 입력 불일치)

### `set_wish_status(p_wish_id uuid, p_status text, p_planned_date date, p_expected_version integer, p_request_id uuid) → jsonb`

- `p_status`: `wish | planned | done`.
- `wish`면 `p_planned_date`는 반드시 `null`이다(아니면 `GF422 {"plannedDate":"must_be_null"}`). DB도 되돌릴 때 계획일을 비운다.
- `planned`/`done`은 계획일이 **선택**이며 **보낸 값이 그대로 저장된다**(coalesce로 이전 값을 되살리지 않는다). 비우려면 `null`을 보낸다.
- **미래 계획일은 정상이다.** 맛집 방문일과 달리 `tg_no_future_date`를 달지 않았다.
- 반환: `{"wishId", "version", "status", "plannedDate"}`
- 오류: `GF401`, `GF404`, `GF422`, `GF409`

### `delete_wish(p_wish_id uuid, p_expected_version integer, p_request_id uuid) → jsonb`

- 행을 잠그고 버전을 확인한다. 확인 창을 연 뒤 상대가 무엇이든 바꿨으면 아무것도 지우지 않고 `GF409`.
- 반환: `{"wishId"}` · 오류: `GF401`, `GF404`, `GF409`

### 조회 계약 (RPC 아님)

| 대상 | 조회 규칙 | 정렬·인덱스 |
| --- | --- | --- |
| `wish_items` | 본인 공간만 | `(space_id, status, created_at desc, id desc)` |

### 권한

`wish_items`는 `authenticated`·`service_role`에 **SELECT만** 부여했다. 쓰기 정책은 만들지 않아 직접 INSERT/UPDATE/DELETE는 권한과 정책 양쪽에서 막힌다. `app_private.wish_link_problem(text)`은 어떤 클라이언트 역할에도 노출하지 않는다. 마이그레이션 끝에 자체 점검(실행 권한, anon 차단, 내부 헬퍼 비노출, 직접 쓰기 없음, RLS on, search_path 고정)을 넣어 위반 시 적용이 실패한다.

## 설계 결정 (DESIGN.md에 명시가 없어 이 작업에서 정한 것)

1. **`status = 'wish'`면 `planned_date`는 항상 NULL이다.** CHECK 제약(`wish_items_plan_consistent`)과 RPC 양쪽에서 강제한다. 아직 계획하지 않은 위시에 날짜가 남아 있으면 화면과 이후 캘린더 연결(CAL-001)에서 의미가 어긋난다. 되돌리면 DB가 함께 비우고, 화면도 그 사실을 안내한다.
2. **계획일은 `planned`/`done`에서도 선택이다.** 날짜 없이 "계획했어요"로 둘 수 있고, 완료 후에도 날짜가 기록으로 남는다.
3. **링크에 호스트 허용 목록을 두지 않는다.** 맛집 지도 링크(`allowed_map_hosts`)와 다르게 일반 링크는 어떤 사이트든 붙여 넣을 수 있어야 한다. 대신 HTTPS·길이(11~500)·**사용자 정보가 붙은 주소 거부**(`https://믿을만한곳@악성사이트/`)를 DB와 앱 양쪽에서 검사한다. 서버는 링크 내용을 가져오지 않는다.
4. **`save_wish`는 상태·계획일을 다루지 않는다.** DESIGN 7절의 `saveWish`/`setWishStatus` 분리를 그대로 따랐다.
5. **`wish_items_id_space_key unique (id, space_id)`를 미리 두었다.** CAL-001의 `calendar_events(wish_item_id, space_id)` 복합 FK가 바로 쓸 수 있다.

## CAL-001 경계

일정 만들기는 구현하지 않았다. `calendar` 테이블·페이지·링크를 만들지 않았고, 저장 동작처럼 보이는 버튼도 두지 않았다. 상세 화면의 계획 패널 아래에 안내 문장만 있다.

> 캘린더 일정 만들기는 아직 없어요. 지금은 이 위시에 계획한 날짜만 저장돼요. 두 사람의 캘린더 연결은 다음 작업(CAL-001)에서 만들어요.

E2E가 이를 직접 확인한다(안내 문구 존재, `일정 만들기`·`캘린더` 이름의 버튼·링크가 0개).

## 검증 결과

P2 수정 뒤 **전부 다시 실행**했다. 모두 이 Worktree에서 실행했고, 기존 Supabase 컨테이너는 reset/recreate/stop하지 않았으며 새 migration만 적용했다.

| 항목 | 결과 |
| --- | --- |
| 타입 검사 | `tsc --noEmit` 통과(exit 0) |
| lint | `eslint .` 통과(오류 0) — 아래 환경 주의 참고 |
| 단위 테스트 | 37파일 **465개 통과**(WISH 신규 6파일 포함) |
| production build | 통과. `/wishes`, `/wishes/new`, `/wishes/[id]`, `/wishes/[id]/edit` 4개 경로 생성 확인 |
| migration 적용 | 로컬 테스트 DB에 `20260923120100_wish_items_wish001.sql`만 적용(exit 0). 자체 권한·RLS 점검 통과 |
| SQL 스위트 | 9개 파일 전부 exit 0, **단언 408개**(신규 90번 60개, 기존 8개 파일 348개 회귀 없음) |
| 실제 인증 E2E | **25개 전부 통과**(exit 0), 포트 127.0.0.1:3006, `wish-e2e` 전용 합성 계정. P2 회귀 테스트 1개 포함 |
| fixture 정리 | teardown exit 0. wish-e2e 계정·공간·요청 기록·허용 목록·로컬 비밀번호 파일 제거 확인. 다른 픽스처 데이터(memories 75건) 보존 확인 |

### E2E가 확인한 것 (25개)

- **공유 CRUD**: A가 만든 위시를 B가 수정(작성자 불변), 상태 전환, 삭제. 두 사람 목록에서 함께 사라짐.
- **상태·계획일**: `wish → planned → done → wish` 전이, 미래 계획일 저장, 날짜만 저장, 되돌릴 때 계획일 삭제, `wish`에서 입력칸 비움.
- **권한**: 비로그인 화면 차단과 직접 API(조회·생성·전환·삭제) 차단, 외부 공간 계정(C)의 화면·직접 API 모두 `NOT_FOUND`이며 아무것도 바뀌지 않음, 로그인 사용자의 테이블 직접 INSERT/UPDATE/DELETE 차단.
- **DB 재검증**: 화면 검증을 우회한 `http://`·`javascript:`·사용자 정보 링크·11자 미만 링크·허용 밖 분류·허용 밖 상태·`wish`+계획일 조합 모두 `GF422`.
- **필터/검색/커서**: 상태 탭·분류·제목 검색이 URL에 남음, 조건 없음 안내, 뒤로 가기에서 목록과 입력칸이 함께 복원, 필터 지우기, 23건에서 "더 보기"가 중복 없이 20+3을 이음, 필터 변경 시 목록 재시작.
- **충돌·멱등·중복**: 같은 requestId 순차·동시 재전송이 한 건만 생성하고 같은 ID 반환, 같은 키 다른 입력은 `GF409`, 상태 전환 재전송이 버전을 두 번 올리지 않음, 낡은 버전의 저장·전환·삭제가 아무것도 바꾸지 않음, 화면 충돌 시 입력 보존 + "최신 내용 불러오기", 삭제 확인 뒤 상대 변경 시 미삭제, 처리 중 두 번 누르기가 두 번째 위시를 만들지 않음, **저장 직후 곧바로 다시 상태를 바꿔도 자기 변경을 충돌로 오인하지 않음(P2 회귀)**.
- **지속성**: 로그아웃 후 재로그인해도 제목·메모·링크·계획일이 그대로이고, 상대 계정으로 로그인해도 같은 위시가 보임.
- **안전 렌더링**: `<img src=x onerror=alert(1)>`·`<script>` 문자열이 텍스트로만 그려지고 대화상자가 뜨지 않음.

### 재현 명령

```sh
# 1) 환경 (로컬 Supabase 전용, 값은 .agent-runtime/wish-e2e/env.sh에만 둔다)
#    AUTH_TEST_SUPABASE_URL / AUTH_TEST_ANON_KEY / AUTH_TEST_SERVICE_ROLE_KEY / AUTH_TEST_DB_CONTAINER

# 2) migration (새 파일만)
docker exec -i supabase_db_girlfriend-db-env-d82f psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  < supabase/migrations/20260923120100_wish_items_wish001.sql

# 3) SQL 스위트 (Git Bash에서는 MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' 필요)
docker cp supabase/tests supabase_db_girlfriend-db-env-d82f:/tmp/wish-001-tests
docker exec -i supabase_db_girlfriend-db-env-d82f psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -f /tmp/wish-001-tests/90_wishes_wish001.sql

# 4) E2E
node tests/wishes/fixtures/cli.mjs setup
node node_modules/@playwright/test/cli.js test --config tests/wishes/playwright.config.ts
node tests/wishes/fixtures/cli.mjs teardown
```

## 독립 검토 반영 (검토 대상 `3f7660d` 이후)

### P2 수정: 자기 변경을 상대방 충돌로 오인하던 문제

**증상.** `WishStatusPanel`에서 상태를 바꾼 직후, 서버가 다시 그린 결과(`version` prop)가 도착하기 전에 다시 상태를 바꾸면 낡은 `version`을 `expectedVersion`으로 보냈다. DB는 이미 다음 버전이므로 `GF409`가 나고, 화면은 "상대방이 먼저 바꾼 내용이 있어 저장하지 않았어요"라고 알렸다. 상대방은 아무것도 하지 않았고, 두 번째 전환은 조용히 반영되지 않았다.

수정 전 실제 동작을 계측해 확인했다: 서버 로그 `wishes.setWishStatus code=CONFLICT`, DB는 `status=planned, version=2`에 머물렀다(두 번째 전환 유실).

**수정.** 계획일에 이미 쓰던 "서버 상태 따라가기" 패턴을 버전에도 그대로 적용했다(`src/features/wishes/components/WishStatusPanel.tsx`).

- `serverVersion` 상태를 두고 **저장 성공 응답의 `version`을 즉시 반영**한다.
- `versionSnapshot`으로 실제 `version` prop 변화도 감지해 동기화한다(사용자가 새로 고쳤거나 우리 저장이 반영된 경우). 계획일과 **따로** 본다 — 날짜가 그대로여도 상태만 바뀌면 버전은 오르기 때문이다.
- 다음 `submit`은 prop이 아니라 `serverVersion`을 `expectedVersion`으로 보낸다.

**상대방 변경을 모르고 덮어쓰지 않는가.** 이 화면의 prop은 서버가 미는 경로가 없어, **이 클라이언트의 저장이 만든 재검증**이나 **사용자가 부른 새로 고침**으로만 바뀐다. 두 경우 모두 사용자가 화면에서 최신 상태를 보고 있으므로 그 버전을 채택하는 것이 맞다. 상대방이 다른 브라우저에서 바꾼 변경은 prop으로 들어오지 않으므로 여전히 `GF409`로 걸린다(E2E 21·23번이 확인).

**회귀 테스트.** `tests/wishes/e2e/04-conflict-retry.spec.ts`의 "화면: 저장 직후 곧바로 다시 상태를 바꿔도 자기 변경을 충돌로 오인하지 않는다". 성공 안내(서버 응답 직후)만 기다리고 서버 상세 재렌더는 기다리지 않아 문제의 타이밍을 그대로 재현한다. **수정 전 실패 / 수정 후 통과**를 모두 확인했다. 단언은 두 번째 전환의 성공 안내 → 충돌 안내 부재 → DB `status=done, version=3` 순이다(클릭 직후 부재만 보면 요청이 끝나기 전이라 항상 통과하므로 순서를 이렇게 두었다).

`DeleteWishButton`은 성공하면 즉시 잠기고 목록으로 이동하므로 같은 타이밍이 생기지 않는다. `WishForm`은 성공 후 상세로 이동하고 충돌 시 사용자가 명시적으로 "최신 내용 불러오기"를 눌러야 버전을 바꾼다. 두 곳 모두 이번 수정 범위에 넣지 않았다.

## 구현 중 고친 결함

E2E에서 드러나 제품 코드를 고친 것이다.

1. **저장 직후 계획일 입력이 되돌아가는 문제.** 저장에 성공하면 서버가 다시 그린 결과가 조금 뒤에 도착하는데, 그 사이 사용자가 새 날짜를 입력하면 늦게 도착한 값이 입력을 덮어썼다(저장 뒤 날짜를 바로 다시 고칠 때 실제로 겪는다). `WishStatusPanel`이 "prop이 실제로 바뀌었을 때만" 맞추고, 마지막 저장 뒤 사용자가 손댔으면(`dirtyRef`) 덮어쓰지 않도록 고쳤다. "날짜만 저장" 버튼의 활성 판단도 늦게 오는 prop이 아니라 확정된 서버 값을 기준으로 한다.

## 미실행·환경 제약

- **독립 코드 검토 미실행.** 총괄이 커밋한 SHA로 새 읽기 전용 Claude 세션이 수행해야 한다.
- **운영 DB·배포·실기기 검증 미실행.** 로컬 테스트 DB와 데스크톱 Chromium만 사용했다. 모바일 뷰포트·실기기는 QA-001 범위다.
- **데모 모드 E2E 미실행.** `/wishes`의 데모 분기는 `UpcomingNotice` 안내만 두어 저장처럼 보이지 않게 했고, 수동·자동 검증은 하지 않았다.
- **lint 실행 환경 주의.** 이 Worktree의 `node_modules`에서 `eslint-plugin-react-hooks`가 최상위로 hoist되지 않아 `eslint`가 플러그인을 찾지 못한다. **이 문제는 WISH-001 변경과 무관하며 손대지 않은 파일에서도 같게 재현된다**(`node_modules` 설치 배치 문제). 저장소 설정을 바꾸지 않기 위해 호출할 때만 `NODE_PATH="$PWD/node_modules/.pnpm/node_modules"`를 붙여 실행했고, 그 상태에서 오류 0으로 통과했다. 총괄 환경에서 `pnpm lint`가 그대로 되는지 확인이 필요하다.
- **E2E 안정화 장치.** `next dev`는 경로마다 첫 요청에서 번들을 컴파일하고(`/login` 첫 요청 약 8초), 저장소 안에 파일을 쓰면 파일 감시가 Fast Refresh를 일으켜 테스트 도중 화면 상태가 초기화된다. 그래서 (a) `global-setup.ts`가 경로를 미리 열고, (b) 단언 대기 시간을 30초로, (c) Playwright 산출물을 `.agent-runtime/wish-e2e/test-results`(Git 제외)에 둔다. 이 세 가지는 이 스위트 설정 파일 안에만 있고 루트 공통 설정은 건드리지 않았다.

## 잔여 위험과 후속 제안

아래 1·2·8은 독립 검토의 P3 지적과 같은 항목이다. 모두 이번 작업의 파일 소유 범위 밖이라 **기록만** 하고 코드를 바꾸지 않았다(범위를 넓히지 않는다).

1. **[P3, 통합 후 필수] `/wishes`로 가는 내비게이션이 없다.** 공통 내비게이션(`src/components/AppShell.tsx`의 `NAV_ITEMS`)과 홈 요약은 동시 수정 금지 범위라 손대지 않았다. **지금은 주소를 직접 입력해야만 들어갈 수 있어, 통합만 하고 이 연결을 빠뜨리면 사용자에게 기능이 없는 것과 같다.** 통합 단계에서 `NAV_ITEMS`에 `/wishes` 항목(라벨 예: "하고 싶은 일")을 추가해야 한다. 추가 시 `AppShell`의 `isActive`가 `/wishes/[id]` 하위 경로까지 활성으로 처리하는지 함께 확인한다.
2. **[P3, 통합 후 필수] 로그인 복귀 경로에 `/wishes`가 없다.** `src/features/auth/redirects.ts`의 `ALLOWED_REDIRECT_ROOTS`에 `/wishes`가 없어, 비로그인 상태로 `/wishes`(또는 `/wishes/{id}`)에 들어가면 로그인 후 원래 화면이 아니라 홈(`/`)으로 간다. 열린 리다이렉트 방지 장치가 허용 목록 밖 경로를 기본값으로 떨어뜨리는 정상 동작이며 보안 문제는 아니지만, 링크를 받아 들어온 사용자가 위시로 돌아가지 못한다. auth 소유 파일이라 수정하지 않았다. **제안: `ALLOWED_REDIRECT_ROOTS`에 `'/wishes'` 추가.** 1번과 함께 처리하면 `QueryErrorNotice`의 `loginNext="/wishes"`도 그때부터 실제로 동작한다(지금은 홈으로 떨어진다).
3. **`WISH_LIMITS`가 `src/lib/contracts.ts`가 아니라 기능 폴더에 있다.** 공용 파일 동시 수정을 피하려고 `src/features/wishes/constants.ts`에 두었다. 통합 후 총괄이 옮길 수 있다.
4. **DB 제약과 앱 상수가 두 곳에 있다.** 제목·메모·링크 길이와 분류·상태 목록을 바꾸려면 마이그레이션과 `constants.ts`를 함께 고쳐야 한다(맛집의 지도 호스트 목록과 같은 종류의 부담).
5. **국제화 도메인(IDN) 링크는 저장되지 않는다.** 앱이 브라우저 해석 결과(punycode)와 원문 호스트를 대조하므로 `https://예시.invalid/`류는 거부된다. 맛집 지도 링크 검사와 같은 방식이며, 필요해지면 별도 결정이 필요하다.
6. **제목 검색의 `*`는 한 글자 와일드카드로 처리된다.** PostgREST가 패턴의 `*`를 `%`로 바꾸기 때문이며, 결과가 조금 넓어질 수는 있어도 빠지지는 않는다(맛집 이름 검색과 동일).
7. **검색 폼은 하이드레이션 전 입력이 URL 값으로 되돌아갈 수 있다.** 자바스크립트 없이도 동작해야 하는 GET 폼이라 입력칸을 막지 않았다. 화면이 준비되기 전 몇백 ms 사이의 입력에만 해당한다. 상태를 알 수 있도록 `data-hydrated` 속성을 두었고 E2E가 이를 기다린다(맛집 검색 폼과 같은 성격의 제약).
8. **[P3] 삭제 계약과 CAL-001, 그리고 `23503` 매핑.** 지금은 위시에 자식 행이 없어 확인 창만 거쳐 삭제한다. CAL-001이 `calendar_events.wish_item_id`(복합 FK `(wish_item_id, space_id)` → `wish_items_id_space_key`)를 추가하면 두 가지를 **CAL-001에서 함께** 정해야 한다.
   - **삭제 의미.** 연결된 일정이 있는 위시를 지울 때 ① 함께 지울지 ② 일정의 연결만 끊을지 ③ 맛집의 `delete_restaurant_confirmed`처럼 **명시적 확인 인자**를 받을지. 맛집 선례를 따른다면 `delete_wish`에 확인 인자를 받는 새 함수를 추가하고 기존 함수의 실행 권한을 회수하는 전진 마이그레이션이 된다. 지금의 `delete_wish(uuid,integer,uuid)` 계약은 자식 행이 없다는 전제 위에 있다.
   - **`23503`(foreign_key_violation) 매핑이 없다.** FK가 `ON DELETE RESTRICT`나 `NO ACTION`이면 연결된 일정이 있는 위시의 삭제는 `23503`으로 올라온다. 공통 매핑(`src/features/auth/errors.ts`의 `SQLSTATE_TO_CODE`)에는 `23503` 항목이 없어 지금은 `UNKNOWN`으로 떨어지고, 화면은 "저장됐는지 확인하지 못했어요 … 같은 내용으로 다시 시도"라는 **틀린 안내**를 하게 된다(사실은 확정적으로 거부된 것이라 재시도해도 같은 결과다). CAL-001에서 FK를 추가하기 전에 `23503`을 `CONFLICT`로 매핑하고 "연결된 일정이 있어 지울 수 없어요" 같은 문장을 붙여야 한다. 공통 auth 파일이라 이번 범위에서 손대지 않았다.
9. **[P3] 직접 쓰기 차단 E2E 단언의 한계.** `tests/wishes/e2e/02-access.spec.ts`의 "로그인 사용자도 테이블에 직접 쓸 수 없다"는 PostgREST 응답에 `error`가 있는지만 본다(`expect(inserted.error).not.toBeNull()`). 즉 **거부됐다는 것만 확인하고 거부 사유는 확인하지 않는다.** 권한(`42501`)으로 막힌 것과 스키마 불일치·제약 위반 같은 다른 이유로 실패한 것을 구분하지 못하므로, 나중에 권한이 잘못 열려도 다른 오류가 나는 한 이 테스트는 계속 통과할 수 있다. 실제 권한 경계는 `supabase/tests/90_wishes_wish001.sql`이 `42501`을 정확히 요구하며 검증하고 있어 지금 구멍은 없지만, E2E 쪽 단언만 보고 "앱 경로에서도 코드까지 확인했다"고 읽으면 안 된다. 후속으로 E2E에서도 `error.code`를 `42501`로 단언하도록 좁히는 것을 제안한다(이번에는 검토 지적대로 범위를 넓히지 않고 기록만 한다).

## 통합 준비 여부

**독립 검토 P2 수정 완료, 총괄 확인 대기.** 검토가 지적한 유일한 필수 수정(P2)을 고쳤고, 그 타이밍을 재현하는 회귀 테스트가 수정 전 실패·수정 후 통과함을 확인했다. 전체 검증(타입·lint·단위 465·build·SQL 408·E2E 25)을 다시 실행해 모두 통과했다. 남은 P3는 모두 이 작업의 파일 소유 범위 밖이라 코드 변경 없이 "잔여 위험과 후속 제안"에 기록했다.

통합 전에 필요한 것:

1. 총괄이 diff를 확인하고 기능 브랜치에 커밋(담당은 커밋하지 않았다). 이번 수정 범위는 제품 1파일·테스트 1파일·이 보고서다.
2. 수정 SHA에 대한 재검토 필요 여부 판단(변경이 좁고 회귀 테스트가 붙어 있으므로 총괄 판단에 맡긴다).
3. 통합 시 `docs/database/CONTRACTS.md`에 위 "DB 계약 추가" 절 반영(총괄 소유 문서).
4. **통합 후 반드시** 공통 내비게이션(`NAV_ITEMS`)과 `ALLOWED_REDIRECT_ROOTS`에 `/wishes` 연결(잔여 위험 1·2). 이 둘이 빠지면 사용자는 화면에 도달할 수 없다.
5. CAL-001 착수 시 삭제 계약과 `23503` 매핑을 함께 정한다(잔여 위험 8).

dev·main·다른 Worktree는 변경하지 않았다. 커밋·push·force push·권한 우회·사용자 전역 설정 변경은 없다.


