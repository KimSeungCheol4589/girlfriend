# DB-001 데이터베이스 기반 — 개요와 적용 절차

작성일: 2026-09-19 · 작업: DB-001 · 브랜치: `feat/db-foundation`

이 문서는 `supabase/migrations/`의 스키마·권한·RPC를 적용하고 검증하는 방법을 정리한다.
계약 상세는 [CONTRACTS.md](./CONTRACTS.md), 권한 모델과 한계는 [SECURITY.md](./SECURITY.md)를 본다.

> 이 문서를 쓴 구현 세션은 SQL을 **실행하지 않았다**. 아래 명령은 총괄(Codex)이 로컬 테스트 DB에서 실행할 절차이며,
> 실행 결과는 `docs/handoffs/DB-001.md`에 기록한다.

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

외부 확장은 쓰지 않는다. 토큰 해시는 `pg_catalog.sha256()`, 난수는 `gen_random_uuid()`를 사용한다.

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
         20260919121100_rpc_grants.sql; do
  echo "== $f"
  docker exec -i "$C" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
    -f "/tmp/db-001-migrations/$f" || { echo "FAILED: $f"; break; }
done
```

11번 파일 끝의 `DO` 블록이 권한·RLS·search_path를 다시 점검한다. 위반이 있으면 그 자리에서 실패한다.

적용 후 확인:

```sh
docker exec -i "$C" psql -U postgres -d postgres -Atc \
  "select relname, relrowsecurity from pg_class c
     join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by 1;"
```

### 되돌리기

MVP 이전 단계이므로 down 마이그레이션은 만들지 않았다. 되돌려야 하면 아래를 쓴다.
**데이터가 모두 사라지므로 로컬 테스트 DB에서만 사용한다.**

```sql
drop schema app cascade;
drop schema app_private cascade;
drop table if exists public.restaurant_reviews, public.restaurants, public.memory_photos,
  public.memories, public.space_settings, public.space_invites, public.assets,
  public.space_members, public.spaces, public.profiles, public.mutation_requests cascade;
```

컨테이너·볼륨을 지우거나 `supabase reset`을 실행하지 않는다.

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

## 6. 테스트

[../../supabase/tests/README.md](../../supabase/tests/README.md) 참고.
단일 세션 테스트 5개는 롤백되고, 동시성 테스트는 전용 러너가 픽스처를 만들고 지운다.
