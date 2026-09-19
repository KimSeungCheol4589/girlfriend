import { describe, expect, it } from 'vitest';

import {
  normalizeTags,
  validateMemoryDraft,
  validatePhotoSelection,
} from '@/features/memories/schema';
import { MEMORY_LIMITS } from '@/lib/contracts';

function draft(overrides: Record<string, unknown> = {}) {
  return {
    title: '한강 노을 산책',
    body: '오래 걸었다.',
    memoryDate: '2026-09-19',
    location: '서울',
    tags: ['산책'],
    photoCount: 1,
    ...overrides,
  };
}

describe('validateMemoryDraft', () => {
  it('정상 입력을 통과시키고 공백을 정리한다', () => {
    const result = validateMemoryDraft(draft({ title: '  한강 산책  ', location: ' 서울 ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe('한강 산책');
      expect(result.data.location).toBe('서울');
    }
  });

  it('제목이 비면 거부한다 (공백만 있는 경우 포함)', () => {
    const empty = validateMemoryDraft(draft({ title: '' }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.fieldErrors.title).toBe('제목을 입력해 주세요.');

    const spaces = validateMemoryDraft(draft({ title: '   ' }));
    expect(spaces.ok).toBe(false);
  });

  it('제목 80자 경계를 지킨다', () => {
    expect(validateMemoryDraft(draft({ title: '가'.repeat(MEMORY_LIMITS.titleMax) })).ok).toBe(true);
    expect(validateMemoryDraft(draft({ title: '가'.repeat(MEMORY_LIMITS.titleMax + 1) })).ok).toBe(
      false,
    );
  });

  it('본문 10,000자 경계를 지킨다', () => {
    expect(validateMemoryDraft(draft({ body: '가'.repeat(MEMORY_LIMITS.bodyMax) })).ok).toBe(true);
    expect(validateMemoryDraft(draft({ body: '가'.repeat(MEMORY_LIMITS.bodyMax + 1) })).ok).toBe(
      false,
    );
  });

  it('본문과 장소, 태그가 비어 있어도 저장할 수 있다', () => {
    expect(validateMemoryDraft(draft({ body: '', location: '', tags: [], photoCount: 0 })).ok).toBe(
      true,
    );
  });

  it('없는 날짜를 거부한다', () => {
    const result = validateMemoryDraft(draft({ memoryDate: '2026-02-30' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.memoryDate).toContain('YYYY-MM-DD');
  });

  it('날짜를 비우면 별도 안내를 낸다', () => {
    const result = validateMemoryDraft(draft({ memoryDate: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.memoryDate).toBe('날짜를 선택해 주세요.');
  });

  it('태그는 최대 5개, 하나당 20자다', () => {
    expect(validateMemoryDraft(draft({ tags: ['1', '2', '3', '4', '5'] })).ok).toBe(true);
    expect(validateMemoryDraft(draft({ tags: ['1', '2', '3', '4', '5', '6'] })).ok).toBe(false);
    expect(validateMemoryDraft(draft({ tags: ['가'.repeat(20)] })).ok).toBe(true);
    expect(validateMemoryDraft(draft({ tags: ['가'.repeat(21)] })).ok).toBe(false);
  });

  it('사진 장수는 0~10이다', () => {
    expect(validateMemoryDraft(draft({ photoCount: 0 })).ok).toBe(true);
    expect(validateMemoryDraft(draft({ photoCount: MEMORY_LIMITS.photoCountMax })).ok).toBe(true);
    expect(validateMemoryDraft(draft({ photoCount: MEMORY_LIMITS.photoCountMax + 1 })).ok).toBe(
      false,
    );
  });

  it('오류 순서는 화면에 보이는 필드 순서를 따른다', () => {
    const result = validateMemoryDraft(
      draft({ title: '', memoryDate: '', body: '가'.repeat(MEMORY_LIMITS.bodyMax + 1) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.order).toEqual(['title', 'memoryDate', 'body']);
  });
});

describe('normalizeTags', () => {
  it('쉼표와 줄바꿈으로 나누고 공백을 정리한다', () => {
    expect(normalizeTags(' 산책 , 노을 \n 카페 ')).toEqual(['산책', '노을', '카페']);
  });

  it('앞의 # 을 떼어낸다', () => {
    expect(normalizeTags('#산책, ##노을')).toEqual(['산책', '노을']);
  });

  it('빈 값을 버린다', () => {
    expect(normalizeTags(',, ,')).toEqual([]);
    expect(normalizeTags('')).toEqual([]);
    expect(normalizeTags('산책,,노을')).toEqual(['산책', '노을']);
  });

  it('대소문자를 구분하지 않고 중복을 없애며 처음 표기를 남긴다', () => {
    expect(normalizeTags('Cafe, cafe, CAFE')).toEqual(['Cafe']);
    expect(normalizeTags('산책, 산책')).toEqual(['산책']);
  });
});

describe('validatePhotoSelection', () => {
  const jpeg = (name: string, size = 1024) => ({ name, size, type: 'image/jpeg' });

  it('허용 형식·용량을 통과시킨다', () => {
    const result = validatePhotoSelection(0, [jpeg('a.jpg'), { name: 'b.png', size: 2048, type: 'image/png' }]);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it('HEIC는 전용 안내와 함께 거부한다', () => {
    const result = validatePhotoSelection(0, [{ name: 'a.heic', size: 1024, type: 'image/heic' }]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('HEIC');
  });

  it('지원하지 않는 형식을 거부한다', () => {
    const result = validatePhotoSelection(0, [{ name: 'a.gif', size: 1024, type: 'image/gif' }]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('JPEG');
  });

  it('10MiB 경계를 지킨다', () => {
    const exact = validatePhotoSelection(0, [jpeg('a.jpg', MEMORY_LIMITS.photoBytesMax)]);
    expect(exact.accepted).toHaveLength(1);

    const over = validatePhotoSelection(0, [jpeg('a.jpg', MEMORY_LIMITS.photoBytesMax + 1)]);
    expect(over.accepted).toHaveLength(0);
    expect(over.rejected[0]?.reason).toContain('10MB');
  });

  it('이미 있는 사진을 포함해 10장을 넘기지 않는다', () => {
    const result = validatePhotoSelection(9, [jpeg('a.jpg'), jpeg('b.jpg')]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('10장');
  });

  it('이미 10장이면 아무것도 받지 않는다', () => {
    const result = validatePhotoSelection(MEMORY_LIMITS.photoCountMax, [jpeg('a.jpg')]);
    expect(result.accepted).toHaveLength(0);
  });

  it('MIME 대문자 표기도 인식한다', () => {
    const result = validatePhotoSelection(0, [{ name: 'a.jpg', size: 10, type: 'IMAGE/JPEG' }]);
    expect(result.accepted).toHaveLength(1);
  });
});
