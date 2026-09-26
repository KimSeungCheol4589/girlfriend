# DB-001 변경 계약 — RPC 시그니처·반환·오류

작성일: 2026-09-19 · 대상: Server Action 구현(AUTH-001, MEM-001, FOOD-001, THEME-001)

DESIGN 7절의 서버 작업 이름을 DB 함수로 구현한 것이다.
**로컬 migration 16개 적용, SQL 스위트 7개·294개 단언과 동시성 시나리오 5개가 통과했다.**
앱·실제 Storage HTTP 연결은 별도 미검증이며, 최종 검증 범위는
[인수인계 보고서](../handoffs/DB-001.md)를 따른다.

## 0. 공통 규칙

- 호출 방법: Supabase 클라이언트의 `rpc('함수명', { ... })`. 제품 RPC는 `public` 스키마에 있다. 사용자 RPC는 `authenticated`, `finalize_upload`는 신뢰된 서버 역할만 실행한다.
- 사용자와 공간 소속은 **서버가 세션에서 확인**한다. 사용자 RPC는 `userId`/`spaceId`를 입력으로 받지 않는다. 서버 전용 `finalize_upload`의 `p_uploader_id`는 아래 별도 계약을 따른다.
- 이메일은 `auth.users.email` + `email_confirmed_at`에서 읽는다. JWT의 `email` 클레임과 클라이언트 입력은 신뢰하지 않는다.
- 성공 시 `jsonb` 객체를 반환한다. 실패는 **예외**로 던지고 트랜잭션을 되돌린다.
- `p_request_id`(uuid)는 **모든 변경 함수에서 필수**다. 같은 사용자·같은 requestId·같은 입력은 이전 결과를 그대로 돌려주고, 같은 키에 다른 입력이면 거부한다.
- `p_expected_version`은 수정 직전에 읽은 `version`이다. 새로 만들 때는 `0`을 보낸다.
- 조회는 RPC가 아니라 일반 SELECT + RLS로 한다.

### 오류 매핑

예외의 SQLSTATE가 계약이다. `MESSAGE`에는 DESIGN 오류 코드 문자열만, `DETAIL`에는 필드 힌트 또는 오류 경로 진단 JSON이 들어간다.
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

알려진 동시 실행 경쟁(서로 다른 공간 동시 수락, 첫 프로필 동시 생성, 사진 동시 첨부)은
원시 `23505`가 아니라 `GF409`로 매핑된다. 앱에서 `23505`를 따로 처리할 필요가 없다.
`23505`가 실제로 올라오면 계약에 없는 경로이므로 보고 대상이다.
`accept_invite`/`update_profile`의 GF409에 포함될 수 있는 `path: unique_violation`은 진단용 예약 키다. 입력 필드가 아니므로 `fieldErrors`로 옮기지 않는다.

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

업로드는 **두 개의 다른 신뢰 수준**으로 나뉜다.

| 단계 | 실행 주체 | 이유 |
| --- | --- | --- |
| `prepare_upload` | 로그인 사용자 | 자기 공간에 pending 자리를 만든다 |
| Storage 업로드 | 로그인 사용자 | 발급된 정확한 경로에만 올릴 수 있다(버킷 정책) |
| `finalize_upload` | **신뢰된 서버 역할만** | ready 전환은 서버가 실제 파일을 확인한 뒤에만 가능해야 한다 |

### `prepare_upload(p_purpose text, p_mime_type text, p_bytes bigint, p_request_id uuid) → jsonb`

- `p_purpose`: `memory | cover` · `p_mime_type`: `image/jpeg | image/png | image/webp`
- 반환: `{"assetId": uuid, "bucket": "space-assets", "objectPath": text, "state": "pending", "expiresAt": timestamptz, "maxBytes": bigint}`
- `objectPath`는 `space_id/asset_id.ext` 형식의 **생성 열**이다. 클라이언트가 경로를 정하거나 바꿀 수 없다.
  Storage 정책도 이 경로와 정확히 일치하는 업로드만 허용한다.
