# 추억 사진 파일 정리 계약 (MEM-001)

작성일: 2026-09-21 · 기준: DESIGN.md 8.3, CONTRACTS.md 7-3, SECURITY.md 7-3

**결정(총괄, 2026-09-21)**: 새 SQL·공개 RPC 래퍼를 만들지 않는다. 앱은 요청 단위로 객체만 정리하고,
메타데이터 삭제·만료 전환은 기존 `app_private` 함수를 쓰는 **운영자 수동 절차**로 한다.

## 1. 앱이 자동으로 하는 일 (요청 단위, 대상 한정)

DB 변경(기록 삭제·사진 분리·업로드 취소·확정 거부)이 **커밋된 뒤** 같은 요청 안에서 한 번 정리한다.

| 입력 | 출처 |
| --- | --- |
| 지울 경로 | `save_memory`/`delete_memory`의 `detachedAssets`, `discard_upload` 응답. **브라우저 입력이 아니다** |
| 확인 | 경로가 `요청자공간ID/assetID.(jpg\|png\|webp)`와 정확히 같은지, service 조회로 그 행이 `deleting`·같은 공간·같은 경로인지 |
| 삭제 | service Storage `remove(paths)`. 객체가 이미 없으면 성공(멱등) |

- 실패(자격 증명 없음·조회 실패·삭제 실패·상태 불일치)는 **DB 변경을 되돌리지 않는다.** 화면에는 저장·삭제
  성공과 함께 "파일 정리는 나중에 다시" 문구가 뜬다. 행은 `deleting`으로 남아 누구에게도 열리지 않는다
  (Storage SELECT 정책·사진 경로 모두 `deleting` 제외).
- 공간 전체·전역 정리는 사용자 요청에서 하지 않는다.
- 로그: `memories.cleanup op=… status=pending reason=… count=…` (경로·ID 없음).

### 저장하지 않고 떠난 사진

- 앱 안에서 떠날 때(메뉴 이동·뒤로 가기·취소): 폼이 내려가면서 자기 미첨부 asset에 `discard_upload`를 보내고
  위 규칙으로 정리한다(최선 노력, 진행 중인 업로드는 그 단계가 끝난 뒤 취소).
- 탭 닫기·새로고침·로그아웃·네트워크 단절: 요청이 끝난다는 보장이 없다. 그 asset은 `pending/ready`로 남고
  업로더 외에는 보이지 않으며, 24시간 뒤 아래 3절 만료 절차의 대상이 된다. 앱은 이 경우의 정리 완료를 약속하지 않는다.

## 2. 앱이 하지 않는 일

- 메타데이터 행 삭제(`app_private.purge_deleted_assets`)와 만료 전환(`app_private.expire_stale_assets`)은
  REST로 노출돼 있지 않다(의도된 설계). 앱은 이 둘을 부르지 않고, 행은 `deleting`으로 남는다.

## 3. 운영자 수동 절차 (`postgres` 또는 service 권한)

### 3.1 특정 공간·특정 asset의 `deleting` 정리 (대상 한정)

```sql
-- 1) 정리가 남은 대상 확인 (이 조회는 공간으로 한정된다)
select a.id, a.object_path
  from public.assets a
 where a.state = 'deleting'
   and a.space_id = '<공간 ID>'
   and not exists (select 1 from public.memory_photos p where p.asset_id = a.id)
   and not exists (select 1 from public.space_settings s where s.cover_asset_id = a.id);
```

2) 위 `object_path`만 Storage API로 지운다(service 키, 버킷 `space-assets`).
   `DELETE /storage/v1/object/space-assets` 본문 `{"prefixes": ["<object_path>", …]}`.
   다른 경로·와일드카드·버킷 전체 삭제를 쓰지 않는다. 이미 없는 객체는 성공으로 본다.

```sql
-- 3) 객체 삭제를 확인한 ID만 메타데이터 정리
select app_private.purge_deleted_assets(array['<asset ID>', …]::uuid[]);
```

`purge_deleted_assets`는 넘긴 ID 중 `deleting`이면서 첨부·커버 참조가 없는 행만 지운다.

### 3.2 만료 전환 — **전역 작업**

```sql
select id, space_id, purpose, object_path from app_private.expire_stale_assets(100);
```

- 이 함수는 **공간을 가리지 않는다.** 모든 공간의 만료된(`expires_at < now()`) 미첨부 `pending/ready` asset을
  최대 `limit`개까지 `deleting`으로 바꾼다. 추억 사진뿐 아니라 **커버(`purpose='cover'`) 후보 파일도 포함**된다.
  3.1의 공간 한정 조회와 달리 인자로 범위를 좁힐 수 없다. 공간 조건을 덧붙여도 함수가 바꾸는 범위는 줄지 않는다.
- 그래서 운영 DB에서만, 백업과 담당자 확인 뒤 실행한다. 공유 개발 DB·다른 작업의 테스트 DB에서 실행하지 않는다
  (이 작업의 테스트도 실행하지 않는다).
- 실행 결과로 나온 행은 3.1의 2)·3)과 같은 방법으로 객체·메타데이터를 정리한다.

앱 코드의 `removeDeletingObjects(assets, spaceId, op)`(`src/features/memories/server/cleanup.ts`)는 3.1의 2)를
같은 확인 규칙으로 수행하는 서버 함수다. 운영 스크립트(`scripts/`)는 이 작업의 소유 범위가 아니라 만들지 않았다.
자동 일일 실행은 배포 단계에서 정한다(DESIGN 13 "자동 파일 정리 실행 환경").
