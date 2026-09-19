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
         40_space_and_invites.sql 50_mutations.sql; do
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
                 '40_space_and_invites.sql','50_mutations.sql')) {
  Write-Output "== $f"
  docker exec -i $c psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "/tmp/db-001-tests/$f"
  if ($LASTEXITCODE -ne 0) { Write-Output "FAILED: $f"; break }
}
```

판정 기준: 종료 코드 0이고 `TEST FAIL`이 출력되지 않으면 통과다.
`NOTICE: ok ...` 줄이 개별 확인 항목이다.

| 파일 | 확인 범위 |
| --- | --- |
| `10_schema_constraints.sql` | 길이·날짜·태그·섹션 JSON·생성 경로·공간 간 링크·사진 개수/순서·불변 열·버전 규칙·정원 |
| `20_privileges.sql` | anon/구성원/service_role 직접 DML 차단, 내부 헬퍼 실행 차단, 초대·중복요청 테이블 차단 |
| `30_rls_visibility.sql` | A·B·외부 계정 C·비로그인의 조회 가시성, 파일 상태별 노출 |
| `40_space_and_invites.sql` | 부트스트랩 deny closed, 공간 생성 원자성, 초대 만료·교체·재사용·정원·재시도 |
| `50_mutations.sql` | 업로드 상태, 추억 저장/삭제, 버전 충돌, 중복 요청, 맛집 상태 되돌리기, 개인 후기 권한 |

## 2. 동시성 테스트

단일 세션으로는 잠금 경쟁을 재현할 수 없다. 두 세션을 겹쳐 실행한다.
픽스처는 **커밋**되며 스크립트가 끝나면 `99_teardown.sql`이 지정한 ID만 지운다.

```sh
sh supabase/tests/concurrency/run_race_tests.sh
# 컨테이너 이름이 다르면
DB_CONTAINER=<이름> sh supabase/tests/concurrency/run_race_tests.sh
```

| 시나리오 | 기대 결과 |
| --- | --- |
| 서로 다른 사용자의 동시 초대 수락 | 먼저 공간 행을 잠근 세션만 성공. 다른 세션은 `GF411`(또는 폐기 후 `GF410`). 구성원 2명 유지 |
| 같은 추억을 같은 expectedVersion으로 동시 저장 | 나중 세션은 `GF409`. 조용한 덮어쓰기 없음 |
| 같은 requestId로 같은 입력 재전송 | 두 세션이 같은 memoryId를 받고 추억은 1건만 생성 |

최종 판정은 `90_verify.sql`이 한다. 세션 로그의 오류 메시지는 참고 자료다.

## 3. 정리

단일 세션 테스트는 롤백되므로 정리가 필요 없다. 동시성 테스트가 중간에 끊긴 경우:

```sh
docker exec -i supabase_db_girlfriend-db-env-d82f psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/tests/concurrency/99_teardown.sql
```

## 알아둘 점

- 테스트는 `auth.users`에 합성 계정을 직접 넣는다. GoTrue 스키마가 바뀌면 `tests_support.make_user`의 열 목록을 맞춰야 한다.
- `app_private.*`는 설계상 `authenticated`가 호출할 수 없다. 테스트에서 로그인 역할로 전환한 구간에서는 이 함수들을 호출하지 않는다.
- 부트스트랩 허용 목록은 40번 테스트가 트랜잭션 안에서만 추가하고 롤백한다. 실제 운영 등록은 별도 절차다.