- 오류: `GF401`, `GF404`(소속 없음), `GF422`(purpose/mime/bytes)

### `finalize_upload(p_asset_id uuid, p_uploader_id uuid, p_bytes bigint, p_width integer, p_height integer, p_verified_mime_type text, p_request_id uuid) → jsonb`

**로그인 사용자는 이 함수를 호출할 수 없다(EXECUTE 없음 → `42501`).** `service_role` 또는 DB 워커만 호출한다.

- 이전 서명 `finalize_upload(uuid, bigint, integer, integer, uuid)`는 제거됐다.
  그 서명은 authenticated가 직접 호출해 아무 파일도 올리지 않고 asset을 ready로 만들 수 있었다.
- `p_uploader_id`: 서버가 확인한 업로더. asset의 실제 업로더와 다르면 `GF404`.
- `p_verified_mime_type`: 서버가 **실제로 확인한** 유형. `prepare_upload` 때 선언한 유형과 다르면 `GF412`.
- 이중 방어: 요청에 최종 사용자 세션 컨텍스트(`auth.uid()` 또는 `service_role`이 아닌 JWT role)가
  실려 있으면 권한이 잘못 부여돼 있어도 `GF403`으로 거부한다.
- 이미 `ready`면 같은 성공 응답을 돌려준다(멱등). 멱등성 키의 주인은 `p_uploader_id`다.
- 반환: `{"assetId": uuid, "objectPath": text, "state": "ready", "expiresAt": timestamptz | null}`
- `expiresAt`은 이미 첨부된 ready 자산이면 null이다. 새 requestId로 재확정해도 저장된 만료 값을 반환하며 만료를 연장하지 않는다.
- 오류: `42501`(로그인 사용자 호출), `GF403`(최종 사용자 세션), `GF404`(업로더 불일치·없는 사용자·없는 asset),
  `GF412`(만료·삭제 예정·MIME 불일치·크기/치수 상한), `GF422`(uploaderId 누락)

> **DB는 이미지 바이너리를 디코딩하지 않는다.** 실제 디코딩·픽셀 수 확인·EXIF 제거는
> 신뢰된 서버 워커가 해야 하고 **아직 구현되지 않았다**. 이 계약이 보장하는 것은
> "검증 결과를 기록할 수 있는 주체가 신뢰된 역할로 제한된다"는 것뿐이다.
> 워커 구현 전까지는 ready 전환 자체를 하지 않는 편이 안전하다.

호출 예(서버 워커):

```sql
-- service_role 키 또는 DB 워커 연결에서
select public.finalize_upload(
  '<assetId>', '<검증한 업로더 userId>',
  <실제 바이트 수>, <디코딩한 너비>, <디코딩한 높이>,
  '<실제 확인한 MIME>', '<requestId>');
```

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
- **새로 붙는 사진은 올린 사람만 붙일 수 있다.** 상대가 올린 대기·미첨부 파일의 UUID를 넣으면
  존재 여부를 알리지 않고 `GF404`다. 호출 전에 이미 그 기록에 붙어 있던 사진은
  유지·재정렬·제거 모두 두 구성원이 할 수 있다(공유 기록이므로).
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

### `delete_restaurant_confirmed(p_restaurant_id uuid, p_confirm_delete_reviews boolean, p_expected_version integer, p_request_id uuid) → jsonb`

- 후기가 있으면 `p_confirm_delete_reviews = true`여야 한다. 확인 없이 호출하면 아무것도 바꾸지 않고 `GF409`.
- 맛집 행을 잠그고 현재 version과 후기 상태를 함께 확인하므로, 사용자가 삭제 확인 화면을 본 뒤 상대가 후기를 추가·수정·삭제하면 버전 충돌로 거부한다.
- 반환: `{"restaurantId": uuid, "deletedReviewCount": integer}`
- 기존 `delete_restaurant(uuid,integer,uuid)`는 `public`, `anon`, `authenticated`의 실행 권한을 모두 회수했다. 앱은 확인 인자를 받는 새 함수만 호출한다.
- 오류: `GF401`, `GF404`, `GF409`

