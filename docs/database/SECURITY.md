# DB-001 권한 모델·설계 차이·알려진 한계

작성일: 2026-09-19 · 기준 문서: DESIGN.md 6절, TECH_STACK.md 5절

## 1. 두 겹의 검사

RLS와 SQL 권한은 서로 다른 검사다. 둘 다 정의했다.

| 역할 | 테이블 권한 | 함수 실행 | RLS |
| --- | --- | --- | --- |
| `anon` | 없음 | `app.*` 읽기 헬퍼만 | 정책 평가 이전에 권한에서 막힘 |
| `authenticated` | 9개 테이블 **SELECT만** | `public.*` 변경 RPC + `app.*` 헬퍼 | SELECT 정책만 존재 |
| `service_role` | 9개 테이블 SELECT (직접 쓰기 회수) | `finalize_upload` + 지정한 운영 함수 | BYPASSRLS (모든 행 조회 가능) |
| `postgres` | 소유자 | 전체 | 소유자 우회(FORCE 미사용) |

- 어떤 클라이언트 역할에도 INSERT/UPDATE/DELETE 권한이 없다. 변경은 `SECURITY DEFINER` RPC로만 한다.
- **쓰기 정책 자체를 만들지 않았다.** 나중에 실수로 GRANT가 들어가도 RLS가 다시 막는다.
- `space_invites`, `mutation_requests`는 SELECT 권한도 정책도 없다. 초대 상태는 `public.list_space_invites()`로만 본다.
- PostgreSQL 기본값(신규 함수의 PUBLIC EXECUTE)과 Supabase 기본값(public 스키마 신규 객체의 anon/authenticated 권한)을
  `ALTER DEFAULT PRIVILEGES`로 모두 차단하고, 필요한 권한만 명시적으로 부여한다.
  **이 차단은 그 문을 실행한 역할(기본값 `postgres`)에만 적용된다**(검토 지적 D7).
  다른 역할로 마이그레이션을 적용하면 그 역할이 만든 신규 객체에는 적용되지 않는다.
  `20260919140100`부터 "기존 객체 소유자 == 현재 역할" 가드를 넣어 역할이 섞이면 멈춘다.
  범위도 좁다. `public`·`app`·`app_private` 세 스키마에 한정하며 다른 역할의 기본 권한은 바꾸지 않는다.
  다만 `public` 스키마에 대한 이 변경은 이 DB에서 `postgres`가 앞으로 만드는 **모든** 테이블·함수에
  영향을 준다. 이 DB는 이 제품 전용이라는 전제에서 의도한 것이다.
- 11번 마이그레이션 끝의 `DO` 블록이 적용 직후 (1) 직접 쓰기 권한 잔존 (2) 민감 테이블 권한 (3) `app_private` 노출
  (4) RLS 미적용 테이블 (5) search_path 미고정 SECURITY DEFINER 함수를 점검하고, 위반이 있으면 마이그레이션을 실패시킨다.

## 1.1 지연 제약 트리거의 보안 컨텍스트 (실행에서 드러난 결함)

지연(`DEFERRABLE INITIALLY DEFERRED`) 제약 트리거는 **COMMIT 시점에 호출자 역할로** 실행된다.
`SECURITY DEFINER` RPC가 이미 반환된 뒤이므로 정의자 컨텍스트가 아니다.

첫 구현에서 `app_private.tg_space_member_limit()`가 `app_private.config_int()`를 호출하다
`permission denied for schema app_private`(42501)로 실패했다.
`accept_invite`는 성공을 반환했는데 COMMIT이 실패해 두 초대 수락이 모두 롤백됐다.

수정: **모든 트리거 함수를 `SECURITY DEFINER` + 고정 `search_path`로** 만들었다
(`20260919130100_fix_regex_and_trigger_security.sql`).

- 트리거 실행 시에는 함수 EXECUTE 권한을 다시 검사하지 않는다(생성 시점에만 검사).
  따라서 `app_private` 트리거 함수는 여전히 클라이언트가 직접 호출할 수 없다.
- 부수 효과(의도한 것): 정원·사진 집합 검사가 소유자 권한으로 돌아가 RLS에 걸러지지 않은
  실제 전체 행을 센다. 호출자 역할로 돌면 RLS 때문에 개수를 잘못 셀 수 있었다.
