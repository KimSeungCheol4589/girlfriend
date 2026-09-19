# DB-001 변경 계약 — RPC 시그니처·반환·오류

작성일: 2026-09-19 · 대상: Server Action 구현(AUTH-001, MEM-001, FOOD-001, THEME-001)

DESIGN 7절의 서버 작업 이름을 DB 함수로 구현한 것이다.
**아래 함수는 이 문서를 쓴 시점에 SQL로 작성만 했고 실행 검증은 하지 않았다.**
총괄이 마이그레이션을 적용하고 `supabase/tests`를 실행한 결과가 나오기 전에는
"동작 확인됨"으로 인용하지 않는다.

## 0. 공통 규칙

- 호출 방법: Supabase 클라이언트의 `rpc('함수명', { ... })`. 모든 함수는 `public` 스키마에 있고 `authenticated`만 실행할 수 있다.
- 사용자와 공간 소속은 **서버가 세션에서 확인**한다. 어떤 함수도 `userId`/`spaceId`를 입력으로 받지 않는다.
- 이메일은 `auth.users.email` + `email_confirmed_at`에서 읽는다. JWT의 `email` 클레임과 클라이언트 입력은 신뢰하지 않는다.
- 성공 시 `jsonb` 객체를 반환한다. 실패는 **예외**로 던지고 트랜잭션을 되돌린다.
- `p_request_id`(uuid)는 **모든 변경 함수에서 필수**다. 같은 사용자·같은 requestId·같은 입력은 이전 결과를 그대로 돌려주고, 같은 키에 다른 입력이면 거부한다.
- `p_expected_version`은 수정 직전에 읽은 `version`이다. 새로 만들 때는 `0`을 보낸다.
- 조회는 RPC가 아니라 일반 SELECT + RLS로 한다.

### 오류 매핑

예외의 SQLSTATE가 계약이다. `MESSAGE`에는 DESIGN 오류 코드 문자열만, `DETAIL`에는 필드 힌트 JSON만 들어간다.
사용자 본문·이메일·토큰은 어떤 필드에도 넣지 않는다.

| SQLSTATE | MESSAGE | 앱 응답 code | 의미 |
| --- | --- | --- | --- |
| `GF401` | `UNAUTHENTICATED` | `UNAUTHENTICATED` | 세션 없음 또는 사용자 없음 |
| `GF403` | `FORBIDDEN` | `FORBIDDEN` | 공간 생성 권한 없음, 이메일 미확인 |
| `GF404` | `NOT_FOUND` | `NOT_FOUND` | 대상 없음 또는 접근 불가(존재 여부를 알리지 않음) |
| `GF409` | `CONFLICT` | `CONFLICT` | 버전 불일치, 중복 요청 입력 불일치, 상태 충돌 |
| `GF410` | `INVITE_INVALID` | `INVITE_INVALID` | 토큰 무효·만료·폐기·대상 불일치·재사용 |
| `GF411` | `SPACE_FULL` | `SPACE_FULL` | 정원 초과 |
| `GF412` | `UPLOAD_FAILED` | `UPLOAD_FAILED` | 업로드 확정 실패 |
| `GF422` | `VALIDATION_ERROR` | `VALIDATION_ERROR` | 입력 검증 실패. `DETAIL`의 필드 힌트를 `fieldErrors`로 옮긴다 |
| `GF503` | `RETRYABLE_ERROR` | `RETRYABLE_ERROR` | 일시 상태. 같은 requestId로 재시도 가능 |
| `42501` | (PostgreSQL) | `NOT_FOUND` | 권한 없는 직접 접근. 사용자에게 상세를 노출하지 않는다 |
| `23505` 등 | (PostgreSQL) | `CONFLICT` | 예상 밖 제약 위반. 로그에 오류 코드만 남긴다 |

`FORBIDDEN`은 DESIGN 7절 목록에 없던 코드다. `/onboarding`의 "생성 권한 없음" 상태를
`VALIDATION_ERROR`로 뭉개지 않기 위해 추가했다(설계 차이, [SECURITY.md](./SECURITY.md) 참고).

---

## 1. 공간과 초대

### `create_space(p_name text, p_introduction text, p_relationship_start_date date, p_request_id uuid) → jsonb`

DESIGN `createSpace`. spaces·space_members·space_settings를 한 트랜잭션으로 만든다.