### `save_review(p_restaurant_id uuid, p_rating smallint, p_comment text, p_expected_version integer, p_request_id uuid) → jsonb`

- 본인 후기만. 맛집이 `visited`일 때만 가능하다.
- 생성은 `p_expected_version = 0`, 수정은 현재 버전. 동시 생성 경쟁은 UNIQUE 제약으로 `GF409`가 된다.
- 맛집 행을 먼저, 후기 행을 다음으로 잠근다. 후기 생성·수정과 같은 트랜잭션에서 맛집 `version`도 1 증가한다.
  따라서 다른 구성원의 후기 변경 뒤 오래된 맛집 정보·상태·삭제 요청은 `GF409`로 거부된다.
- 같은 `p_request_id` 재생은 후기나 맛집 version을 다시 증가시키지 않는다.
- 반환: `{"reviewId": uuid, "restaurantId": uuid, "version": integer, "restaurantVersion": integer}`
- 오류: `GF401`, `GF404`, `GF422`(별점 1~5, 후기 ≤500자), `GF409`(방문 상태 아님, 버전)

### `delete_review(p_review_id uuid, p_expected_version integer, p_request_id uuid) → jsonb`

- 본인 후기만. 상대방 후기 ID를 보내면 존재 여부를 알리지 않고 `GF404`.
- 맛집 행을 먼저, 후기 행을 다음으로 잠그고 후기 삭제와 같은 트랜잭션에서 맛집 `version`을 1 증가시킨다. 같은 요청 재생은 version을 다시 증가시키지 않는다.
- 반환: `{"reviewId": uuid, "restaurantId": uuid, "restaurantVersion": integer}`
- 오류: `GF401`, `GF404`, `GF409`

---

## 4.1 함께 하고 싶은 일

`wish_items`는 맛집과 분리된 두 구성원의 공유 위시 목록이다. `authenticated`와 `service_role`에는 SELECT만 허용하고 직접 INSERT/UPDATE/DELETE는 허용하지 않는다. 모든 변경은 아래 RPC를 통한다.

### `save_wish(p_wish_id uuid, p_title text, p_category text, p_memo text, p_link_url text, p_expected_version integer, p_request_id uuid) → jsonb`

- 생성은 `p_wish_id = null`, `p_expected_version = 0`; 수정은 현재 version을 보낸다.
- 분류는 `place | activity | trip | shopping | other`다. 제목은 1~100자, 메모는 2,000자 이하, 링크는 선택적 HTTPS 주소다.
- 상태와 계획일은 이 함수에서 변경하지 않는다. 새 위시는 항상 `wish` 상태다.
- 반환: `{"wishId", "version", "status", "category"}`
- 오류: `GF401`, `GF404`, `GF422`, `GF409`

### `set_wish_status(p_wish_id uuid, p_status text, p_planned_date date, p_expected_version integer, p_request_id uuid) → jsonb`

- 상태는 `wish | planned | done`이다. `wish`로 되돌리면 계획일은 반드시 null이며 DB도 기존 계획일을 비운다.
- `planned`와 `done`의 계획일은 선택 사항이며 미래 날짜도 허용한다.
- 반환: `{"wishId", "version", "status", "plannedDate"}`
- 오류: `GF401`, `GF404`, `GF422`, `GF409`

### `delete_wish(p_wish_id uuid, p_expected_version integer, p_request_id uuid) → jsonb`