- 마이그레이션과 `60_deferred_triggers.sql`이 "public 테이블의 모든 트리거 함수는
  SECURITY DEFINER + 고정 search_path"를 강제·검증한다.

정적 표현식(CHECK 제약, 컬럼 DEFAULT)에서 참조하는 `app_private` 함수는 같은 문제가 없다.
함수 ACL은 표현식을 **저장할 때** 검사하고 행마다 다시 검사하지 않는다.

## 2. 비재귀 RLS

`space_members`에 대한 정책이 다시 `space_members`를 읽으면 무한 재귀가 된다.
소속 확인은 `app.current_space_id()` / `app.is_space_member()` / `app.is_space_peer()`로 분리했다.
이 함수들은 `SECURITY DEFINER`(소유자 postgres)라 내부 조회에서 정책을 다시 평가하지 않는다.

이 때문에 제품 테이블에는 **`FORCE ROW LEVEL SECURITY`를 쓰지 않는다.** 강제하면 소유자도 정책을 적용받아
헬퍼가 다시 재귀한다. 대신 소유자 접근 경로(psql, 마이그레이션)를 운영 절차로 통제한다.

`app.*` 헬퍼는 호출자 자신에 관한 사실만 반환하므로 `anon`에도 EXECUTE를 주었다.
권한 오류 대신 "0행"이 나오게 하려는 의도다. `app_private.*`는 어떤 클라이언트 역할도 실행할 수 없다.

단, 이 "자신에 관한 사실만"이라는 전제는 헬퍼마다 확인해야 한다.
`app.is_asset_attached(uuid)`는 처음에 공간 조건이 없어, 외부 계정이 asset UUID를 찍어 보면
**첨부 여부라는 불리언**을 알 수 있었다(검토 지적 D6). 지금은 호출자의 현재 공간으로 한정한다.
이를 호출하는 정책·헬퍼(`assets_select_member`, `app.can_read_object`)가 이미 같은 공간 조건을
함께 요구하므로 정책 의미는 달라지지 않는다.

## 2.1 첨부 시 업로더 요구 (검토 지적 D2, 수정됨)

RLS는 상대가 올린 대기·미첨부 파일을 숨긴다. 그런데 첫 구현의 `save_memory`·`save_customization`은
파일의 공간·목적·상태만 확인하고 **업로더를 보지 않았다.** asset UUID를 알아낸 구성원이
상대의 비공개 파일을 자기 기록이나 커버에 붙이면 그 순간 첨부되어 공개된다.

규칙(`20260919140100`):

| 대상 | 업로더 일치 요구 |
| --- | --- |
| 이 호출에서 **새로 붙는** 사진 | 필요 |
| 호출 전에 이미 그 기록에 붙어 있던 사진(유지·재정렬) | 불필요 — 공유 기록이므로 두 구성원 모두 편집 |
| 바뀌지 않는 기존 커버 | 불필요 |
| 새로 지정하는 커버 | 필요 |

업로더 검사는 목적·상태 검사보다 **먼저** 하고 실패를 `NOT_FOUND`로 통일한다.
그래야 "그 파일이 존재하는가", "대기 중인가" 같은 사실이 새지 않는다.

## 3. 신뢰 경계

| 값 | 출처 | 비고 |
| --- | --- | --- |
| 사용자 ID | `auth.uid()` | 클라이언트 입력으로 받지 않는다 |
| 이메일 | `auth.users.email` + `email_confirmed_at` | JWT의 `email` 클레임을 쓰지 않는다 |
| 공간 소속 | `space_members` | 입력 `spaceId`를 받지 않는다 |
| 최초 생성 권한 | `app_private.bootstrap_creators` | 운영자만 등록. 비어 있으면 전면 거부 |
| 파일 경로 | `assets.object_path` 생성 열 | 클라이언트가 지정·변경 불가 |
| 초대 토큰 | DB가 생성, SHA-256 해시만 저장 | 응답에 한 번만 나간다 |
| 버전 | 서버가 `+1` | 트리거가 임의 값 설정을 거부 |

## 4. 민감 정보 노출 방지

