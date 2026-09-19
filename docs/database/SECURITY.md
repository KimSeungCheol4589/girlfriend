# DB-001 권한 모델·설계 차이·알려진 한계

작성일: 2026-09-19 · 기준 문서: DESIGN.md 6절, TECH_STACK.md 5절

## 1. 두 겹의 검사

RLS와 SQL 권한은 서로 다른 검사다. 둘 다 정의했다.

| 역할 | 테이블 권한 | 함수 실행 | RLS |
| --- | --- | --- | --- |
| `anon` | 없음 | `app.*` 읽기 헬퍼만 | 정책 평가 이전에 권한에서 막힘 |
| `authenticated` | 9개 테이블 **SELECT만** | `public.*` 변경 RPC + `app.*` 헬퍼 | SELECT 정책만 존재 |
| `service_role` | 9개 테이블 SELECT (쓰기 회수) | 지정한 운영 함수만 | BYPASSRLS |
| `postgres` | 소유자 | 전체 | 소유자 우회(FORCE 미사용) |

- 어떤 클라이언트 역할에도 INSERT/UPDATE/DELETE 권한이 없다. 변경은 `SECURITY DEFINER` RPC로만 한다.
- **쓰기 정책 자체를 만들지 않았다.** 나중에 실수로 GRANT가 들어가도 RLS가 다시 막는다.
- `space_invites`, `mutation_requests`는 SELECT 권한도 정책도 없다. 초대 상태는 `public.list_space_invites()`로만 본다.
- PostgreSQL 기본값(신규 함수의 PUBLIC EXECUTE)과 Supabase 기본값(public 스키마 신규 객체의 anon/authenticated 권한)을
  `ALTER DEFAULT PRIVILEGES`로 모두 차단하고, 필요한 권한만 명시적으로 부여한다.
- 11번 마이그레이션 끝의 `DO` 블록이 적용 직후 (1) 직접 쓰기 권한 잔존 (2) 민감 테이블 권한 (3) `app_private` 노출
  (4) RLS 미적용 테이블 (5) search_path 미고정 SECURITY DEFINER 함수를 점검하고, 위반이 있으면 마이그레이션을 실패시킨다.

## 2. 비재귀 RLS

`space_members`에 대한 정책이 다시 `space_members`를 읽으면 무한 재귀가 된다.
소속 확인은 `app.current_space_id()` / `app.is_space_member()` / `app.is_space_peer()`로 분리했다.
이 함수들은 `SECURITY DEFINER`(소유자 postgres)라 내부 조회에서 정책을 다시 평가하지 않는다.

이 때문에 제품 테이블에는 **`FORCE ROW LEVEL SECURITY`를 쓰지 않는다.** 강제하면 소유자도 정책을 적용받아
헬퍼가 다시 재귀한다. 대신 소유자 접근 경로(psql, 마이그레이션)를 운영 절차로 통제한다.

`app.*` 헬퍼는 호출자 자신에 관한 사실만 반환하므로 `anon`에도 EXECUTE를 주었다.
권한 오류 대신 "0행"이 나오게 하려는 의도다. `app_private.*`는 어떤 클라이언트 역할도 실행할 수 없다.

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
10. **`service_role`의 제품 테이블 직접 쓰기를 회수했다.** 서비스 키가 새더라도 RPC 밖에서 데이터를 바꿀 수 없다.
    복구·백필은 `postgres` 역할로 하고 기록을 남긴다.

## 7. 알려진 한계 (이번 범위에서 처리하지 않음)

1. **실행 검증 미완료.** 이 세션은 SQL을 작성만 했고 적용·테스트를 실행하지 않았다.
   문법 오류, Supabase 17.6 환경 차이, `auth.users` 열 구성 차이는 실제 적용에서 확인해야 한다.
2. **Storage 정책 미포함.** `storage.objects`의 RLS와 버킷 생성은 이 작업 범위에 넣지 않았다.
   `assets` 테이블의 소유·상태·첨부 여부만 관리한다. 실제 파일 다운로드 차단은 후속 작업에서
   `assets`를 기준으로 `storage.objects` 정책을 만들어야 한다. 그 전에는 버킷 설정으로만 보호된다.
3. **`finalize_upload`의 메타데이터는 호출자 신뢰.** bytes·width·height는 Server Action이 Storage에서
   실제 파일을 검사한 뒤 전달해야 한다. DB는 상한값과 소유자만 강제한다.
   더 강하게 막으려면 이 함수를 `service_role` 전용으로 옮기고 사용자 ID를 인자로 받는 변형이 필요하다.
4. **파일 정리 스케줄 없음.** `app_private.expire_stale_assets()`를 호출하는 주기 작업은 배포 환경에서 설정한다.
5. **공간 탈퇴·구성원 교체·공간 삭제 없음.** DESIGN 1절대로 MVP에서 제외했다. `assets` 참조가 `RESTRICT`라
   공간 삭제는 수동 절차가 필요하다.
6. **`mutation_requests` 보존 정책 없음.** 무한히 쌓인다. 운영 전에 보관 기간과 정리 작업을 정해야 한다.
7. **`down` 마이그레이션 없음.** 되돌리려면 README의 DROP 절차를 로컬에서만 쓴다.
8. **`auth.users.deleted_at`·`banned_until`을 보지 않는다.** GoTrue 스키마 버전 차이로 마이그레이션이 실패할 위험을
   피하려고 `email` + `email_confirmed_at`만 확인한다. 정지된 계정 차단은 Auth 계층에서 처리해야 한다.
9. **태그 검색·본문 전문 검색 인덱스는 GIN(tags)만 있다.** 본문 검색은 아직 요구사항이 아니다.
