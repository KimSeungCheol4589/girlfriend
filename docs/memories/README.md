# 추억(MEM-001) — 실제 저장·사진 구조와 설정

작성일: 2026-09-21 · 기준: DESIGN.md 3·7·8.2·8.3, docs/database/CONTRACTS.md 2·3·6

## 1. 무엇이 어디서 실행되는가

| 동작 | 실행 위치 | 사용하는 권한 |
| --- | --- | --- |
| 목록·상세·홈 요약 조회 | 서버 컴포넌트 (`src/features/memories/server/queries.ts`) | 사용자 세션 + RLS |
| 저장·삭제·고정·더 보기 | Server Action (`server/actions.ts`) → `save_memory` / `delete_memory` | 사용자 세션 + RPC |
| 사진 준비 | Server Action → `prepare_upload('memory', …)` | 사용자 세션 |
| 사진 업로드 | 브라우저 → Storage 표준 업로드(`upsert: false`), `prepare_upload` 응답의 버킷·경로 그대로 | 사용자 세션 + Storage 정책 |
| 사진 확정 | Server Action `finalizeMemoryPhotoAction` → `server/finalize-core.ts` | **소유 확인은 사용자 RLS**, 그 뒤 읽기 전용 다운로드와 `finalize_upload`만 service. 객체 쓰기 없음 |
| 사진 취소 | Server Action → `discard_upload` | 사용자 세션 |
| 파일 정리 | 서버 (`server/cleanup.ts`) | service. DB 응답이 알려 준 `deleting` 경로만 |
| 사진 보기 | Route Handler `GET /memories/photos/[assetId]` | 사용자 세션 + RLS + Storage 정책. `private, no-store` |

모든 Server Action은 호출마다 `getSessionContext()`(Auth `getUser`)로 사용자·공간을 다시 확인한다.
클라이언트가 보낸 사용자·공간 ID는 받지 않는다. 일반 CRUD에는 service_role을 쓰지 않는다.

## 2. 사진: 브라우저 정규화 → 불변 업로드 → 서버 읽기 전용 검증 (총괄 결정, DESIGN 8.2)

정규화(방향 반영·긴 변 2,048px·WebP/JPEG 재인코딩·EXIF 제거)는 **브라우저가 첫 업로드 전에** 한다.
그 결과를 `prepare_upload`가 발급한 고유 경로에 표준 INSERT(`upsert:false`)로 **한 번만** 올린다.
이후 그 객체를 쓰는 주체는 없다(사용자 UPDATE/DELETE 정책 없음, 서버는 읽기만 함).

서버 확정 순서(`finalize-core.ts`):

1. Auth 사용자 재확인 → **사용자 RLS로** `assets` 행을 읽어 업로더 본인·본인 공간·`purpose='memory'`·
   생성 경로 규칙 일치를 확인한다. 하나라도 다르면 `NOT_FOUND`. 이 단계 전에는 service 작업이 없다.
2. 이미 `ready`면 아무것도 하지 않고 성공(멱등). `deleting`이면 실패.
3. service로 **크기 상한(10MiB)을 두고** 객체를 읽기 전용으로 내려받는다. 객체가 아직 없으면
   `retryStage: 'upload'`로 답해 브라우저가 **같은 pending asset·같은 경로**로 다시 올리게 한다.
4. 검증(`image-verify.ts`, 쓰기 없음): 바이트 시그니처 = 선언 형식 → sharp 메타데이터(디코더 형식, 한 장,
   40MP 이하, 긴 변 2,048px 이하) → EXIF·XMP·IPTC·Photoshop·PNG 텍스트·방향 태그가 있으면 거부(ICC 색 프로필은 허용)
   → 전체 픽셀 디코딩(`failOn:'warning'`).
5. service로 `finalize_upload(assetId, 검증한 uploaderId, 실제 bytes, width, height, 검증한 MIME, requestId)`.
   requestId는 asset ID에서 결정적으로, 값은 불변 객체에서 나오므로 재시도·동시 확정은 같은 페이로드로 합류한다.
   RPC가 실패하면 상태를 다시 읽어 이미 ready면 성공으로 본다.