- 행을 잠그고 현재 version을 확인한 뒤 삭제한다. 확인 화면을 연 뒤 다른 변경이 생기면 `GF409`로 거부한다.
- 연결된 일정이 있으면 삭제하지 않고 `GF409 {"wishId":"has_calendar_events"}`를 반환한다. 위시 행 잠금과 일정의 FK 잠금으로 새 연결과 삭제를 직렬화한다.
- 연결된 데이트 기록이 있으면 삭제하지 않고 `GF409 {"wishId":"has_memories"}`를 반환한다(DATE-001). 연쇄 삭제하지 않는다. 먼저 기록의 연결을 해제하거나 기록을 지워야 한다.
- 반환: `{"wishId"}`
- 오류: `GF401`, `GF404`, `GF409`

## 4.2 커플 캘린더

`calendar_events`는 본인 공간의 개인·공동 일정을 담는다. 두 구성원 모두 모든 일정을 조회하지만, 개인 일정은 소유자만 변경하고 공동 일정은 두 구성원 모두 변경한다. `authenticated`와 `service_role`에는 SELECT만 허용하며 모든 변경은 아래 RPC를 통한다.

### `save_calendar_event(p_event_id uuid, p_kind text, p_title text, p_location text, p_note text, p_all_day boolean, p_start_date date, p_start_time time, p_end_date date, p_end_time time, p_wish_item_id uuid, p_expected_version integer, p_request_id uuid) → jsonb`

- 생성은 `p_event_id = null`, `p_expected_version = 0`; 수정은 현재 version을 보낸다. 새 일정 상태는 `scheduled`다.
- `kind`는 `personal | date`이며 생성 후 바꿀 수 없다. 개인 일정의 소유자는 만든 사람이고, 공동 일정의 소유자는 null이다.
- 제목은 1~100자, 장소는 선택·100자 이하, 메모는 2,000자 이하다.
- 날짜와 시각은 한국 시간으로 조립한다. 종일 일정은 시작·종료 시각을 받지 않고 종료일을 포함한다. 시간 일정은 시작 시각이 필수이고 종료는 시작보다 뒤여야 한다.
- 위시 연결은 선택이며 같은 공간의 위시만 허용한다. `calendar_events_wish_same_space` 제약 위반만 `GF409 {"wishItemId":"gone"}`으로 바꾸고, 다른 FK 위반은 원래 `23503`을 유지한다.
- 반환: `{"eventId","version","kind","ownerId","status","allDay","startsAt","endsAt","wishItemId"}`
- 오류: `GF401`, `GF403`, `GF404`, `GF422`, `GF409`

### `set_calendar_event_status(p_event_id uuid, p_status text, p_expected_version integer, p_request_id uuid) → jsonb`

- 상태는 `scheduled | done | cancelled`다. 개인 일정은 소유자만, 공동 일정은 두 구성원 모두 변경한다.
- 반환: `{"eventId","version","status"}`
- 오류: `GF401`, `GF403`, `GF404`, `GF422`, `GF409`

### `delete_calendar_event(p_event_id uuid, p_expected_version integer, p_request_id uuid) → jsonb`

- 현재 version과 권한을 확인하고 일정만 삭제한다. 연결한 위시는 유지된다.
- 연결된 데이트 기록이 있으면 삭제하지 않고 `GF409 {"eventId":"has_memories"}`를 반환한다(DATE-001). 연쇄 삭제하지 않는다.
- 반환: `{"eventId"}`
- 오류: `GF401`, `GF403`, `GF404`, `GF409`

조회는 `(space_id, starts_at, id)` 인덱스를 사용한다. 월 범위는 한국 시간 기준 이번 달 0시 이상, 다음 달 0시 미만과 겹치는 일정이며 최대 500건이다. 상한을 넘으면 화면에서 일부 결과임을 알린다.

---

## 4.3 데이트 기록 연결 (DATE-001)

`memory_links`는 **완료한 계획**(해낸 위시·완료한 일정)과 사진 추억을 잇는다. `authenticated`·`service_role`에는 SELECT만 허용하고 변경은 아래 RPC로만 한다.

설계 결정과 이유:

