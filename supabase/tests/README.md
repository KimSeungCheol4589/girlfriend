# DB-001 테스트 실행 방법

이 디렉터리의 SQL은 **로컬 테스트 DB 전용**이다. 운영 DB에 실행하지 않는다.
모든 신원은 합성이며 이메일은 예약 TLD(`.invalid`)를 쓴다. 실제 사진·이메일·자격 증명은 넣지 않는다.

## 전제

- `supabase/migrations/`의 마이그레이션이 이미 적용돼 있다.
- 로컬 DB 컨테이너가 실행 중이다: `supabase_db_girlfriend-db-env-d82f`
- 컨테이너를 시작·중지·재생성하지 않는다. `supabase stop/reset`도 쓰지 않는다.

## 1. 단일 세션 테스트 (10~50)

각 파일은 자신의 트랜잭션에서 실행되고 **마지막에 ROLLBACK**한다. DB에 잔여물이 남지 않는다.
`\ir _helpers.sql`을 쓰므로 파일 경로를 컨테이너 안에서 해석할 수 있어야 한다. 디렉터리째 복사한다.

```sh
C=supabase_db_girlfriend-db-env-d82f

docker cp supabase/tests "$C":/tmp/db-001-tests

for f in 10_schema_constraints.sql 20_privileges.sql 30_rls_visibility.sql \
         40_space_and_invites.sql 50_mutations.sql 60_deferred_triggers.sql \
         70_storage_policies.sql; do
  echo "== $f"
  docker exec -i "$C" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
    -f "/tmp/db-001-tests/$f" || { echo "FAILED: $f"; break; }
done
```

PowerShell에서는 아래와 같다.

```powershell
$c = 'supabase_db_girlfriend-db-env-d82f'
docker cp supabase/tests "${c}:/tmp/db-001-tests"
foreach ($f in @('10_schema_constraints.sql','20_privileges.sql','30_rls_visibility.sql',
                 '40_space_and_invites.sql','50_mutations.sql','60_deferred_triggers.sql',
                 '70_storage_policies.sql')) {
  Write-Output "== $f"
  docker exec -i $c psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "/tmp/db-001-tests/$f"
  if ($LASTEXITCODE -ne 0) { Write-Output "FAILED: $f"; break }
}
```

`docker cp`는 대상 디렉터리가 이미 있으면 그 **안으로** 복사한다. 다시 실행할 때는 먼저 지운다.

```sh
docker exec "$C" rm -rf /tmp/db-001-tests
```

판정 기준: 종료 코드 0이고 `TEST FAIL`이 출력되지 않으면 통과다.
`NOTICE: ok ...` 줄이 개별 확인 항목이다.

| 파일 | 확인 범위 |
| --- | --- |
| `10_schema_constraints.sql` | 길이·날짜·태그·섹션 JSON·생성 경로·공간 간 링크·사진 개수/순서·불변 열·버전 규칙·정원 |
| `20_privileges.sql` | anon/구성원/service_role 직접 DML 차단, 내부 헬퍼 실행 차단, 초대·중복요청 테이블 차단 |
| `30_rls_visibility.sql` | A·B·외부 계정 C·비로그인의 조회 가시성, 파일 상태별 노출, **첨부 여부 헬퍼의 공간 한정(D6)** |
| `40_space_and_invites.sql` | 부트스트랩 deny closed, 공간 생성 원자성, 초대 만료·교체·재사용·정원·재시도 |
| `50_mutations.sql` | 업로드 신뢰 경계(로그인 사용자 확정 차단, 위조 메타데이터 거부), **새 첨부 파일의 업로더 요구(D2)**, 추억 저장/삭제, 버전 충돌, 중복 요청, 맛집 상태 되돌리기, 개인 후기 권한 |
| `60_deferred_triggers.sql` | **회귀**: 지연 제약 트리거가 로그인 역할 컨텍스트에서 실행되는지 |
| `70_storage_policies.sql` | 비공개 버킷 정책: 경로 위조·남의 대기 파일·외부 계정·덮어쓰기·삭제 차단 |

## 2. 동시성 테스트

단일 세션으로는 잠금 경쟁을 재현할 수 없다. 두 세션을 겹쳐 실행한다.
픽스처는 **커밋**되며 스크립트가 끝나면 `99_teardown.sql`이 지정한 ID만 지운다.

```sh
sh supabase/tests/concurrency/run_race_tests.sh
# 컨테이너 이름이 다르면
DB_CONTAINER=<이름> sh supabase/tests/concurrency/run_race_tests.sh
```

