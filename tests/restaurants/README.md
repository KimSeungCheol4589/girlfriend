# FOOD-001 맛집 E2E·동시성 — 로컬 전용

로컬 Supabase(API `127.0.0.1:56321`, DB `127.0.0.1:56322`)와 실제 로그인으로 맛집 기능을 확인한다.
루트 공통 설정은 바꾸지 않고 `tests/restaurants/playwright.config.ts`만 쓴다.
앱 서버는 **`127.0.0.1:3004`**(통합 3000, 데모 3001, 인증 3002, MEM 3003).

```text
tests/restaurants/
  fixtures/cli.mjs     food001 합성 계정·공간 준비/정리 (인증 픽스처 모듈을 읽기 전용으로 재사용)
  e2e/*.spec.ts        Playwright 스펙
  playwright.config.ts 이 스위트 전용 설정
supabase/tests/
  80_restaurants_food001.sql     단일 세션 SQL(롤백)
  food001_concurrency/           두 세션 결정적 겹침 경쟁(전용 스키마 tests_food_race)
```

## 1. 안전장치

- 계정은 `food001-{a,b,c}@test.invalid`만 쓴다. 접두사는 코드에 고정돼 있고 `AUTH_TEST_EMAIL_PREFIX`를 따르지 않는다.
  **AUTH(`auth-e2e-*`)·MEM 픽스처 계정은 읽지도, 지우지도 않는다.** 동시성 스위트는 `food001-race-{a,b}@test.invalid`와 고정 UUID `0f00d001-…`만 쓴다.
- 인증 픽스처의 안전장치를 그대로 쓴다: loopback 주소만, `.invalid` 도메인만, `NODE_ENV=production` 금지.
- 비밀번호는 실행마다 새로 만들어 `.agent-runtime/food001-e2e/accounts.json`(Git 제외, 0600)에만 둔다.
- 키·비밀번호·초대 토큰은 출력하지 않는다. RPC 실패는 함수 이름·HTTP 상태·SQLSTATE만 출력한다.
- 앱 서버 환경의 `*SERVICE_ROLE*` 키는 빈 값으로 덮어쓴다(`tests/auth/web-server-env.ts`).
  스펙의 직접 API 호출은 **공개 키 + 사용자 세션**으로만 한다(관리자 키 미사용).
- 실패 산출물의 페이지 스냅샷은 `tests/auth/reporters/redact-error-context.ts`로 지운다. trace·video·screenshot은 끈다.
- 컨테이너를 만들거나 지우거나 재시작하지 않는다. 이미 떠 있는 DB 컨테이너에서 `psql`만 쓴다.
- 픽스처는 정리 결과를 **확인**한다. 허용 목록 제거·데이터 정리·계정 삭제를 DB/Auth에서 다시 조회해
  남아 있으면 종료 코드 1로 실패한다(성공처럼 끝나지 않는다). teardown은 데이터 정리 확인에 실패하면 계정을 지우기 전에 멈춘다.

## 2. 환경 변수 (인증 스위트와 같은 이름, 테스트 명령 환경으로만 전달)

| 이름 | 필수 | 용도 |
| --- | --- | --- |
| `AUTH_TEST_SUPABASE_URL` | 예 | 로컬 API 주소 |
| `AUTH_TEST_ANON_KEY` | 예 | 앱 서버 공개 키, 스펙·픽스처의 사용자 세션 호출 |
| `AUTH_TEST_SERVICE_ROLE_KEY` | 예(픽스처만) | 합성 계정 생성·삭제. 스펙·앱은 쓰지 않는다 |
| `AUTH_TEST_DB_CONTAINER` | 예(픽스처만) | 공간 생성 허용 목록 등록·해제·확인, food001 데이터 초기화·확인 |
| `FOOD_E2E_PORT` | 아니오 | 기본 3004 |

## 3. 실행 순서

```sh
# 0) DB: FOOD-001 마이그레이션 2개 적용
#    supabase/migrations/20260921100100_food_delete_restaurant_confirmation.sql
#    supabase/migrations/20260921110100_food_review_changes_bump_restaurant_version.sql
#    그 뒤 SQL 10~80 (supabase/tests/README.md). 50번은 새 버전 계약에 맞춰 갱신돼 있다.

# 1) 결정적 동시성 (두 psql 세션, 세션 1이 세션 2의 잠금 대기를 확인한 뒤 커밋)
sh supabase/tests/food001_concurrency/run_food_race_tests.sh

# 2) 합성 계정 A·B(같은 공간)·C(다른 공간) 준비. 매번 food001 데이터를 지우고 새로 만든다.
node tests/restaurants/fixtures/cli.mjs setup

# 3) E2E (포트 3004, 데모 모드 강제 해제)
node node_modules/@playwright/test/cli.js test --config tests/restaurants/playwright.config.ts

# 4) 정리: food001 공간·요청 기록 → 허용 목록 → 계정 → 계정 정보 파일 (각 단계 확인)
node tests/restaurants/fixtures/cli.mjs teardown
```

