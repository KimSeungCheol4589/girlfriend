import { isUuid } from '../live/ids';

/**
 * Storage 정리 대상 계산(순수 함수).
 *
 * 규칙(DESIGN.md 8.3, CONTRACTS.md 7-3)
 *   - 지울 경로는 **서버가 받은 DB 응답**(`detachedAssets`, `discard_upload`)에서만 온다.
 *     브라우저가 보낸 경로·ID를 정리 대상으로 삼지 않는다.
 *   - 경로는 `공간ID/assetID.확장자` 생성 규칙과 정확히 같아야 한다.
 *   - 삭제 직전 service 조회로 그 행이 여전히 `deleting`이고 같은 공간·같은 경로인지 다시 확인한다.
 */

export type DetachedAsset = { assetId: string; objectPath: string };

const EXTENSIONS = ['jpg', 'png', 'webp'] as const;

export function expectedObjectPath(spaceId: string, assetId: string, objectPath: string): boolean {
  if (!isUuid(spaceId) || !isUuid(assetId)) return false;
  return EXTENSIONS.some(
    (extension) => objectPath === `${spaceId.toLowerCase()}/${assetId.toLowerCase()}.${extension}`,
  );
}

/** RPC 응답의 `detachedAssets`(또는 단일 객체 목록)를 검증된 목록으로 바꾼다. 모양이 틀리면 버린다. */
export function parseDetachedAssets(raw: unknown, spaceId: string): DetachedAsset[] {
  if (!Array.isArray(raw)) return [];
  const result: DetachedAsset[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const { assetId, objectPath } = item as { assetId?: unknown; objectPath?: unknown };
    if (typeof assetId !== 'string' || typeof objectPath !== 'string') continue;
    if (!expectedObjectPath(spaceId, assetId, objectPath)) continue;
    const key = assetId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ assetId: key, objectPath });
  }
  return result;
}

export type AssetStateRow = { id: string; space_id: string; state: string; object_path: string };

/**
 * service 조회 결과와 대조해 실제로 지울 경로를 고른다.
 * - 행이 없으면 이미 메타데이터까지 정리된 것이다(지울 것 없음, 완료로 본다).
 * - 행이 `deleting`이 아니거나 공간·경로가 다르면 지우지 않는다(보류).
 */
export function selectCleanupTargets(
  requested: readonly DetachedAsset[],
  rows: readonly AssetStateRow[],
  spaceId: string,
): { paths: string[]; alreadyGone: number; skipped: number } {
  const byId = new Map(rows.map((row) => [row.id.toLowerCase(), row]));
  const paths: string[] = [];
  let alreadyGone = 0;
  let skipped = 0;

  for (const asset of requested) {
    const row = byId.get(asset.assetId);
    if (!row) {
      alreadyGone += 1;
      continue;
    }
    if (
      row.state !== 'deleting' ||
      row.space_id.toLowerCase() !== spaceId.toLowerCase() ||
      row.object_path !== asset.objectPath
    ) {
      skipped += 1;
      continue;
    }
    paths.push(asset.objectPath);
  }

  return { paths, alreadyGone, skipped };
}