- 초대: 토큰 원문은 저장하지 않는다. 멱등성 결과(`mutation_requests.result`)에도 넣지 않는다.
  같은 requestId로 재호출하면 `token: null`이 돌아온다.
- 초대 상태 조회는 마스킹된 이메일(`b*******@test.invalid` 형태)과 상태만 준다.
- 수락 실패 사유는 모두 `INVITE_INVALID`로 묶어 토큰·계정 상태를 추측할 수 없게 했다.
- 오류 `DETAIL`에는 필드 이름과 사유 코드만 담는다(`{"title":"length"}`). 사용자 본문·이메일·토큰을 넣지 않는다.
- 남의 자원 접근은 `NOT_FOUND`로 통일한다(상대 후기 삭제, 남의 파일 확정 등).
- `auth.users`는 `authenticated`에게 노출되지 않는다. 상대방 이메일을 조회할 경로가 없다.

## 5. 동시성

| 상황 | 방법 |
| --- | --- |
| 초대 동시 수락 / 정원 | `spaces` 행 `FOR UPDATE` → 초대 재확인 → 인원 확인 → 추가. `space_members.user_id` UNIQUE가 최종 방어 |
| 같은 기록 동시 수정 | 기록 행 `FOR UPDATE` + `expectedVersion` 비교 + 버전 `+1` 트리거 |
| 방문 취소와 후기 작성 | 양쪽 모두 맛집 행 `FOR UPDATE` |
| 사진 첨부와 정리 작업 | 파일 행 `FOR UPDATE`, `deleting` 상태는 첨부 불가 |
| 중복 제출 | `mutation_requests` PK 삽입 → 충돌 시 `FOR UPDATE`로 직렬화 → 결과 재생. 실패는 롤백되어 재시도 가능 |

`space_members` 정원 제약 트리거는 **보조 장치**다. 커밋되지 않은 다른 트랜잭션의 행은 보이지 않으므로
잠금 없이 동시에 삽입하는 경로까지 막지는 못한다. 실제 보장은 위의 공간 행 잠금이다.
이 구분은 `supabase/tests/concurrency`에서 두 세션으로 검증한다.

### 잠금으로 직렬화되지 않는 경우 (검토 지적 D3, 수정됨)

공간 행 잠금은 **같은 공간**에 대한 경쟁만 직렬화한다. 다음 두 경우는 잠금이 겹치지 않으므로
UNIQUE 제약이 최종 방어가 된다.

| 경우 | 최종 방어 | 반환 코드 |
| --- | --- | --- |
| 같은 사용자가 **서로 다른 공간**의 초대를 동시 수락 | `space_members.user_id` UNIQUE | `GF409` |
| 같은 사용자의 **첫 프로필**을 동시에 생성 | `profiles` PK | `GF409` |
| 사전 검사 직후 다른 세션이 같은 사진을 붙임 | `memory_photos.asset_id` UNIQUE | `GF409` |

세 경우 모두 해당 INSERT만 `unique_violation` 핸들러로 감싸 계약 코드로 바꾼다.
**새 잠금을 추가하지 않으므로 잠금 순서 문제나 교착이 생기지 않는다.**
원시 `23505`가 클라이언트까지 나가면 계약 위반이며, 동시성 테스트가 그 코드를 명시적으로 거부한다.

## 6. DESIGN과 달라진 점

1. **오류 코드 `FORBIDDEN` 추가.** DESIGN 7절 목록에는 없지만 `/onboarding`의 "생성 권한 없음"을
   `VALIDATION_ERROR`로 뭉개지 않기 위해 `GF403`을 두었다.
2. **`requestId`를 모든 변경 함수에서 필수로 했다.** DESIGN 표에서 `createInvite`·`acceptInvite`·`finalizeUpload`에는
   표기가 없었으나, 재전송 안전성을 함수마다 다르게 두면 앱 쪽 실수가 생긴다.
3. **`createInvite` 응답의 토큰은 재생되지 않는다.** 멱등성 저장소에 비밀을 남기지 않기 위한 선택이다.
4. **`revokeInvite`, `discardUpload`, `listSpaceInvites`를 추가했다.** 각각 초대 폐기(DESIGN 7절의 "이전 활성 초대 폐기"를
   사용자가 직접 하는 경로), 업로드 취소, 토큰 없는 상태 조회에 필요하다.