- **추억당 최대 한 행, 원본은 정확히 하나.** `memory_id`가 PK이고 `memory_links_exactly_one_source` CHECK가 `source`에 맞는 열 하나만 채우도록 강제한다. DESIGN 5.2의 "둘 중 하나 이상"보다 좁은 규칙이다. 한 기록이 여러 계획을 가리키면 "이 데이트가 무엇이었나"가 흐려지고 원본 삭제 판정도 복잡해진다.
- **같은 공간만.** `space_id` 열과 `(id, space_id)` 복합 FK 세 개(추억·일정·위시)로 DB가 막는다. RPC 검사에만 기대지 않는다.
- **완료 상태 검사는 연결 시점의 규칙이다.** 연결하려는 원본이 `done`이 아니면 `GF409 {"eventId":"not_done"}` / `{"wishId":"not_done"}`로 거부한다. 이미 연결된 뒤 원본이 다시 `scheduled`로 돌아가는 것은 이 제약이 막지 않는다(기록 자체는 남아야 한다).
- **연결·해제는 추억의 version을 올린다.** 연결 전 스냅샷으로 저장·고정·삭제를 시도하면 `GF409`가 되어 조용한 덮어쓰기를 막는다(DESIGN 8.4).
- **원본 삭제는 거부한다.** 연쇄 삭제하지 않는다. 위 `delete_wish`·`delete_calendar_event` 참고.
- **추억 삭제는 링크만 지운다.** 추억→링크는 `on delete cascade`이고 원본은 그대로 남는다.

### `link_memory_plan(p_memory_id uuid, p_source text, p_source_id uuid, p_expected_version integer, p_request_id uuid) → jsonb`

- 추억과 원본을 모두 잠그고 같은 공간·완료 상태를 확인한 뒤 연결을 만들거나 바꾼다.
- 이미 같은 원본에 연결돼 있으면 아무것도 바꾸지 않고 그 사실을 알린다.
- 반환: `{"memoryId","version","source","sourceId","replacedPreviousLink","alreadyLinked"}`
- 오류: `GF401`, `GF404`, `GF409`(`expectedVersion:stale`, `eventId:not_done`, `wishId:not_done`, `eventId:gone`, `wishId:gone`), `GF422`

### `unlink_memory_plan(p_memory_id uuid, p_expected_version integer, p_request_id uuid) → jsonb`

- 연결만 지운다. 추억과 원본은 모두 남는다. 연결이 없으면 `GF404`.
- 반환: `{"memoryId","version","source","sourceId"}`
- 오류: `GF401`, `GF404`, `GF409`

---

## 5. 꾸미기·공간·프로필

### `save_customization(p_theme_key text, p_accent_color text, p_cover_asset_id uuid, p_home_sections jsonb, p_expected_version integer, p_request_id uuid) → jsonb`

- `p_theme_key`: `cream | rose | sage` · `p_accent_color`: `#rrggbb`(대문자 입력은 소문자로 정규화)
- `p_home_sections`: `pinned`, `recentMemories`, `wishlist` 세 키를 **정확히 한 번씩** 포함하는 배열.
  각 원소는 `{"key": ..., "visible": boolean}` 두 필드만 갖는다. 순서만 바꿀 수 있다.
- `p_cover_asset_id`: 같은 공간·`purpose='cover'`·`state='ready'`. `null`이면 커버 해제.
  교체·해제된 이전 커버는 참조를 끊은 뒤 `deleting`이 되고 응답에 실린다.
- **새로 지정하는 커버는 올린 사람만 지정할 수 있다**(상대가 올린 파일이면 `GF404`).
  기존 커버를 그대로 두는 저장은 두 구성원 모두 할 수 있다.
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
| `wish_items` | 본인 공간 | `(space_id, status, created_at desc, id desc)` |
| `calendar_events` | 본인 공간의 모든 개인·공동 일정 | `(space_id, starts_at, id)`, 연결 위시는 `(wish_item_id) where not null` |
| `memory_links` | 본인 공간 | `memory_id` PK, 원본별 조회는 `(calendar_event_id)` / `(wish_item_id)` |
| `assets` | 업로더 본인, 또는 `ready`이면서 실제로 기록·커버에 연결된 것 | `(space_id, purpose, state)` |
| `space_invites`, `mutation_requests` | **조회 불가** | — |