- 사전 조건: 확인된 이메일이 `app_private.bootstrap_creators`에 있어야 한다. 목록이 비면 전면 거부.
- 반환: `{"spaceId": uuid, "version": 1}`
- 오류: `GF401`, `GF403`(미확인 이메일 / 허용 목록 밖), `GF422`(name 1~30자, introduction ≤200자, 미래 시작일), `GF409`(이미 어떤 공간의 구성원)

### `create_invite(p_target_email text, p_request_id uuid) → jsonb`

DESIGN `createInvite`. 이전 활성 초대를 폐기하고 새 초대를 만든다.

- 반환: `{"inviteId": uuid, "expiresAt": timestamptz, "targetEmailMasked": text, "token": text, "tokenIssued": true}`
- **`token`은 이 응답에만 들어간다.** DB에는 SHA-256 해시만 저장하고 멱등성 결과에도 남기지 않는다.
  같은 requestId로 재호출하면 `{"token": null, "tokenIssued": false}`가 돌아온다. 링크를 잃어버렸으면 새 초대를 만든다.
- 호출자 책임: 토큰을 로그·에러 리포트·URL 쿼리에 남기지 않는다. URL fragment로만 전달한다.
- 오류: `GF401`, `GF404`(공간 소속 아님), `GF422`(이메일 형식 / 자기 자신 / 이미 구성원), `GF411`(정원)

### `revoke_invite(p_invite_id uuid, p_request_id uuid) → jsonb`

- 반환: `{"inviteId": uuid, "status": "revoked"}`
- 오류: `GF401`, `GF404`, `GF409`(이미 수락됨)

### `list_space_invites() → setof (invite_id uuid, target_email_masked text, status text, expires_at timestamptz, created_at timestamptz, accepted_at timestamptz)`

`space_invites` 테이블에는 어떤 역할에도 SELECT 권한이 없다. 상태 확인은 이 함수로만 한다.
`status`는 `active | accepted | revoked | expired`. 토큰 해시·원문·전체 이메일은 반환하지 않는다.

### `accept_invite(p_token text, p_request_id uuid) → jsonb`

DESIGN `acceptInvite`, 8.1 흐름.

- 처리: 공간 행을 `FOR UPDATE`로 잠근 뒤 초대를 다시 읽고 대상 이메일·폐기·만료·기존 소속·정원을 검사한다.
  구성원 추가와 초대 사용 처리를 같은 트랜잭션에서 끝낸다. 정원이 차면 남은 활성 초대를 폐기한다.
- 반환: `{"spaceId": uuid, "alreadyAccepted": boolean}`
- 같은 사용자의 재시도: `alreadyAccepted: true`로 성공 반환. 다른 사용자의 재사용: `GF410`.
- 오류: `GF401`, `GF410`(무효·만료·폐기·대상 불일치·재사용·이메일 미확인), `GF409`(이미 다른 공간 소속), `GF411`(정원)

---

## 2. 업로드

### `prepare_upload(p_purpose text, p_mime_type text, p_bytes bigint, p_request_id uuid) → jsonb`

- `p_purpose`: `memory | cover` · `p_mime_type`: `image/jpeg | image/png | image/webp`
- 반환: `{"assetId": uuid, "objectPath": text, "state": "pending", "expiresAt": timestamptz, "maxBytes": bigint}`
- `objectPath`는 `space_id/asset_id.ext` 형식의 **생성 열**이다. 클라이언트가 경로를 정하거나 바꿀 수 없다.
- 오류: `GF401`, `GF404`(소속 없음), `GF422`(purpose/mime/bytes)

### `finalize_upload(p_asset_id uuid, p_bytes bigint, p_width integer, p_height integer, p_request_id uuid) → jsonb`

- 업로더 본인만 호출할 수 있다. 다른 구성원이 호출하면 `GF404`.
- 이미 `ready`면 같은 성공 응답을 돌려준다(멱등).
- 반환: `{"assetId": uuid, "objectPath": text, "state": "ready", "expiresAt": timestamptz}`
- 오류: `GF401`, `GF404`, `GF412`(만료·삭제 예정·크기/치수 위반)
- **한계**: bytes·width·height는 호출자가 전달한 값이다. 실제 파일 디코딩 검증은 Server Action이
  Storage에서 먼저 수행해야 한다. DB는 소유자·공간·상태 전이·상한값만 강제한다.

