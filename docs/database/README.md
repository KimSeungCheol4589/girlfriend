# DB-001 데이터베이스 기반 — 개요와 적용 절차

작성일: 2026-09-19 · 작업: DB-001 · 브랜치: `feat/db-foundation`

이 문서는 `supabase/migrations/`의 스키마·권한·RPC를 적용하고 검증하는 방법을 정리한다.
계약 상세는 [CONTRACTS.md](./CONTRACTS.md), 권한 모델과 한계는 [SECURITY.md](./SECURITY.md)를 본다.

> **현재 상태 (2026-09-19)**
> 로컬 테스트 DB에 마이그레이션 **16개 적용 완료**. 단일 세션 스위트 7개(10~70) **294개 단언 통과**,
> 동시성 5개 경쟁 **모두 통과**, 픽스처 정리 확인.
> **16번(`20260919150100`)과 D8~D10 회귀 테스트도 적용·재실행에 통과했다.**
> 구현 세션은 SQL을 직접 실행하지 않는다. 실행은 총괄(Codex)이 하고 결과는
> `docs/handoffs/DB-001.md`에 기록한다. 그 보고서가 상태의 기준 문서다.

## 1. 마이그레이션 파일

번호 순서대로 적용한다. 각 파일은 자체 트랜잭션(`begin; ... commit;`)으로 감싸져 있다.

| 순서 | 파일 | 내용 |
| --- | --- | --- |
| 1 | `20260919120100_foundation.sql` | `app`·`app_private` 스키마, 기본 권한 회수, 오류 코드 매핑, 순수 헬퍼, 운영 설정, 부트스트랩 허용 목록 |
| 2 | `20260919120200_core_tables.sql` | 제품 테이블·제약·인덱스, 공간 간 링크 차단용 복합 FK, 파일 경로 생성 열 |
| 3 | `20260919120300_triggers.sql` | updated_at, 불변 열, 버전 증가 규칙, 파일 상태 전이, 사진 개수·순서, 정원 백스톱 |
| 4 | `20260919120400_context_helpers.sql` | RLS용 비재귀 헬퍼, 인증·소속 검사, 멱등성 기반, 초대 토큰 생성, 운영 정리 함수 |
| 5 | `20260919120500_privileges_rls.sql` | GRANT/REVOKE, RLS 활성화, SELECT 정책 |
| 6 | `20260919120600_rpc_space_invites.sql` | `create_space`, `create_invite`, `revoke_invite`, `list_space_invites`, `accept_invite` |
| 7 | `20260919120700_rpc_assets.sql` | `prepare_upload`, `finalize_upload`, `discard_upload` |
| 8 | `20260919120800_rpc_memories.sql` | `save_memory`, `delete_memory` |
| 9 | `20260919120900_rpc_restaurants.sql` | 맛집·방문 상태·개인 후기 |
| 10 | `20260919121000_rpc_settings_profile.sql` | `save_customization`, `update_space`, `update_profile` |
| 11 | `20260919121100_rpc_grants.sql` | RPC 실행 권한 + 적용 직후 자체 점검(위반 시 실패) |
| 12 | `20260919130100_fix_regex_and_trigger_security.sql` | **수정**: 정규식 반복 횟수 한도(2201B), 모든 트리거 함수를 SECURITY DEFINER로 |
| 13 | `20260919130200_upload_finalization_trust.sql` | **수정**: `finalize_upload`를 신뢰된 서버 역할 전용으로 교체 |
| 14 | `20260919130300_storage_bucket_policies.sql` | 비공개 버킷 `space-assets`와 `storage.objects` 정책, `prepare_upload` 응답에 버킷 추가 |
| 15 | `20260919140100_attachment_ownership_and_conflict_mapping.sql` | **검토 반영**: 새 첨부 파일의 업로더 요구(D2), 동시 실행 UNIQUE→CONFLICT 매핑(D3), 첨부 여부 헬퍼 공간 한정(D6), 적용 역할 가드(D7) |
| 16 | `20260919150100_finalize_result_shape_and_guards.sql` | **검토 반영**: `finalize_upload` 재확정 응답에 `expiresAt` 포함(D8), 정규식 반복 횟수 점검을 숫자 비교로 교체(D9), 동시 경쟁 핸들러 진단용 DETAIL `path` 키(D10 보조) |

12번 이후는 이미 적용된 DB에 덧붙이는 **전진 수정**이다. 테이블을 지우거나 다시 만들지 않는다.
앞선 파일은 적용·검토된 상태 그대로 두고 수정하지 않는다.
새 DB에 처음부터 적용해도 1→16 순서로 실행하면 같은 최종 상태가 된다.

외부 확장은 쓰지 않는다. 토큰 해시는 `pg_catalog.sha256()`, 난수는 `gen_random_uuid()`를 사용한다.

### 12~14번이 고친 것