커서 페이지네이션은 DESIGN 3절대로 `(memory_date, id)` / `(created_at, id)` 쌍을 쓴다. 연결 후보 목록의 커서는 `<timestamptz>|<uuid>` 문자열이며, 형식 검사를 통과한 값만 PostgREST 필터에 넣고 타임스탬프는 따옴표로 감싼다.

원본 상세의 "데이트 기록" 목록은 최대 20건까지 읽고, 더 있으면 화면에서 일부 결과임을 알린다(조용히 자르지 않는다).

## 6.1 Storage 접근 (`space-assets` 비공개 버킷)

파일 본문도 `assets`와 같은 규칙으로 막힌다. 앱은 별도 검사를 하지 않아도 되지만,
버킷 이름과 경로는 반드시 `prepare_upload` 응답의 값을 그대로 쓴다.

| 동작 | 로그인 사용자 | 규칙 |
| --- | --- | --- |
| 업로드(INSERT) | 허용 | 자기 공간·자기가 만든 **pending** asset의 정확한 생성 경로에만 |
| 다운로드(SELECT) | 조건부 | 업로더 본인은 자기 pending/미첨부 파일, 상대 구성원은 `ready`이면서 실제 첨부된 파일만 |
| 업로드 방식 | 표준 업로드만 | 아래 주의 참고 |
| 덮어쓰기(UPDATE) | 불가 | 정책 없음. upsert 업로드를 쓰지 않는다 |
| 삭제(DELETE) | 불가 | 정리는 `service_role` 워커가 한다 |
| 비로그인 | 불가 | 정책 없음 |

`deleting` 상태 파일은 업로더에게도 열리지 않는다.
다른 버킷의 정책은 이 작업에서 만들거나 바꾸지 않았다.

> **업로드 방식 주의**: 정책은 **표준 업로드**(단일 요청 `storage.objects` INSERT) 기준으로 작성·검증했다.
> TUS 재개 업로드와 S3 멀티파트 업로드는 `storage.s3_multipart_uploads` 등 별도 테이블을 거치므로
> 이 정책만으로 같은 제약이 적용되는지 **확인하지 않았다.** 그 경로를 쓰려면 별도 검증과 정책이 필요하다.
> 현재 계약은 표준 업로드만 지원한다고 보아야 한다.

## 7. Server Action 구현 시 주의

1. 모든 변경 호출에 `requestId`(uuid v4)를 만들어 보내고, 사용자가 재시도하면 **같은 값을 유지**한다.
2. 예외의 `code`(SQLSTATE)로 분기한다. 메시지 문자열 파싱에 의존하지 않는다.
3. `detachedAssets`를 받은 뒤 Storage 삭제를 수행한다. 실패해도 DB는 이미 일관된 상태이므로 재시도 큐에만 남긴다.
4. 초대 토큰은 응답에서 곧바로 링크로 만들어 사용자에게 보여주고 서버 로그에 남기지 않는다.
5. 조회 권한 오류(`42501`)를 사용자에게 그대로 보여주지 않는다. `NOT_FOUND`로 통일한다.
6. `finalize_upload`는 **사용자 세션 클라이언트로 호출하면 안 된다.** 서버 전용 클라이언트(service_role)나
   별도 워커에서, 업로드된 객체를 실제로 내려받아 디코딩한 뒤 호출한다. 그 디코딩 구현이 끝나기 전에는
   사진 기능을 활성화하지 않는다.
7. Storage 업로드에 upsert 옵션을 쓰지 않는다. 덮어쓰기는 정책에서 막혀 있어 실패한다.