## 4. 결정적 동시성 시나리오 (`supabase/tests/food001_concurrency`)

모든 맛집은 visited·version 1에서 시작한다. 세션 1이 먼저 맛집 행 잠금을 쥐고, 세션 2가 **세션 1 때문에**
막힌 것을 `pg_blocking_pids`로 확인한 뒤에만 커밋한다(겹치지 않으면 실패). 판정은 세션 결과 표와 최종 DB 상태로 한다.

| 시나리오 | 세션 1 | 세션 2 | 기대 |
| --- | --- | --- | --- |
| `review_vs_cancel` | B 새 후기 | A 확인형 방문 취소(v1) | s2 `GF409 expectedVersion stale`, visited v2, 후기 1 |
| `edit_vs_delete` | B 후기 수정 | A 확인형 맛집 삭제(v1) | s2 stale, 맛집·수정된 후기 유지 |
| `two_reviews` | A 새 후기 | B 새 후기 | 둘 다 성공(반환 버전 2, 3), 후기 2 |
| `cancel_vs_review` | A 확인 없는 취소(v1) | B 새 후기 | s2 `GF409 not_visited`, wishlist, 후기 0 |
| `review_delete_vs_cancel` | B 후기 삭제 | A 확인형 방문 취소(v1) | s2 stale, visited v2, 후기 0 |
| `retry` | B 후기(requestId X) | B 같은 요청 재전송 | 두 결과 동일, 버전 한 번만 증가(v2), 요청 기록 1 |

공통 불변식: wishlist 맛집에 후기가 없다.

## 5. E2E 스펙

| 파일 | 확인 |
| --- | --- |
| `01-shared-crud.spec.ts` | A 등록 → B 검색·수정 → A 확인, 방문 처리, 각자 후기 작성·수정·삭제(상대 후기엔 편집 수단 없음), 후기 포함 삭제 확인, 입력 검증·첫 오류 포커스, 미래 방문일 거부, 일반 텍스트 렌더링, 필터 URL·20개 더 보기·중복 없음·뒤로 가기·빈 결과 |
| `02-access.spec.ts` | 비로그인(화면 리다이렉트·API 조회/변경 거부), 외부 공간 C(목록 없음·상세 404·API 변경 `GF404`), 같은 공간 B의 A 후기 변경·삭제·직접 테이블 쓰기 거부, **확인 없는 이전 `delete_restaurant` 직접 호출 `42501`** |
| `03-conflict-retry.spec.ts` | 같은 requestId 순차·동시 재전송 1건, 다른 입력 `GF409`, 오래된 버전 `GF409`, 화면 충돌 시 입력 유지·재저장도 덮어쓰지 않음·최신 불러오기 후 저장, **정보 수정 중 상대 후기 작성 → 충돌**, 서버 처리 후 응답 유실 → 같은 입력 재시도 1건, 같은 순간 두 번 클릭 → POST 1회·1건, **성공 뒤 이동을 붙잡은 구간의 재제출 → POST 1회·1건** |
| `04-visit-race.spec.ts` | 방문 취소(확인 없음/있음)·삭제 vs 후기 작성 동시 요청 반복(겹침 비보장, 불변식 확인). 화면: 창을 연 사이 후기가 **생기거나 수정되면** 아무것도 지우지 않고 바뀐 내용으로 다시 확인 |
| `05-persistence.spec.ts` | 로그아웃 → 새 컨텍스트 재로그인 후 맛집·방문일·후기 유지, B에게도 보임 |

## 6. 확인하지 않는 것·한계

- E2E의 동시 요청은 DB 안의 잠금 겹침을 보장하지 않는다. 겹침은 4절 스위트가 보장한다.
- 응답 유실은 Playwright `route.fetch()` 후 `abort()`로 재현한다. 실제 모바일 네트워크 끊김은 아니다.
- 모바일 뷰포트·실기기, 접근성 자동 검사, 배포 환경.
