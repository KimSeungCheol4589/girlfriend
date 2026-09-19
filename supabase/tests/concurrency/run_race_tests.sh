#!/usr/bin/env sh
# DB-001 동시성 테스트 실행기
#
# 두 개의 psql 세션을 겹쳐 실행해 실제 잠금 경쟁을 만든다.
# 단일 세션 SQL로는 재현할 수 없는 항목(커밋 시점 지연 트리거, 정원 경쟁, 버전 경쟁,
# 중복 제출, 서로 다른 공간 동시 수락, 첫 프로필 동시 생성)을 여기서 확인한다.
#
# 사용법 (저장소 루트에서):
#   sh supabase/tests/concurrency/run_race_tests.sh
#   DB_CONTAINER=다른이름 sh supabase/tests/concurrency/run_race_tests.sh
#
# Windows Git Bash 주의
#   MSYS는 `/tmp/x.sql` 같은 인자를 Windows 경로(C:/Users/.../Temp/x.sql)로 바꿔서 넘긴다.
#   그대로 두면 컨테이너 안 Linux psql이 존재하지 않는 경로를 받는다.
#   아래 dockerx()가 그 변환을 끄고, docker cp 원본만 cygpath로 호스트 경로를 만들어 준다.
#
# 실패 규칙
#   * 어느 세션이든 **예상하지 못한 SQL 오류**가 나면 실패로 집계한다.
#     기대된 거부는 세션 스크립트 안에서 잡아 tests_race.results에 기록하므로
#     psql 종료 코드가 0이 아니면 그 자체가 결함 신호다.
#   * 세션 1의 겹침 장치(_barrier.sql)가 상대 세션의 잠금 대기를 확인하지 못하면 실패한다.
#   * setup/copy 등 앞 단계가 중단되면 그 종료 코드를 그대로 보존한다. teardown이 성공해도 덮지 않는다.
#   * 컨테이너를 시작·중지·재생성하지 않는다. 지우는 것은 이 실행이 직접 만든 임시 디렉터리뿐이다.

set -eu

DB_CONTAINER="${DB_CONTAINER:-supabase_db_girlfriend-db-env-d82f}"
DIR="$(cd "$(dirname "$0")" && pwd)"
LAG_SECONDS="${LAG_SECONDS:-1}"
LOG_DIR="${LOG_DIR:-/tmp/db001-race}"

# 이 실행 전용 경로. 미리 존재하지 않으므로 docker cp가 그대로 만든다.
CONTAINER_DIR="/tmp/db-001-concurrency-$$"

FAILED=0
COPIED=0

mkdir -p "$LOG_DIR"

# MSYS 인자 변환을 끈 docker 호출. 컨테이너 안 경로를 인자로 주는 모든 곳에서 쓴다.
dockerx() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker "$@"
}

# docker cp의 원본은 호스트 경로여야 한다. Git Bash에서는 Windows 절대경로로 바꾼다.
to_host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

psql_run() {
  # $1: 컨테이너 안 파일 경로
  dockerx exec -i "$DB_CONTAINER" \
    psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "$1"
}

cleanup() {
  rc=$?
  # 앞 단계가 중단됐으면 그 실패를 보존한다. teardown 성공이 이를 덮지 않는다.
  if [ "$rc" -ne 0 ] && [ "$FAILED" -eq 0 ]; then
    FAILED="$rc"
    echo "FAIL: 스크립트가 종료 코드 $rc 로 중단됐다"
  fi

  if [ "$COPIED" -eq 1 ]; then
    echo "--- teardown ---"
    if ! psql_run "$CONTAINER_DIR/99_teardown.sql"; then
      echo "teardown 실패: 남은 픽스처를 직접 확인한다"
      if [ "$FAILED" -eq 0 ]; then FAILED=1; fi
    fi
    # 이 실행이 만든 디렉터리만 지운다.
    dockerx exec "$DB_CONTAINER" rm -rf "$CONTAINER_DIR" || true
  fi

  exit "$FAILED"
}

echo "--- 컨테이너 확인 ---"
dockerx inspect --format '{{.Name}} {{.State.Status}}' "$DB_CONTAINER"

echo "--- 스크립트 복사: $CONTAINER_DIR ---"
dockerx cp "$(to_host_path "$DIR")" "$DB_CONTAINER:$CONTAINER_DIR"
COPIED=1
trap cleanup EXIT

echo "--- setup ---"
psql_run "$CONTAINER_DIR/00_setup.sql"

run_race() {
  # $1: 이름, $2: 세션1 파일명, $3: 세션2 파일명
  name="$1"
  echo "--- 경쟁: $name ---"

  psql_run "$CONTAINER_DIR/$2" > "$LOG_DIR/$name-s1.log" 2>&1 &
  s1_pid=$!

  sleep "$LAG_SECONDS"

  s2_rc=0
  psql_run "$CONTAINER_DIR/$3" > "$LOG_DIR/$name-s2.log" 2>&1 || s2_rc=$?

  s1_rc=0
  wait "$s1_pid" || s1_rc=$?

  echo "[session1 rc=$s1_rc]"; cat "$LOG_DIR/$name-s1.log"
  echo "[session2 rc=$s2_rc]"; cat "$LOG_DIR/$name-s2.log"

  if [ "$s1_rc" -ne 0 ]; then
    echo "FAIL[$name]: 세션 1이 예상하지 못한 오류로 종료했다 (rc=$s1_rc)"
    FAILED=1
  fi
  if [ "$s2_rc" -ne 0 ]; then
    echo "FAIL[$name]: 세션 2가 예상하지 못한 오류로 종료했다 (rc=$s2_rc)."
    echo "             기대된 거부는 스크립트 안에서 잡아 기록해야 한다."
    FAILED=1
  fi
}

run_race "invite"      "10_invite_race_session1.sql"      "11_invite_race_session2.sql"
run_race "version"     "20_version_race_session1.sql"     "21_version_race_session2.sql"
run_race "idempotency" "30_idempotency_race_session1.sql" "31_idempotency_race_session2.sql"
run_race "crossspace"  "40_crossspace_race_session1.sql"  "41_crossspace_race_session2.sql"
run_race "profile"     "50_profile_race_session1.sql"     "51_profile_race_session2.sql"

echo "--- 기록된 세션 결과 ---"
dockerx exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X \
  -c "select scenario, session_no, coalesce(sqlstate,'(성공)') as sqlstate, result from tests_race.results order by scenario, session_no;" \
  || FAILED=1

echo "--- verify ---"
if psql_run "$CONTAINER_DIR/90_verify.sql"; then
  if [ "$FAILED" -eq 0 ]; then
    echo "동시성 테스트 통과"
  else
    echo "검증은 통과했지만 실행 단계에 문제가 있었다. 위 FAIL 줄을 확인한다."
  fi
else
  echo "FAIL: 90_verify.sql 실패"
  FAILED=1
fi