5. **`saveRestaurant`와 `setRestaurantStatus`를 분리했다.** DESIGN도 두 작업으로 나눠 두었고, 상태 전이에는
   후기 삭제 확인이 필요해 입력과 잠금 범위가 다르다.
6. **`space_settings.accent_color`는 소문자로 정규화**해 저장한다. 비교·중복을 단순하게 하기 위해서다.
7. **`memory_photos`, `restaurant_reviews`에 `space_id`를 비정규화**했다. 복합 FK `(id, space_id)`로 공간 간
   잘못된 연결을 DB가 직접 막고, RLS 정책을 조인 없이 단순하게 유지하기 위해서다.
8. **`restaurant_reviews`는 `space_members(user_id, space_id)`를 참조**한다. 구성원이 아닌 사용자의 후기가
   물리적으로 존재할 수 없다.
9. **`auth.users`에 트리거를 달지 않았다.** 프로필은 `create_space`·`accept_invite`·`update_profile`에서 필요할 때 만든다.
   인증 스키마를 건드리지 않아 AUTH-001과 충돌하지 않는다.
10. **`service_role`의 제품 테이블 직접 쓰기를 회수했다.** 이는 최소 권한 조치이며
    **서비스 키 유출에 대한 방어가 아니다.** 정확히 쓰면 다음과 같다.

    - 여전히 가능한 것: `service_role`은 `BYPASSRLS`이므로 **모든 행을 읽을 수 있다.**
      또 신뢰된 RPC인 `public.finalize_upload`, 운영 함수
      `app_private.add_bootstrap_creator` / `remove_bootstrap_creator` /
      `expire_stale_assets` / `purge_deleted_assets`를 실행할 수 있다.
      즉 파일을 `ready`로 만들고, 임의 이메일에 공간 생성 권한을 주고, 파일을 정리 대상으로
      바꾸고 메타데이터를 지울 수 있다. Storage 객체도 정책을 우회해 지울 수 있다.
    - 줄어든 것: 테이블에 대한 임의의 `INSERT/UPDATE/DELETE`가 막혀, 추억·맛집·후기·구성원 같은
      내용을 RPC 계약 밖에서 조작하는 경로가 없다.
    - 결론: **서비스 키 유출은 전체 데이터 유출이고 부분적인 변경도 가능하다.** 이 조치는
      사고 범위를 줄일 뿐이다. 키는 서버에만 두고 유출 시 회전한다.
      복구·백필은 `postgres` 역할로 하고 기록을 남긴다.

## 6.1 업로드 확정의 신뢰 경계 (수정됨)

첫 구현의 `finalize_upload`는 `authenticated`가 직접 호출할 수 있었고 bytes/width/height를
호출자 값 그대로 기록했다. "Server Action이 먼저 검증한다"는 관례는 방어가 아니다.
RPC를 직접 호출하면 파일을 하나도 올리지 않고 asset을 `ready`로 만들 수 있었다.

`20260919130200_upload_finalization_trust.sql`에서 다음으로 바꿨다.

1. 예전 서명을 **제거**하고, `service_role`에만 EXECUTE를 준 새 서명으로 교체했다.
2. 행위자를 세션이 아니라 명시 인자 `p_uploader_id`로 받고 asset의 실제 업로더와 대조한다.
3. 요청에 최종 사용자 세션 컨텍스트가 실려 있으면(`auth.uid()`가 있거나 JWT role이 `service_role`이 아니면)
   권한이 잘못 부여돼 있어도 거부한다.
4. 서버가 실제로 확인한 MIME을 받아 `prepare_upload` 선언값과 대조한다.

**DB는 이미지를 디코딩하지 않는다.** 실제 바이너리 검증(디코딩, 픽셀 수, EXIF 제거)은
신뢰된 서버 워커의 후속 구현이며 아직 없다. 이 변경이 보장하는 것은 검증 결과를 기록할 수 있는
주체가 신뢰된 역할로 제한된다는 것뿐이다.

## 6.2 Storage 접근 (구현됨)