### `discard_upload(p_asset_id uuid, p_request_id uuid) → jsonb`

사용자가 취소한 미첨부 파일을 정리 대상으로 돌린다.

- 반환: `{"assetId": uuid, "state": "deleting", "objectPath": text}`
- 오류: `GF401`, `GF404`, `GF409`(이미 첨부됨)

---

## 3. 추억

### `save_memory(p_memory_id uuid, p_title text, p_body text, p_memory_date date, p_location text, p_tags text[], p_photo_asset_ids uuid[], p_is_pinned boolean, p_expected_version integer, p_request_id uuid) → jsonb`

DESIGN `saveMemory`. 본문과 사진 연결을 한 트랜잭션으로 저장한다.

- 생성: `p_memory_id = null`, `p_expected_version = 0`
- 수정: 기록 행을 잠그고 버전을 확인한 뒤 `version + 1`
- 사진: `p_photo_asset_ids`의 **배열 순서가 곧 표시 순서**다(0부터). 최대 10장, 중복 불가.
  각 파일은 같은 공간·`purpose='memory'`·`state='ready'`·미연결이어야 한다.
  집합에서 빠진 파일은 `deleting`으로 바뀌고 응답에 실린다.
- 작성자·공간은 변경할 수 없다. 공유 기록이므로 두 구성원 모두 수정할 수 있다.
- 반환: `{"memoryId": uuid, "version": integer, "photoCount": integer, "detachedAssets": [{"assetId","objectPath"}]}`
- 오류: `GF401`, `GF404`(기록 없음/타 공간, 사진 없음), `GF422`(제목 1~80자, 본문 ≤10000자, 장소 ≤100자, 태그 5개·각 20자·중복 불가, 미래 날짜, 사진 10장 초과/중복/미준비/목적 불일치), `GF409`(버전 불일치, 이미 다른 기록에 연결된 사진, requestId 입력 불일치)

### `delete_memory(p_memory_id uuid, p_expected_version integer, p_request_id uuid) → jsonb`

- 반환: `{"memoryId": uuid, "detachedAssets": [{"assetId","objectPath"}]}`
- 오류: `GF401`, `GF404`, `GF409`

---

## 4. 맛집과 개인 후기

### `save_restaurant(p_restaurant_id uuid, p_name text, p_area text, p_category text, p_map_url text, p_memo text, p_expected_version integer, p_request_id uuid) → jsonb`

상태·방문일은 다루지 않는다. 새로 만들면 항상 `wishlist`다.

- `p_map_url`: HTTPS이며 `app_private.app_config.allowed_map_hosts`의 호스트여야 한다. 서버가 링크를 가져오지 않는다.
- 반환: `{"restaurantId": uuid, "version": integer, "status": text}`
- 오류: `GF401`, `GF404`, `GF422`(이름 1~100자, 지역·종류 ≤50자, 메모 ≤2000자, 지도 링크), `GF409`(버전)

### `set_restaurant_status(p_restaurant_id uuid, p_status text, p_visited_date date, p_confirm_delete_reviews boolean, p_expected_version integer, p_request_id uuid) → jsonb`

- `visited`: `p_visited_date`가 없으면 한국 기준 오늘. 미래 날짜는 거부.
- `wishlist`: `p_visited_date`는 반드시 `null`. 남은 후기가 있으면 `p_confirm_delete_reviews = true`여야 하고,
  확인된 요청만 후기 삭제와 상태 변경을 한 트랜잭션으로 처리한다. 확인이 없으면 **아무것도 바꾸지 않고** `GF409`.
- 맛집 행을 잠그므로 후기 저장과 직렬화된다.
- 반환: `{"restaurantId": uuid, "version": integer, "status": text, "visitedDate": date|null, "deletedReviewCount": integer}`
- 오류: `GF401`, `GF404`, `GF422`, `GF409`

### `delete_restaurant(p_restaurant_id uuid, p_expected_version integer, p_request_id uuid) → jsonb`

- 반환: `{"restaurantId": uuid, "deletedReviewCount": integer}`

### `save_review(p_restaurant_id uuid, p_rating smallint, p_comment text, p_expected_version integer, p_request_id uuid) → jsonb`

