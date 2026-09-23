import { describe, expect, it } from 'vitest';

import { appendPinCandidates, applyPinSaved, mergePinCandidates, toPinCandidate } from '@/features/customize/pin';
import type { LiveMemory } from '@/features/memories/live/types';

/**
 * 고정 후보 목록.
 *
 * - 고정 저장은 **서버가 렌더한 스냅샷 그대로**를 보낸다. 스냅샷이 빠지면 사진·본문이 떨어져 나간다.
 * - 이미 고정한 기록이 첫 20개 밖에 있어도 목록에서 사라지면 안 된다(해제할 방법이 없어진다).
 */

function memory(overrides: Partial<LiveMemory> = {}): LiveMemory {
  return {
    id: 'm1',
    title: '한강 산책',
    body: '해질 무렵',
    memoryDate: '2026-05-05',
    location: '여의도',
    tags: ['산책', '봄'],
    isPinned: false,
    version: 3,
    authorId: 'u1',
    updatedAt: '2026-05-05T10:00:00Z',
    photos: [
      { assetId: 'p2', sortOrder: 1 },
      { assetId: 'p1', sortOrder: 0 },
    ],
    ...overrides,
  };
}

describe('toPinCandidate', () => {
  it('고정 저장에 필요한 스냅샷을 그대로 들고 온다', () => {
    const candidate = toPinCandidate(memory());
    expect(candidate.snapshot).toEqual({
      title: '한강 산책',
      body: '해질 무렵',
      memoryDate: '2026-05-05',
      location: '여의도',
      tags: ['산책', '봄'],
      // 화면이 받은 순서 그대로 보낸다(서버가 다시 읽지 않는다).
      photoAssetIds: ['p2', 'p1'],
      expectedVersion: 3,
    });
  });

  it('장소가 없으면 빈 문자열로 보낸다(입력 검증과 같은 모양)', () => {
    expect(toPinCandidate(memory({ location: null })).snapshot.location).toBe('');
  });

  it('스냅샷의 태그는 원본 배열을 공유하지 않는다', () => {
    const source = memory();
    const candidate = toPinCandidate(source);
    candidate.snapshot.tags.push('추가');
    expect(source.tags).toEqual(['산책', '봄']);
  });
});

describe('mergePinCandidates', () => {
  it('고정한 기록을 앞에 두고 중복을 없앤다', () => {
    const pinned = [toPinCandidate(memory({ id: 'old', isPinned: true, memoryDate: '2020-01-01' }))];
    const recent = [
      toPinCandidate(memory({ id: 'new1' })),
      toPinCandidate(memory({ id: 'old', isPinned: true, memoryDate: '2020-01-01' })),
      toPinCandidate(memory({ id: 'new2' })),
    ];
    expect(mergePinCandidates(pinned, recent).map((item) => item.id)).toEqual(['old', 'new1', 'new2']);
  });

  it('더 보기 결과에서 이미 있는 기록은 다시 붙이지 않는다', () => {
    const current = [toPinCandidate(memory({ id: 'a' })), toPinCandidate(memory({ id: 'b' }))];
    const added = [toPinCandidate(memory({ id: 'b' })), toPinCandidate(memory({ id: 'c' }))];
    expect(appendPinCandidates(current, added).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('applyPinSaved', () => {
  const list = [toPinCandidate(memory({ id: 'a' })), toPinCandidate(memory({ id: 'b', version: 7 }))];

  it('저장한 기록만 새 상태·새 버전으로 바꾼다', () => {
    const next = applyPinSaved(list, 'b', true, 8);
    expect(next.map((item) => [item.id, item.isPinned, item.snapshot.expectedVersion])).toEqual([
      ['a', false, 3],
      ['b', true, 8],
    ]);
  });

  it('다음 저장이 옛 버전을 보내지 않도록 버전을 반드시 올린다', () => {
    const once = applyPinSaved(list, 'a', true, 4);
    const twice = applyPinSaved(once, 'a', false, 5);
    expect(twice[0]?.snapshot.expectedVersion).toBe(5);
    expect(twice[0]?.isPinned).toBe(false);
  });

  it('목록에 없는 기록 ID는 아무것도 바꾸지 않는다', () => {
    expect(applyPinSaved(list, 'zzz', true, 99)).toEqual(list);
  });
});
