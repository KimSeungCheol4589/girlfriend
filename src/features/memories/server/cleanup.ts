import 'server-only';

import { MEMORY_BUCKET } from '../live/constants';
import type { PhotoCleanupStatus } from '../live/types';

import { selectCleanupTargets, type AssetStateRow, type DetachedAsset } from './cleanup-plan';
import { createServiceClient } from './service-client';

/**
 * DB가 `deleting`으로 바꾼 파일의 Storage 객체를 지운다(DESIGN.md 8.3).
 *
 * - DB 변경(기록 삭제·사진 분리·업로드 취소)은 이미 커밋됐다. 여기서 실패해도 되돌리지 않는다.
 *   파일은 `deleting` 상태로 남아 다시 정리할 수 있다(docs/memories/CLEANUP.md).
 * - 대상은 호출자가 넘긴 **이번 요청의 DB 응답**뿐이다. 공간 전체·전역 정리를 하지 않는다.
 * - 객체가 이미 없으면 Storage가 성공으로 답한다(멱등).
 * - 메타데이터 행 삭제(`app_private.purge_deleted_assets`)는 REST로 노출돼 있지 않아 하지 않는다.
 *   행은 `deleting`으로 남고 사용자·상대 누구에게도 열리지 않는다(Storage/RLS 정책).
 */
export async function removeDeletingObjects(
  assets: readonly DetachedAsset[],
  spaceId: string,
  operation: string,
): Promise<PhotoCleanupStatus> {
  if (assets.length === 0) return 'none';

  const service = createServiceClient();
  if (!service) {
    console.error(`memories.cleanup op=${operation} status=pending reason=service_unconfigured count=${assets.length}`);
    return 'pending';
  }

  const { data, error } = await service
    .from('assets')
    .select('id, space_id, state, object_path')
    .in(
      'id',
      assets.map((asset) => asset.assetId),
    );
  if (error) {
    console.error(`memories.cleanup op=${operation} status=pending reason=lookup_failed`);
    return 'pending';
  }

  const plan = selectCleanupTargets(assets, (data ?? []) as AssetStateRow[], spaceId);
  if (plan.paths.length > 0) {
    const { error: removeError } = await service.storage.from(MEMORY_BUCKET).remove(plan.paths);
    if (removeError) {
      console.error(`memories.cleanup op=${operation} status=pending reason=remove_failed count=${plan.paths.length}`);
      return 'pending';
    }
  }

  if (plan.skipped > 0) {
    console.error(`memories.cleanup op=${operation} status=pending reason=state_mismatch count=${plan.skipped}`);
    return 'pending';
  }
  return 'done';
}