- 본인 후기만. 맛집이 `visited`일 때만 가능하다.
- 생성은 `p_expected_version = 0`, 수정은 현재 버전. 동시 생성 경쟁은 UNIQUE 제약으로 `GF409`가 된다.
- 반환: `{"reviewId": uuid, "restaurantId": uuid, "version": integer}`
- 오류: `GF401`, `GF404`, `GF422`(별점 1~5, 후기 ≤500자), `GF409`(방문 상태 아님, 버전)

### `delete_review(p_review_id uuid, p_expected_version integer, p_request_id uuid) → jsonb`

- 본인 후기만. 상대방 후기 ID를 보내면 존재 여부를 알리지 않고 `GF404`.
- 반환: `{"reviewId": uuid, "restaurantId": uuid}`

---

## 5. 꾸미기·공간·프로필

### `save_customization(p_theme_key text, p_accent_color text, p_cover_asset_id uuid, p_home_sections jsonb, p_expected_version integer, p_request_id uuid) → jsonb`

- `p_theme_key`: `cream | rose | sage` · `p_accent_color`: `#rrggbb`(대문자 입력은 소문자로 정규화)
- `p_home_sections`: `pinned`, `recentMemories`, `wishlist` 세 키를 **정확히 한 번씩** 포함하는 배열.
  각 원소는 `{"key": ..., "visible": boolean}` 두 필드만 갖는다. 순서만 바꿀 수 있다.
- `p_cover_asset_id`: 같은 공간·`purpose='cover'`·`state='ready'`. `null`이면 커버 해제.
  교체·해제된 이전 커버는 참조를 끊은 뒤 `deleting`이 되고 응답에 실린다.
- 반환: `{"spaceId": uuid, "version": integer, "coverAssetId": uuid|null, "detachedAssets": [...]}`
- 오류: `GF401`, `GF404`, `GF422`, `GF409`

### `update_space(p_name text, p_introduction text, p_relationship_start_date date, p_expected_version integer, p_request_id uuid) → jsonb`

- 반환: `{"spaceId": uuid, "version": integer}`

### `update_profile(p_nickname text, p_expected_version integer, p_request_id uuid) → jsonb`

- 본인 프로필만. 프로필이 아직 없으면 `p_expected_version = 0`으로 생성한다.
- 반환: `{"userId": uuid, "version": integer}`
- 오류: `GF401`, `GF422`(닉네임 1~20자), `GF409`(버전)

---

## 6. 조회 계약 (RPC 아님)

일반 SELECT + RLS로 처리한다. 앱은 `space_id` 조건을 직접 쓰지 않아도 되지만 인덱스를 위해 넣는 것이 좋다.

| 대상 | 조회 규칙 | 정렬·인덱스 |
| --- | --- | --- |
| `spaces`, `space_settings`, `space_members` | 본인 공간만 | PK |
| `profiles` | 본인과 같은 공간 구성원만 | PK |
| `memories` | 본인 공간 | `(space_id, memory_date desc, id desc)`, 태그는 GIN |
| `memory_photos` | 본인 공간 | `(memory_id, sort_order)` |
| `restaurants` | 본인 공간 | `(space_id, status, created_at desc, id desc)` |
| `restaurant_reviews` | 본인 공간(두 사람 모두 조회) | `(restaurant_id)` |
| `assets` | 업로더 본인, 또는 `ready`이면서 실제로 기록·커버에 연결된 것 | `(space_id, purpose, state)` |
| `space_invites`, `mutation_requests` | **조회 불가** | — |

커서 페이지네이션은 DESIGN 3절대로 `(memory_date, id)` / `(created_at, id)` 쌍을 쓴다.

## 7. Server Action 구현 시 주의

1. 모든 변경 호출에 `requestId`(uuid v4)를 만들어 보내고, 사용자가 재시도하면 **같은 값을 유지**한다.
2. 예외의 `code`(SQLSTATE)로 분기한다. 메시지 문자열 파싱에 의존하지 않는다.
3. `detachedAssets`를 받은 뒤 Storage 삭제를 수행한다. 실패해도 DB는 이미 일관된 상태이므로 재시도 큐에만 남긴다.
4. 초대 토큰은 응답에서 곧바로 링크로 만들어 사용자에게 보여주고 서버 로그에 남기지 않는다.
5. 조회 권한 오류(`42501`)를 사용자에게 그대로 보여주지 않는다. `NOT_FOUND`로 통일한다.
