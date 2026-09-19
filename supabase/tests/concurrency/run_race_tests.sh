#!/usr/bin/env sh
# DB-001 동시성 테스트 실행기
#
# 두 개의 psql 세션을 겹쳐 실행해 실제 잠금 경쟁을 만든다.
# 단일 세션 SQL로는 재현할 수 없는 항목만 여기서 확인한다.
#
# 사용법 (저장소 루트에서):
#   sh supabase/tests/concurrency/run_race_tests.sh
#   DB_CONTAINER=다른이름 sh supabase/tests/concurrency/run_race_tests.sh
#
# 전제
#   * 마이그레이션이 이미 적용돼 있다.
#   * docker exec 권한이 있다.
#   * 이 스크립트는 컨테이너를 시작·중지·재생성하지 않는다.
#
# 픽스처는 커밋되며 마지막에 99_teardown.sql로 지운다.
# 중간에 실패해도 teardown은 항상 실행한다.

set -eu

DB_CONTAINER="${DB_CONTAINER:-supabase_db_girlfriend-db-env-d82f}"
DIR="$(cd "$(dirname "$0")" && pwd)"
LAG_SECONDS="${LAG_SECONDS:-1}"

psql_file() {
  # $1: sql 파일 경로
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -X < "$1"
}

cleanup() {
  echo "--- teardown ---"
  psql_file "$DIR/99_teardown.sql" || echo "teardown 실패: 남은 행을 직접 확인한다"
}
trap cleanup EXIT

echo "--- setup ---"
psql_file "$DIR/99_teardown.sql" >/dev/null 2>&1 || true
psql_file "$DIR/00_setup.sql"

run_race() {
  # $1: 이름, $2: 세션1 파일, $3: 세션2 파일
  echo "--- 경쟁: $1 ---"
  psql_file "$2" > "/tmp/db001-$1-s1.log" 2>&1 &
  s1_pid=$!
  sleep "$LAG_SECONDS"
  psql_file "$3" > "/tmp/db001-$1-s2.log" 2>&1 || true
  wait "$s1_pid" || echo "세션1 종료 코드 비정상 — 아래 로그 확인"
  echo "[session1]"; cat "/tmp/db001-$1-s1.log"
  echo "[session2]"; cat "/tmp/db001-$1-s2.log"
}

run_race "invite"       "$DIR/10_invite_race_session1.sql"      "$DIR/11_invite_race_session2.sql"
run_race "version"      "$DIR/20_version_race_session1.sql"     "$DIR/21_version_race_session2.sql"
run_race "idempotency"  "$DIR/30_idempotency_race_session1.sql" "$DIR/31_idempotency_race_session2.sql"

echo "--- verify ---"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -X -v ON_ERROR_STOP=1 < "$DIR/90_verify.sql"

echo "동시성 테스트 통과"
