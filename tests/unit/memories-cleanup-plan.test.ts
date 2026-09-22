import { describe, expect, it } from 'vitest';

import {
  expectedObjectPath,
  parseDetachedAssets,
  selectCleanupTargets,
} from '@/features/memories/server/cleanup-plan';

const SPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_SPACE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ASSET_1 = '11111111-1111-4111-8111-111111111111';
const ASSET_2 = '22222222-2222-4222-8222-222222222222';

describe('expectedObjectPath — 생성 열 규칙과 정확히 같은 경로만', () => {
  it('공간/asset.확장자', () => {
    expect(expectedObjectPath(SPACE, ASSET_1, `${SPACE}/${ASSET_1}.webp`)).toBe(true);
    expect(expectedObjectPath(SPACE, ASSET_1, `${SPACE}/${ASSET_1}.jpg`)).toBe(true);
    expect(expectedObjectPath(SPACE, ASSET_1, `${SPACE}/${ASSET_1}.png`)).toBe(true);
  });

  it('다른 공간·다른 asset·경로 조작·다른 확장자는 거부', () => {
    expect(expectedObjectPath(SPACE, ASSET_1, `${OTHER_SPACE}/${ASSET_1}.webp`)).toBe(false);
    expect(expectedObjectPath(SPACE, ASSET_1, `${SPACE}/${ASSET_2}.webp`)).toBe(false);
    expect(expectedObjectPath(SPACE, ASSET_1, `${SPACE}/../${OTHER_SPACE}/${ASSET_1}.webp`)).toBe(false);
    expect(expectedObjectPath(SPACE, ASSET_1, `${SPACE}/${ASSET_1}.bin`)).toBe(false);
    expect(expectedObjectPath(SPACE, ASSET_1, `${SPACE}/`)).toBe(false);
    expect(expectedObjectPath(SPACE, 'x', `${SPACE}/x.webp`)).toBe(false);
  });
});

describe('parseDetachedAssets', () => {
  it('RPC 응답에서 규칙에 맞는 항목만 남기고 중복을 없앤다', () => {
    const parsed = parseDetachedAssets(
      [
        { assetId: ASSET_1, objectPath: `${SPACE}/${ASSET_1}.webp` },
        { assetId: ASSET_1, objectPath: `${SPACE}/${ASSET_1}.webp` },
        { assetId: ASSET_2, objectPath: `${OTHER_SPACE}/${ASSET_2}.webp` },
        { assetId: ASSET_2 },
        null,
        'x',
      ],
      SPACE,
    );
    expect(parsed).toEqual([{ assetId: ASSET_1, objectPath: `${SPACE}/${ASSET_1}.webp` }]);
  });

  it('배열이 아니면 빈 목록', () => {
    expect(parseDetachedAssets(null, SPACE)).toEqual([]);
    expect(parseDetachedAssets({ assetId: ASSET_1 }, SPACE)).toEqual([]);
  });
});

describe('selectCleanupTargets — 삭제 직전 service 조회와 대조', () => {
  const requested = [
    { assetId: ASSET_1, objectPath: `${SPACE}/${ASSET_1}.webp` },
    { assetId: ASSET_2, objectPath: `${SPACE}/${ASSET_2}.jpg` },
  ];

  it('deleting이면서 같은 공간·같은 경로인 것만 지운다', () => {
    const plan = selectCleanupTargets(
      requested,
      [
        { id: ASSET_1, space_id: SPACE, state: 'deleting', object_path: `${SPACE}/${ASSET_1}.webp` },
        { id: ASSET_2, space_id: SPACE, state: 'deleting', object_path: `${SPACE}/${ASSET_2}.jpg` },
      ],
      SPACE,
    );
    expect(plan).toEqual({
      paths: [`${SPACE}/${ASSET_1}.webp`, `${SPACE}/${ASSET_2}.jpg`],
      alreadyGone: 0,
      skipped: 0,
    });
  });

  it('ready로 되돌아갔거나 다른 공간이면 지우지 않고 보류한다', () => {
    const plan = selectCleanupTargets(
      requested,
      [
        { id: ASSET_1, space_id: SPACE, state: 'ready', object_path: `${SPACE}/${ASSET_1}.webp` },
        { id: ASSET_2, space_id: OTHER_SPACE, state: 'deleting', object_path: `${SPACE}/${ASSET_2}.jpg` },
      ],
      SPACE,
    );
    expect(plan.paths).toEqual([]);
    expect(plan.skipped).toBe(2);
  });

  it('행이 이미 없으면 지울 것이 없다(완료)', () => {
    const plan = selectCleanupTargets(requested, [], SPACE);
    expect(plan).toEqual({ paths: [], alreadyGone: 2, skipped: 0 });
  });
});
