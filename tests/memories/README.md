# 추억(MEM-001) 테스트 — 로컬 전용

```text
tests/memories/
  fixtures/cli.mjs     합성 계정 mem-e2e-{a,b,c}@test.invalid 준비·정리
  support/local-api.ts 로컬 REST/Storage 호출, 합성 PNG 생성
  decoder/             실제 sharp로 서버 읽기 전용 검증기 확인 (Vitest)
  integration/         실제 로컬 Supabase로 확정 프로토콜(동시성·유실·중단·불변)·파일 정리 검증 (Vitest)
  e2e/                 실제 앱(127.0.0.1:3003) + 로컬 Supabase (Playwright)
```

순수 로직 단위 테스트는 `tests/unit/memories-*.test.ts`(기본 `pnpm test`에 포함)다.
그 외에는 **모의 백엔드를 쓰지 않는다.** 아래 명령은 모두 실제 로컬 서비스로 간다.

## 1. 안전장치

- Supabase 주소가 loopback이 아니면 멈춘다. `NODE_ENV=production`이면 실행하지 않는다.
- 계정은 `mem-e2e-a|b|c@test.invalid`만 만들고 지운다. 인증 E2E 계정(`auth-e2e-*`)·공간은 건드리지 않는다.
- 비밀번호는 매번 새로 만들어 `.agent-runtime/memories-e2e/accounts.json`(Git 제외, 0600)에만 둔다.
- 키·비밀번호·토큰·파일 경로를 출력하지 않는다. 단언은 boolean·상태 코드 중심이다.
- Playwright는 trace·video·screenshot을 끄고, 실패 문맥의 페이지 스냅샷은 인증 리포터로 지운다.
- teardown은 이 픽스처 계정이 속하거나 만든 공간의 파일·행만 지운다(DB 생성 열의 경로만 사용).

## 2. 환경 변수 (테스트 명령의 환경으로만, 앱 `.env.local`에 넣지 않는다)

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `MEM_TEST_SUPABASE_URL` | 예 | 로컬 API (없으면 `AUTH_TEST_SUPABASE_URL`) |
| `MEM_TEST_ANON_KEY` | 예 | 공개 키 (없으면 `AUTH_TEST_ANON_KEY`) |
| `MEM_TEST_SERVICE_ROLE_KEY` | 예 | 픽스처·검증용 읽기, 그리고 E2E 앱 서버의 `MEM_SUPABASE_SERVICE_ROLE_KEY`로만 전달(다른 service 키 이름은 앱 서버에서 비운다) |
| `MEM_TEST_DB_CONTAINER` | 픽스처 필수 | 허용 목록 등록·정리용 로컬 DB 컨테이너 이름 |
| `MEM_TEST_PHOTOS` | 아니오 | `off`면 앱 서버에 서비스 키를 넘기지 않고 사진 꺼짐 동작만 확인 |

## 3. 실행 순서 (인증 E2E와 동시에 돌리지 않는다)

```sh
node tests/memories/fixtures/cli.mjs setup

pnpm exec vitest run tests/unit/memories-              # 순수 로직
pnpm exec vitest run --config tests/memories/vitest.config.ts   # sharp 디코딩 + 실제 정리
pnpm exec playwright test --config playwright.memories.config.ts
MEM_TEST_PHOTOS=off pnpm exec playwright test --config playwright.memories.config.ts photos-disabled.spec.ts

node tests/memories/fixtures/cli.mjs teardown
```

`decoder/`·`integration/finalize`는 `sharp`(승인된 직접 의존성)가 설치돼 있어야 한다. 모의 디코더를 쓰지 않는다.
`integration/finalize`의 "RPC 중단" 한 건만 service.rpc 첫 호출을 실패시키는 래퍼를 쓰고, 나머지는 모두 실제 호출이다.

## 4. 확인하는 것

- 글: 생성·B 조회·B 수정·재로그인 후 유지, 월·태그 URL 필터(쉼표 태그 포함), 20개 더 보기 순서·중복 없음,
  버전 충돌 시 입력 유지, 같은 requestId 재전송 1회 반영·다른 입력 거부, 응답 유실 후 재시도 1건,
  두 번 클릭 1건, 필드 오류·미래 날짜, 형식 틀린/없는/외부 ID 같은 404, 비로그인·외부 계정 RLS/RPC 거부,
  사용자 `finalize_upload` 실행 불가, 고정→두 사람 홈 요약, 고정 응답 유실 재시도(버전 1회만 증가),
  고정 중 상대 선수정→충돌·상대 수정 유지, 삭제, 로그아웃 후 화면·사진 경로 차단.
- 사진: 저장 전 업로더만(B·C·비로그인·Storage 직접·REST 직접 거부), B가 A의 미첨부 asset 가로채기 불가,
  저장 후 A·B만, 전처리를 우회한 EXIF JPEG는 서버가 거부·정리(재인코딩 없음), 재시도 시 브라우저 정규화 파일로 확정,
  빼기→deleting+객체 삭제, 형식 불일치·40MP·손상 파일 거부·정리, 거부 후 같은 선택으로 재시도,
  경로 밖 업로드·덮어쓰기·비로그인 업로드 거부, 사진 기록 삭제→객체 삭제·404,
  저장 없이 메뉴 이동·뒤로 가기(클라이언트 이동)로 떠나면 올린 사진 정리.
  업로드 바꿔치기는 storage-js의 multipart 본문에서 **파일 파트만** 바꾸고(`e2e/multipart.ts`), 주입한 바이트가
  그 asset 경로에 실제로 저장됐는지 service로 읽어 확인한 뒤 확정을 진행시킨다.
- 모바일(375×812, `photos-mobile.spec.ts`): 사진 두 장 순서 변경 저장, 상대가 기존 사진 하나를 빼면 그 파일만
  deleting·객체 삭제·404이고 남은 사진은 ready·조회 가능, 폼·상세 가로 넘침 없음.
- 확정 프로토콜(integration): 정상 확정 후 객체 해시 불변, 동시 확정 3건, ready 재확정 무변경, RPC 중단 후 재시도,
  업로드 응답 유실(같은 경로 재업로드·upsert 거부 후 원본으로 확정), 미업로드 asset은 같은 asset 재업로드 안내,
  확정·취소 동시 실행, 첨부 후 재확정·덮어쓰기 시도 무변경, EXIF·긴 변 초과 거부·정리, 상대 구성원 확정 불가.
- 정리 실패: 서버 키 없음 → 보류(객체·deleting 유지) → 같은 대상 재시도 → 삭제(integration).
- 사진 꺼짐: 이유 표시·파일 입력 비활성·글 저장 정상(`MEM_TEST_PHOTOS=off`).

## 5. 확인하지 않는 것

- 실제 휴대폰 사진·HEIC 변환, 모바일 실기기, 접근성 자동 검사.
- TUS/멀티파트 업로드(앱은 표준 업로드만 쓴다).
- 메타데이터 행 삭제·만료 전환(REST 미노출, docs/memories/CLEANUP.md). 전역 만료 함수는 공유 DB에서 실행하지 않는다.
- 탭 닫기·새로고침·로그아웃 때의 정리(보장하지 않음, 24시간 만료 절차에 맡김).
- 배포 환경·운영 데이터.