| 결함 | 증상 | 수정 |
| --- | --- | --- |
| 정규식 `{3,500}` | PostgreSQL 반복 횟수 한도는 255다. `map_url`이 NULL이 아닌 행에서 SQLSTATE `2201B` | 반복 횟수 제거 + `char_length` 제약 분리 |
| 지연 제약 트리거의 보안 컨텍스트 | 커밋 시점에 호출자 역할로 실행돼 `app_private` 접근이 42501. `accept_invite` 성공 후 COMMIT 실패 | 모든 트리거 함수를 SECURITY DEFINER + 고정 search_path로 |
| `finalize_upload` 신뢰 경계 | 로그인 사용자가 직접 호출해 파일 없이 `ready`로 만들 수 있었다 | 신뢰된 서버 역할 전용 + 명시 행위자 인자 + 세션 컨텍스트 이중 검사 |
| Storage 미보호 | 파일 본문 접근이 DB 정책으로 막히지 않았다 | 비공개 버킷 + 경로 일치 업로드/첨부 기준 읽기 정책 |

### 15번이 고친 것 (독립 검토 지적)

| 지적 | 증상 | 수정 |
| --- | --- | --- |
| D2 | `save_memory`·`save_customization`이 첨부 파일의 업로더를 보지 않아, 상대가 UUID를 알면 남의 비공개 파일을 붙여 노출시킬 수 있었다 | **새로 붙는 파일에만** 업로더 일치 요구. 유지·재정렬 사진과 바뀌지 않는 커버는 두 구성원 모두 가능 |
| D3 | 서로 다른 공간 동시 수락, 첫 프로필 동시 생성에서 원시 `23505`가 새어 나갔다 | 해당 INSERT만 감싸 `GF409`로 매핑(새 잠금 없음 → 교착 위험 없음) |
| D6 | `app.is_asset_attached`가 공간을 보지 않아 외부 계정이 첨부 여부를 알 수 있었다 | 호출자의 현재 공간으로 한정(정책 의미는 동일) |
| D7 | 기본 권한 회수는 적용 역할에만 유효한데 문서화·가드가 없었다 | 적용 역할 가드 추가, 소유 역할 요구를 문서화 |

## 2. 적용 (로컬 테스트 DB)

컨테이너: `supabase_db_girlfriend-db-env-d82f` (PostgreSQL 17.6). 컨테이너를 시작·중지·재생성하지 않는다.

```sh
C=supabase_db_girlfriend-db-env-d82f

# 적용 전 상태 확인 (제품 테이블이 없어야 한다)
docker exec -i "$C" psql -U postgres -d postgres -Atc \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';"

docker cp supabase/migrations "$C":/tmp/db-001-migrations

for f in 20260919120100_foundation.sql \
         20260919120200_core_tables.sql \
         20260919120300_triggers.sql \
         20260919120400_context_helpers.sql \
         20260919120500_privileges_rls.sql \
         20260919120600_rpc_space_invites.sql \
         20260919120700_rpc_assets.sql \
         20260919120800_rpc_memories.sql \
         20260919120900_rpc_restaurants.sql \
         20260919121000_rpc_settings_profile.sql \
         20260919121100_rpc_grants.sql \
         20260919130100_fix_regex_and_trigger_security.sql \
         20260919130200_upload_finalization_trust.sql \
         20260919130300_storage_bucket_policies.sql \
         20260919140100_attachment_ownership_and_conflict_mapping.sql \
         20260919150100_finalize_result_shape_and_guards.sql; do
  echo "== $f"
  docker exec -i "$C" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
    -f "/tmp/db-001-migrations/$f" || { echo "FAILED: $f"; break; }
done
```

15번까지 적용된 DB라면 16번만 실행한다.

```sh
docker cp supabase/migrations "$C":/tmp/db-001-migrations
docker exec -i "$C" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -f /tmp/db-001-migrations/20260919150100_finalize_result_shape_and_guards.sql
```

> Windows Git Bash에서는 `/tmp/...` 인자가 Windows 경로로 바뀐다.
> 위 명령을 Git Bash에서 실행할 때는 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`를 앞에 붙인다.
> PowerShell에서는 필요 없다.

14번은 `storage` 스키마가 있는 환경에서만 적용된다. 없으면 명확한 메시지와 함께 멈춘다.
정책 생성에는 `storage.objects`에 대한 소유자 권한이 필요하다. 로컬 Supabase의 `postgres` 역할로
실행하는 것을 전제로 한다. 권한 부족으로 실패하면 그 오류를 그대로 보고한다(우회하지 않는다).

11번 파일 끝의 `DO` 블록이 권한·RLS·search_path를 다시 점검한다. 위반이 있으면 그 자리에서 실패한다.

적용 후 확인:

```sh
docker exec -i "$C" psql -U postgres -d postgres -Atc \
  "select relname, relrowsecurity from pg_class c
     join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by 1;"