6. 규칙 위반·만료·정리 중이면 사용자 세션으로 `discard_upload` 후 그 응답의 경로만 정리한다(첨부된 asset은
   `discard_upload`가 거부한다). 브라우저는 처리한 사진을 들고 있어 새 asset으로 다시 올릴 수 있다.

업로드 응답을 잃은 경우: 같은 경로 재업로드가 "이미 있음"으로 거부되면 덮어쓰지 않고 3~5단계로 넘어간다.
그 객체가 규칙에 맞지 않으면 서버가 거부한다. 동시 확정·확정 중 취소·RPC 중단 모두 객체 바이트를 바꾸지 않는다
(`tests/memories/integration/finalize.test.ts`).

서명 URL·공개 URL·관리자 로그는 쓰지 않는다. 오류 로그는 `memories.<작업> code=… requestId=…`만 남긴다.

## 3. 환경 변수 (값은 저장소에 넣지 않는다)

| 이름 | 위치 | 설명 |
| --- | --- | --- |
| `MEM_SUPABASE_SERVICE_ROLE_KEY` | **앱 서버 전용**(`NEXT_PUBLIC_` 아님, `server-only` 모듈에서만 읽음) | 사진 확정·파일 정리에만 쓴다. 없으면 **사진 올리기만** 꺼지고 화면이 그 사실을 밝힌다. 글 저장·기존 사진 보기(사용자 세션)는 그대로 된다 |

총괄 승인으로 `docs/auth/SETUP.md` 2.2절과 `.env.example`에 이 예외를 적었다(이름만, 값 없음).

## 4. 의존성

- 총괄 승인: `sharp@0.35.4`(서버 검증), `server-only@0.0.1`(서버 모듈 경계). `package.json`만 수정했고
  lockfile·설치는 Codex가 `pnpm install`로 만든다.
- sharp는 확정 경로에서만 동적 import한다. 불러오지 못하면 `PHOTOS_DISABLED`(가짜 성공 없음).

## 5. 화면 동작 요약

- 목록: `memory_date DESC, id DESC`, 20개씩 더 보기(커서 `YYYY-MM-DD_uuid`). 월·태그는 URL, 필터가 바뀌면 커서 초기화.
- 상세·편집: 없는 ID·다른 공간 ID·형식이 틀린 ID는 같은 404 화면(`src/app/memories/[id]/not-found.tsx`).
  스트리밍 렌더 특성상 HTTP 상태는 404가 아닐 수 있다(AUTH-001 SETUP 7.1과 같은 현상). 화면·내용은 같다.
- 저장: 같은 입력 재시도는 같은 requestId, 입력을 고치면 새 requestId, 확정 응답 뒤 새 requestId.
  저장 중 버튼 비활성 + DB 멱등성으로 이중 제출을 막는다.
- 고정/해제: 서버가 다시 읽지 않고 **화면이 렌더한 스냅샷 전체 + 바뀐 고정 여부**를 `save_memory`에 보낸다.
  응답을 잃은 재시도는 같은 스냅샷·같은 requestId라 DB가 재생하고, 상대가 먼저 저장했으면 버전 불일치로 CONFLICT다.
- 실패: 네트워크·검증·충돌·업로드 실패 모두 입력한 글과 이미 올린 사진을 유지한다. 충돌은 최신 내용을
  새 탭으로 보거나(쓰던 내용 유지) 최신 내용으로 다시 편집(버림)하도록 안내한다.
- 사진 미리보기 objectURL은 폼 훅이 만든 것만 폼 훅이 해제한다(기존 사진은 인증 경로라 해제 대상 아님).
- 로그아웃: 개인 응답은 `no-store`, 사진 응답도 `private, no-store`. 클라이언트 목록 상태는 메모리에만 있고
  로그아웃 리다이렉트로 사라진다.

## 6. 알려진 한계

- 홈 섹션 순서·표시 설정(THEME-001)은 아직 저장되지 않으므로 홈 요약은 기본 순서다.
- 필터 선택지는 최근 1,000개 기록에서 만든다(목록 자체는 영향 없음).
- 저장하지 않고 탭을 닫으면 올린 사진은 `pending/ready` 상태로 남아 24시간 뒤 만료 정리 대상이 된다.
  만료 정리 실행기는 없다(CLEANUP.md 참고).