**Windows Git Bash**: MSYS가 `/tmp/x.sql` 같은 인자를 Windows 경로로 바꿔 컨테이너 안 psql에 넘기는 문제가 있었다.
러너가 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`로 변환을 끄고, `docker cp` 원본만 `cygpath -w`로
호스트 경로를 만들어 넘긴다. 러너 밖에서 직접 `docker exec ... -f /tmp/...`를 칠 때도 같은 접두사가 필요하다.
러너는 이 실행 전용 디렉터리(`/tmp/db-001-concurrency-<pid>`)만 만들고 끝에 그것만 지운다.

| 시나리오 | 기대 결과 |
| --- | --- |
| 서로 다른 사용자의 동시 초대 수락 | 먼저 공간 행을 잠근 세션만 성공. 다른 세션은 `GF411`(또는 폐기 후 `GF410`). 구성원 2명 유지 |
| 같은 추억을 같은 expectedVersion으로 동시 저장 | 나중 세션은 `GF409`. 조용한 덮어쓰기 없음 |
| 같은 requestId로 같은 입력 재전송 | 두 세션이 **같은 memoryId**를 받고 추억은 1건만 생성 |
| 같은 사용자가 **서로 다른 공간** 초대를 동시 수락 | 나중 세션은 `GF409`(원시 `23505`면 실패). 계정당 공간 1개 유지 |
| 같은 사용자의 **첫 프로필** 동시 생성 | 나중 세션은 `GF409`(원시 `23505`면 실패). 프로필 1건 |

판정 방식:

- 각 세션이 자기 SQLSTATE와 반환 JSON을 `tests_race.results`에 기록한다. 로그 문자열을 파싱하지 않는다.
- `90_verify.sql`이 그 표와 최종 DB 상태를 함께 확인한다. 패자의 **오류 코드**와
  중복 제출 두 응답의 **ID 일치**까지 본다. 행 수만 보지 않는다.
- 세션 1은 `_barrier.sql`로 상대 세션이 실제로 잠금 대기에 들어간 것을 확인한 뒤 커밋한다.
  겹치지 않으면 실패로 처리한다(우연히 순차 실행된 결과를 통과로 기록하지 않기 위해서다).
- 세션 1은 커밋 순간까지 `authenticated` 역할을 유지한다. 커밋 시점 지연 트리거의 실제 보안 컨텍스트를
  그대로 재현하기 위해서다. 세션 스크립트에서 `RESET ROLE`을 넣지 않는다.
- 기대된 거부는 세션 스크립트 안에서 잡아 기록하므로, **psql 종료 코드가 0이 아니면 그 자체가 결함 신호**다.
  러너가 두 세션의 종료 코드를 모두 확인한다.
- setup·복사 같은 앞 단계가 중단되면 러너는 그 종료 코드를 보존한다. teardown이 성공해도 통과로 바뀌지 않는다.
- teardown은 고정 UUID 목록(공간 3개, 사용자 7개)만 지운다. 정리 후 남은 행이 있으면 오류를 낸다.

## 3. 정리

단일 세션 테스트는 롤백되므로 정리가 필요 없다. 동시성 테스트가 중간에 끊긴 경우:

```sh
docker exec -i supabase_db_girlfriend-db-env-d82f psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/tests/concurrency/99_teardown.sql
```

## 알아둘 점

- 테스트는 `auth.users`에 합성 계정을 직접 넣는다. GoTrue 스키마가 바뀌면 `tests_support.make_user`의 열 목록을 맞춰야 한다.
- `app_private.*`는 설계상 `authenticated`가 호출할 수 없다. 테스트에서 로그인 역할로 전환한 구간에서는 이 함수들을 호출하지 않는다.
  (`app_private.kst_today()`, `default_home_sections()` 같은 것도 마찬가지다. 그 구간에서는 리터럴이나 인라인 식을 쓴다.)
- 부트스트랩 허용 목록은 40·60번 테스트가 트랜잭션 안에서만 추가하고 롤백한다. 실제 운영 등록은 별도 절차다.
- 60번은 롤백 트랜잭션 안에서 `SET CONSTRAINTS ALL IMMEDIATE`를 **authenticated 역할로** 실행해
  커밋 시점 지연 트리거와 같은 보안 컨텍스트를 재현한다. 실제 COMMIT 경로는 동시성 러너가 함께 검증한다.
- 70번은 `storage.objects`에 **메타데이터 행만** 만든다. 실제 파일 바이트는 쓰지 않는다.
  Storage 내부 트리거가 버전에 따라 다를 수 있어, 허용 케이스는 `expect_not_denied`로
  "정책에 막히지 않았다(42501 아님)"를 확인한다. 거부 케이스는 정확히 `42501`을 요구한다.
