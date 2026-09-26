# DATE-001 실제 인증 E2E

연결(데이트 기록) 계약을 로컬 Supabase에서 확인한다. 합성 계정 namespace는 `date-e2e`,
앱 서버 포트는 **3008**이다(통합 3000, 데모 3001, 인증 3002, MEM 3003, FOOD 3004, WISH 3006, CAL 3007).

## 준비

```bash
node tests/date/fixtures/cli.mjs setup     # date-e2e-a/b/c 합성 계정과 공간 준비
node tests/date/fixtures/cli.mjs status    # 준비 상태 확인
```

`AUTH_TEST_SUPABASE_URL`, `AUTH_TEST_ANON_KEY`가 필요하다(값은 출력하지 않는다).
Supabase 주소가 loopback이 아니면 설정 단계에서 중단한다.

## 실행

```bash
node node_modules/@playwright/test/cli.js test --config tests/date/playwright.config.ts
```

## 정리

```bash
node tests/date/fixtures/cli.mjs teardown
```

## 다루는 계약

| 파일 | 확인하는 것 |
| --- | --- |
| `e2e/01-create-from-source.spec.ts` | 해낸 위시·완료한 일정의 기록 작성 입구, URL에 enum·UUID만 싣는지, 제목 미리 채우기, 저장 후 원본에서 다시 찾기, 미완료 원본에는 입구 없음 |
| `e2e/02-delete-contract.spec.ts` | 연결된 원본 삭제 거부(`GF409 has_memories`), 추억 삭제 시 링크만 삭제·원본 유지, 연결 해제 후 삭제 가능, 다른 공간·비로그인 격리 |

## 주의

- 관리자 키는 쓰지 않는다. 스펙은 공개 키 + 사용자 세션으로만 호출한다.
- 기존 AUTH·MEM·FOOD·WISH·CAL 합성 계정과 컨테이너는 건드리지 않는다.
- 실패 산출물에서 페이지 스냅샷은 인증 스위트의 리포터가 지운다(입력값 유출 방지).