```

### 적용 역할 (중요)

**모든 마이그레이션은 같은 역할로 적용한다. 기본값은 `postgres`다.**

- `20260919120100`의 `ALTER DEFAULT PRIVILEGES`는 **그 문을 실행한 역할**에만 적용된다.
  다른 역할로 뒤이어 적용하면 그 역할이 만든 신규 객체에는 기본 권한이 그대로 붙는다.
- `SECURITY DEFINER` 함수의 정의자는 함수를 만든 역할이다. 역할이 섞이면 RLS 우회 전제가 깨진다.
- `20260919140100`부터는 마이그레이션 첫머리에서 "기존 객체 소유자 == 현재 역할"을 검사하고
  다르면 멈춘다. 새 마이그레이션을 추가할 때도 같은 가드를 넣는다.

부득이하게 다른 역할로 적용해야 하면, 그 역할로 `20260919120100`의 기본 권한 회수 문을 먼저 다시 실행하고
기존 객체의 소유자도 맞춰야 한다.

### 되돌리기

**down 마이그레이션은 제공하지 않는다.** 이 작업은 초기화가 아니라 전진 수정 방식이므로
스키마·테이블을 DROP하는 절차를 권장 경로로 문서화하지 않는다.

- 잘못된 상태에서 다시 시작해야 하면 **별도의 일회용 DB**를 만들어 1번부터 순서대로 적용한다.
- 공용 로컬 테스트 DB에서 제품 스키마를 DROP하지 않는다. 컨테이너·볼륨을 지우거나
  `supabase reset`을 실행하지 않는다.
- 개별 객체 수정이 필요하면 새 전진 마이그레이션으로 처리한다.

## 3. 부트스트랩 설정 (최초 공간 생성자)

`create_space`는 **운영자가 등록한 확인된 이메일**에만 허용된다. 목록이 비어 있으면 아무도 만들 수 없다.
클라이언트는 이 값을 입력으로 주장할 수 없고, 서버는 `auth.users.email` + `email_confirmed_at`만 본다.

```sh
# 운영자(psql, postgres 역할)
docker exec -i "$C" psql -U postgres -d postgres -c \
  "select app_private.add_bootstrap_creator('운영자이메일@example.com', '최초 사용자');"

# 현재 등록 상태
docker exec -i "$C" psql -U postgres -d postgres -c \
  "select email, note, created_at from app_private.bootstrap_creators order by created_at;"

# 해제
docker exec -i "$C" psql -U postgres -d postgres -c \
  "select app_private.remove_bootstrap_creator('운영자이메일@example.com');"
```

서버 애플리케이션에서 `service_role`로 호출할 수도 있다(같은 함수에 EXECUTE를 부여했다).
브라우저에는 이 경로를 노출하지 않는다.

## 4. 운영 설정 값

`app_private.app_config`에 있다. 앱이 읽거나 바꿀 수 없다.

| key | 기본값 | 용도 |
| --- | --- | --- |
| `space_member_limit` | 2 | 공간 정원 |
| `invite_ttl_hours` | 24 | 초대 만료 |
| `asset_ttl_hours` | 24 | 미첨부 파일 정리 기준 |
| `memory_photo_limit` | 10 | 추억당 사진 수 |
| `upload_max_bytes` | 10485760 | 파일 크기 상한 |
| `upload_max_pixels` | 40000000 | 디코딩 픽셀 상한 |
| `allowed_map_hosts` | 네이버·카카오 지도 호스트 | 지도 링크 허용 호스트 |
| `storage_bucket` | `"space-assets"` | `prepare_upload`가 알려주는 비공개 버킷 |

변경 예:

```sql
update app_private.app_config set value = '48'::jsonb, updated_at = now() where key = 'invite_ttl_hours';
```

## 5. 파일 정리 작업

DB와 Storage 삭제는 한 트랜잭션이 아니다. DB에서 먼저 참조를 끊고 `deleting`으로 표시한 뒤
Storage 삭제를 재시도 가능한 작업으로 실행한다(DESIGN 8.3).

```sql
-- 1) 만료된 미첨부 파일을 정리 대상으로 전환하고 경로를 받는다(service_role 또는 postgres).
select id, object_path from app_private.expire_stale_assets(500);

-- 2) 앱/스크립트가 Storage에서 해당 경로를 지운다. 이미 없으면 성공으로 본다.

-- 3) 삭제가 끝난 것만 메타데이터를 지운다.
select app_private.purge_deleted_assets(array['<asset-id>', ...]::uuid[]);
```

변경 RPC(`save_memory`, `delete_memory`, `save_customization`, `discard_upload`)는 응답의
`detachedAssets`에 `{assetId, objectPath}`를 담아 준다. Server Action은 이 목록으로 Storage 정리를 이어서 수행한다.

Storage 객체 삭제는 **`service_role` 또는 DB 워커만** 할 수 있다(사용자에게는 DELETE 정책이 없다).
`ready` 전환도 마찬가지로 신뢰된 역할 전용이다. `docs/database/CONTRACTS.md`의 `finalize_upload` 항목을 본다.

Storage 정책도 되돌리기 절차를 권장 경로로 두지 않는다. 정책을 바꿔야 하면
새 전진 마이그레이션에서 `create or replace` 또는 이름이 명확한 `drop policy` + `create policy`로 처리한다.

## 6. 테스트

[../../supabase/tests/README.md](../../supabase/tests/README.md) 참고.
단일 세션 테스트 5개는 롤백되고, 동시성 테스트는 전용 러너가 픽스처를 만들고 지운다.