`20260919130300_storage_bucket_policies.sql`이 비공개 버킷 `space-assets`와
`storage.objects` 정책 2개를 만든다. 모든 조건에 `bucket_id = 'space-assets'`를 포함해
다른 버킷의 접근 범위를 넓히지 않는다. 기존 버킷·정책은 수정하지 않는다.

| 명령 | 정책 | 규칙 |
| --- | --- | --- |
| INSERT | `space_assets_insert_own_pending` | `app.can_upload_object(name)` — 자기 공간, 자기가 만든 `pending` asset의 정확한 생성 경로 |
| SELECT | `space_assets_select_visible` | `app.can_read_object(name)` — 업로더 본인, 또는 `ready`이면서 실제 첨부. `deleting` 제외 |
| UPDATE | 없음 | 덮어쓰기 불가(upsert 업로드 금지) |
| DELETE | 없음 | 사용자 삭제 불가. 정리는 BYPASSRLS인 `service_role` |
| anon | 없음 | 전면 거부 |

경로는 `assets.object_path` 생성 열과 **정확히 일치**해야 하므로 임의 경로·상대 경로·다른 공간 경로를 만들 수 없다.
`storage.objects`의 기존 GRANT는 건드리지 않았다. 접근 제어는 정책으로만 한다.

**검증 범위**: 표준 업로드(단일 요청 `storage.objects` INSERT)만 정책으로 막고 테스트했다.
TUS 재개 업로드와 S3 멀티파트 업로드는 별도 테이블 경로를 거치므로 **확인하지 않았다.**
그 경로를 쓰려면 별도 정책과 검증이 필요하다.

## 7. 알려진 한계 (이번 범위에서 처리하지 않음)

1. **실행 검증 현황 (2026-09-19 기준).** 마이그레이션 **15개 적용 완료**, 단일 세션 테스트
   **7개 스위트 276개 단언 통과**, 동시성 **5개 경쟁 모두 통과**, 픽스처 정리도 확인됐다.
   그 이후에 추가한 **16번 마이그레이션(`20260919150100`)과 D8~D10 회귀 테스트는 아직 실행되지 않았다.**
   최신 상태는 `docs/handoffs/DB-001.md`가 기준이다.
2. **실제 이미지 바이너리 검증 없음.** 위 6.1 참고. 서버 워커 구현 전에는 사진 기능을 켜지 않는다.
3. **파일 정리 스케줄 없음.** `app_private.expire_stale_assets()`를 호출하는 주기 작업은 배포 환경에서 설정한다.
   Storage 객체 삭제도 같은 워커가 해야 한다(정책상 사용자는 지울 수 없다).
4. **공간 탈퇴·구성원 교체·공간 삭제 없음.** DESIGN 1절대로 MVP에서 제외했다. `assets` 참조가 `RESTRICT`라
   공간 삭제는 수동 절차가 필요하다.
5. **`mutation_requests` 보존 정책 없음.** 무한히 쌓인다. 운영 전에 보관 기간과 정리 작업을 정해야 한다.
6. **`down` 마이그레이션 없음.** 되돌리려면 README의 DROP 절차를 로컬에서만 쓴다.
7. **`auth.users.deleted_at`·`banned_until`을 보지 않는다.** GoTrue 스키마 버전 차이로 마이그레이션이 실패할 위험을
   피하려고 `email` + `email_confirmed_at`만 확인한다. 정지된 계정 차단은 Auth 계층에서 처리해야 한다.
8. **태그 검색·본문 전문 검색 인덱스는 GIN(tags)만 있다.** 본문 검색은 아직 요구사항이 아니다.
9. **Storage 객체 고아 대조 절차 없음.** DB의 `assets`와 버킷의 실제 객체 목록을 대조하는 운영 명령은
   아직 없다. 업로드 후 `finalize_upload`가 호출되지 않은 객체는 만료 정리 대상 asset과 함께 지워야 한다.
10. **정규식 반복 횟수 한도.** PostgreSQL은 `{m,n}`에서 n을 255까지만 허용한다(초과 시 실행 시점에 2201B).
    새 정규식을 추가할 때 길이 제한은 `char_length`로 따로 표현한다.
    `20260919130100`의 자체 점검이 이 패턴을 다시 들여오면 마이그레이션을 실패시킨다.
