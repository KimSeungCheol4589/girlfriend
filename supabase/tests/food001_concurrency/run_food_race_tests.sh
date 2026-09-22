#!/usr/bin/env sh
# FOOD-001 동시성 테스트 실행기 (로컬 테스트 DB 전용)
#
# 두 psql 세션을 겹쳐 실제 맛집 행 잠금 경쟁을 만든다. 세션 1은 _barrier.sql로
# "세션 2가 바로 나 때문에 막혔다"를 확인한 뒤에만 커밋하므로 겹침이 결정적이다.
# 구조와 Windows Git Bash 대응은 DB-001 concurrency/run_race_tests.sh를 따른다(그 파일은 수정하지 않는다).
#
# 사용법 (저장소 루트에서):
#   sh supabase/tests/food001_concurrency/run_food_race_tests.sh
#   DB_CONTAINER=다른이름 sh supabase/tests/food001_concurrency/run_food_race_tests.sh
#
# 전제: FOOD-001 마이그레이션 2개가 적용돼 있다.
# 실패 규칙: 세션 종료 코드가 0이 아니거나(예상 밖 오류·겹침 실패), 90_verify.sql이 실패하거나,
#           앞 단계가 중단되면 실패다. teardown 성공이 앞의 실패를 덮지 않는다.
# 컨테이너를 시작·중지·재생성하지 않는다. 지우는 것은 이 실행이 만든 임시 디렉터리와 고정 ID 픽스처뿐이다.

set -eu

DB_CONTAINER="${DB_CONTAINER:-supabase_db_girlfriend-db-env-d82f}"
DIR="$(cd "$(dirname "$0")" && pwd)"
LAG_SECONDS="${LAG_SECONDS:-1}"
LOG_DIR="${LOG_DIR:-/tmp/food001-race}"
CONTAINER_DIR="/tmp/food-001-concurrency-$$"

FAILED=0
COPIED=0

mkdir -p "$LOG_DIR"

dockerx() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker "$@"
}

to_host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

psql_run() {
  # $1: 컨테이너 안 파일 경로, 나머지: 추가 psql 인자
  file="$1"
  shift
  dockerx exec -i "$DB_CONTAINER" \
    psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@" -f "$file"
}

cleanup() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$FAILED" -eq 0 ]; then
    FAILED="$rc"
    echo "FAIL: 스크립트가 종료 코드 $rc 로 중단됐다"
  fi

  if [ "$COPIED" -eq 1 ]; then
    echo "--- teardown ---"
    if ! psql_run "$CONTAINER_DIR/99_teardown.sql"; then
      echo "teardown 실패: 남은 픽스처(0f00d001-… 고정 ID)를 직접 확인한다"
      if [ "$FAILED" -eq 0 ]; then FAILED=1; fi
    fi
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
  name="$1"
  echo "--- 경쟁: $name ---"

  psql_run "$CONTAINER_DIR/session1.sql" -v "scenario=$name" > "$LOG_DIR/$name-s1.log" 2>&1 &
  s1_pid=$!

  sleep "$LAG_SECONDS"

  s2_rc=0
  psql_run "$CONTAINER_DIR/session2.sql" -v "scenario=$name" > "$LOG_DIR/$name-s2.log" 2>&1 || s2_rc=$?

  s1_rc=0
  wait "$s1_pid" || s1_rc=$?

  echo "[session1 rc=$s1_rc]"; cat "$LOG_DIR/$name-s1.log"
  echo "[session2 rc=$s2_rc]"; cat "$LOG_DIR/$name-s2.log"

  if [ "$s1_rc" -ne 0 ]; then
    echo "FAIL[$name]: 세션 1이 실패했다(예상 밖 오류 또는 겹침 실패) rc=$s1_rc"
    FAILED=1
  fi
  if [ "$s2_rc" -ne 0 ]; then
    echo "FAIL[$name]: 세션 2가 실패했다 rc=$s2_rc (기대된 거부는 run()이 기록한다)"
    FAILED=1
  fi
}

for scenario in review_vs_cancel edit_vs_delete two_reviews cancel_vs_review review_delete_vs_cancel retry; do
  run_race "$scenario"
done

echo "--- 기록된 세션 결과 ---"
dockerx exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X \
  -c "select scenario, session_no, coalesce(sqlstate,'(성공)') as sqlstate, detail, result from tests_food_race.results order by scenario, session_no;" \
  || FAILED=1

echo "--- verify ---"
if psql_run "$CONTAINER_DIR/90_verify.sql"; then
  if [ "$FAILED" -eq 0 ]; then
    echo "FOOD-001 동시성 테스트 통과"
  else
    echo "검증은 통과했지만 실행 단계에 문제가 있었다. 위 FAIL 줄을 확인한다."
  fi
else
  echo "FAIL: 90_verify.sql 실패"
  FAILED=1
fi
