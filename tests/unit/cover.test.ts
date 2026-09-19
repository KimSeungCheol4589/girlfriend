import { describe, expect, it } from 'vitest';

import { createCoverPreview, isSameCover } from '@/features/customization/cover';
import {
  cloneCustomization,
  customizationSchema,
  isSameCustomization,
  validateCustomization,
} from '@/features/customization/schema';
import { MEMORY_LIMITS } from '@/lib/contracts';
import { checkImageCandidate, isLocalPreviewUrl } from '@/lib/images';
import type { DemoCustomization } from '@/lib/demo/types';

const BLOB_URL = 'blob:http://localhost:3001/0f0c2b9e-1111-4c1a-9f0a-2b3c4d5e6f70';
const OTHER_BLOB_URL = 'blob:http://localhost:3001/aaaaaaaa-2222-4c1a-9f0a-2b3c4d5e6f70';

function jpeg(name = 'cover.jpg', size = 1024) {
  return { name, size, type: 'image/jpeg' };
}

function customization(overrides: Partial<DemoCustomization> = {}): DemoCustomization {
  return {
    themeKey: 'cream',
    accentColor: '#8B435A',
    coverAssetId: null,
    sections: [
      { key: 'pinned', visible: true },
      { key: 'recentMemories', visible: true },
      { key: 'wishlist', visible: true },
    ],
    ...overrides,
  };
}

describe('createCoverPreview', () => {
  it('허용 형식·용량이면 미리보기를 만든다', () => {
    const result = createCoverPreview(jpeg(), BLOB_URL, 'cover-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.objectUrl).toBe(BLOB_URL);
      expect(result.preview.fileName).toBe('cover.jpg');
      expect(result.preview.alt).toContain('cover.jpg');
    }
  });

  it('PNG·WebP도 받는다', () => {
    expect(createCoverPreview({ name: 'a.png', size: 10, type: 'image/png' }, BLOB_URL, 'c').ok).toBe(
      true,
    );
    expect(
      createCoverPreview({ name: 'a.webp', size: 10, type: 'image/webp' }, BLOB_URL, 'c').ok,
    ).toBe(true);
  });

  it('HEIC는 추억 사진과 같은 안내로 거부한다', () => {
    const result = createCoverPreview(
      { name: 'a.heic', size: 10, type: 'image/heic' },
      BLOB_URL,
      'c',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('HEIC');
  });

  it('지원하지 않는 형식을 거부한다', () => {
    const result = createCoverPreview({ name: 'a.gif', size: 10, type: 'image/gif' }, BLOB_URL, 'c');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('JPEG');
  });

  it('10MiB 경계를 추억 사진과 같게 지킨다', () => {
    expect(createCoverPreview(jpeg('a.jpg', MEMORY_LIMITS.photoBytesMax), BLOB_URL, 'c').ok).toBe(
      true,
    );

    const over = createCoverPreview(jpeg('a.jpg', MEMORY_LIMITS.photoBytesMax + 1), BLOB_URL, 'c');
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toContain('10MB');
  });

  it('브라우저 미리보기 주소가 아니면 거부한다', () => {
    const result = createCoverPreview(jpeg(), 'https://example.com/cover.jpg', 'c');
    expect(result.ok).toBe(false);
  });

  it('추억 사진과 같은 검사 함수를 쓴다', () => {
    expect(checkImageCandidate(jpeg())).toBeNull();
    expect(checkImageCandidate({ name: 'a.heic', size: 10, type: 'image/heic' })).not.toBeNull();
  });
});

describe('isLocalPreviewUrl', () => {
  it('blob: 주소만 임시 미리보기로 본다', () => {
    expect(isLocalPreviewUrl(BLOB_URL)).toBe(true);
    expect(isLocalPreviewUrl('/artwork/memory-01.svg')).toBe(false);
    expect(isLocalPreviewUrl('https://example.com/a.jpg')).toBe(false);
  });
});

describe('isSameCover', () => {
  const preview = { id: 'a', objectUrl: BLOB_URL, fileName: 'a.jpg', alt: 'a' };

  it('둘 다 없으면 같다', () => {
    expect(isSameCover(null, null)).toBe(true);
  });

  it('한쪽만 있으면 다르다 (취소 확인에 쓰인다)', () => {
    expect(isSameCover(preview, null)).toBe(false);
    expect(isSameCover(null, preview)).toBe(false);
  });

  it('같은 주소면 같고 다른 주소면 다르다', () => {
    expect(isSameCover(preview, { ...preview, id: 'b' })).toBe(true);
    expect(isSameCover(preview, { ...preview, objectUrl: OTHER_BLOB_URL })).toBe(false);
  });
});

describe('커버 미리보기와 저장 계약의 분리', () => {
  it('데모 기본 설정의 coverAssetId는 null이다', () => {
    expect(validateCustomization(customization()).ok).toBe(true);
    expect(customization().coverAssetId).toBeNull();
  });

  it('커버를 골라도 꾸미기 계약은 바뀌지 않는다', () => {
    const before = customization();
    const cover = createCoverPreview(jpeg(), BLOB_URL, 'cover-1');
    expect(cover.ok).toBe(true);

    // 미리보기는 계약 바깥의 값이므로 설정 객체는 그대로다.
    const after = cloneCustomization(before);
    expect(isSameCustomization(before, after)).toBe(true);
    expect(after.coverAssetId).toBeNull();
  });

  it('coverAssetId에 브라우저 미리보기 주소를 넣을 수 없다', () => {
    const result = validateCustomization(customization({ coverAssetId: BLOB_URL }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('asset ID');
  });

  it('coverAssetId는 UUID이거나 null이어야 한다', () => {
    expect(
      validateCustomization(customization({ coverAssetId: '0f0c2b9e-1111-4c1a-9f0a-2b3c4d5e6f70' }))
        .ok,
    ).toBe(true);
    expect(validateCustomization(customization({ coverAssetId: 'cover.jpg' })).ok).toBe(false);
  });

  it('검증을 통과한 설정에는 미리보기 관련 필드가 남지 않는다', () => {
    const parsed = customizationSchema.parse(customization());
    expect(Object.keys(parsed).sort()).toEqual([
      'accentColor',
      'coverAssetId',
      'sections',
      'themeKey',
    ]);
  });

  it('coverAssetId가 다르면 미저장 변경으로 본다', () => {
    expect(
      isSameCustomization(
        customization({ coverAssetId: '0f0c2b9e-1111-4c1a-9f0a-2b3c4d5e6f70' }),
        customization(),
      ),
    ).toBe(false);
  });
});
