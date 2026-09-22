import { describe, expect, it } from 'vitest';

import {
  deleteMemoryInputSchema,
  pinMemoryInputSchema,
  preparePhotoInputSchema,
  saveMemoryInputSchema,
  toMemoryFieldErrors,
} from '@/features/memories/live/input-schema';
import { todayInSeoul } from '@/lib/dates';

const REQUEST = '33333333-3333-4333-8333-333333333333';
const ASSET_1 = '11111111-1111-4111-8111-111111111111';

function input(overrides: Record<string, unknown> = {}) {
  return {
    memoryId: null,
    title: '한강 노을 산책',
    body: '',
    memoryDate: '2026-09-01',
    location: '',
    tags: ['산책'],
    photoAssetIds: [ASSET_1],
    isPinned: false,
    expectedVersion: 0,
    requestId: REQUEST,
    ...overrides,
  };
}

function tomorrowInSeoul(): string {
  const [year, month, day] = todayInSeoul().split('-').map(Number);
  const next = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, (day ?? 1) + 1));
  return next.toISOString().slice(0, 10);
}

describe('saveMemoryInputSchema', () => {
  it('정상 입력', () => {
    const parsed = saveMemoryInputSchema.safeParse(input({ title: '  공백 정리  ' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.title).toBe('공백 정리');
  });

  it('오늘(한국 날짜)은 허용, 내일은 거부', () => {
    expect(saveMemoryInputSchema.safeParse(input({ memoryDate: todayInSeoul() })).success).toBe(true);
    const future = saveMemoryInputSchema.safeParse(input({ memoryDate: tomorrowInSeoul() }));
    expect(future.success).toBe(false);
    if (!future.success) expect(toMemoryFieldErrors(future.error).memoryDate).toBeDefined();
  });

  it('제목·본문·장소·태그 제한', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ title: '   ' }, 'title'],
      [{ title: '가'.repeat(81) }, 'title'],
      [{ body: '가'.repeat(10_001) }, 'body'],
      [{ location: '가'.repeat(101) }, 'location'],
      [{ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'tags'],
      [{ tags: ['가'.repeat(21)] }, 'tags'],
      [{ tags: ['산책', '산책'] }, 'tags'],
    ];
    for (const [overrides, field] of cases) {
      const parsed = saveMemoryInputSchema.safeParse(input(overrides));
      expect(parsed.success, field).toBe(false);
      if (!parsed.success) expect(Object.keys(toMemoryFieldErrors(parsed.error))).toContain(field);
    }
  });

  it('사진은 UUID, 10장 이하, 중복 불가(대소문자 무시)', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`);
    expect(saveMemoryInputSchema.safeParse(input({ photoAssetIds: eleven })).success).toBe(false);
    expect(
      saveMemoryInputSchema.safeParse(input({ photoAssetIds: [ASSET_1, ASSET_1.toUpperCase()] })).success,
    ).toBe(false);
    expect(saveMemoryInputSchema.safeParse(input({ photoAssetIds: ['../x'] })).success).toBe(false);
  });

  it('requestId·memoryId는 UUID여야 한다', () => {
    expect(saveMemoryInputSchema.safeParse(input({ requestId: 'x' })).success).toBe(false);
    expect(saveMemoryInputSchema.safeParse(input({ memoryId: 'not-a-uuid' })).success).toBe(false);
  });

  it('폼에 없는 경로(requestId)는 필드 오류로 옮기지 않는다', () => {
    const parsed = saveMemoryInputSchema.safeParse(input({ requestId: 'x' }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(toMemoryFieldErrors(parsed.error)).toEqual({});
  });
});

describe('삭제·고정·사진 준비 입력', () => {
  it('삭제·고정은 기존 버전(1 이상)이 필요하다', () => {
    const memoryId = ASSET_1;
    expect(deleteMemoryInputSchema.safeParse({ memoryId, expectedVersion: 0, requestId: REQUEST }).success).toBe(false);
    expect(deleteMemoryInputSchema.safeParse({ memoryId, expectedVersion: 3, requestId: REQUEST }).success).toBe(true);
  });

  it('고정은 기록 스냅샷 전체가 필요하고 새 기록(ID 없음·버전 0)은 받지 않는다', () => {
    const snapshot = input({ memoryId: ASSET_1, expectedVersion: 2, isPinned: true });
    expect(pinMemoryInputSchema.safeParse(snapshot).success).toBe(true);
    expect(pinMemoryInputSchema.safeParse({ ...snapshot, memoryId: null }).success).toBe(false);
    expect(pinMemoryInputSchema.safeParse({ ...snapshot, expectedVersion: 0 }).success).toBe(false);
    expect(
      pinMemoryInputSchema.safeParse({ memoryId: ASSET_1, isPinned: true, expectedVersion: 1, requestId: REQUEST }).success,
    ).toBe(false);
  });

  it('사진 준비는 JPEG·PNG·WebP, 10MiB 이하만', () => {
    expect(preparePhotoInputSchema.safeParse({ mimeType: 'image/webp', bytes: 1, requestId: REQUEST }).success).toBe(true);
    expect(preparePhotoInputSchema.safeParse({ mimeType: 'image/heic', bytes: 1, requestId: REQUEST }).success).toBe(false);
    expect(
      preparePhotoInputSchema.safeParse({ mimeType: 'image/jpeg', bytes: 10 * 1024 * 1024 + 1, requestId: REQUEST })
        .success,
    ).toBe(false);
    expect(preparePhotoInputSchema.safeParse({ mimeType: 'image/png', bytes: 0, requestId: REQUEST }).success).toBe(false);
  });
});
