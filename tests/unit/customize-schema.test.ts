import { describe, expect, it } from 'vitest';

import { createRequestKeyTracker } from '@/features/memories/live/request-key';
import {
  customizationSignatureValues,
  discardCoverInputSchema,
  finalizeCoverInputSchema,
  prepareCoverInputSchema,
  sameCustomization,
  saveCustomizationInputSchema,
  toDraft,
  type CustomizationDraft,
} from '@/features/customize/schema';
import { defaultHomeSections } from '@/features/customize/sections';
import type { SavedCustomization } from '@/features/customize/types';

/**
 * 저장 입력 검증(CONTRACTS.md 5 `save_customization`)과 멱등성 키 규칙(CONTRACTS.md 7-1).
 * 설정 스냅샷에는 고정한 추억 ID가 들어가지 않는다(고정은 별도 저장이다).
 */

const REQUEST_ID = '7f1a3f8c-9c1e-4c7f-9a3d-0d1b2c3d4e5f';
const ASSET_ID = 'b2c3d4e5-6f70-4182-93a4-b5c6d7e8f901';

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    themeKey: 'rose',
    accentColor: '#8B435A',
    coverAssetId: null,
    sections: defaultHomeSections(),
    expectedVersion: 3,
    requestId: REQUEST_ID,
    ...overrides,
  };
}

describe('saveCustomizationInputSchema', () => {
  it('정상 입력을 통과시키고 포인트 색상을 소문자로 맞춘다', () => {
    const parsed = saveCustomizationInputSchema.safeParse(validInput());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.accentColor).toBe('#8b435a');
  });

  it('저장 값에 고정한 추억 ID가 들어가지 않는다', () => {
    const parsed = saveCustomizationInputSchema.safeParse(validInput({ pinnedMemoryIds: [ASSET_ID] }));
    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.keys(parsed.data).sort()).toEqual([
      'accentColor',
      'coverAssetId',
      'expectedVersion',
      'requestId',
      'sections',
      'themeKey',
    ]);
  });

  it('테마 3종 밖의 값을 거부한다', () => {
    expect(saveCustomizationInputSchema.safeParse(validInput({ themeKey: 'midnight' })).success).toBe(false);
  });

  it('#RRGGBB가 아닌 색을 거부한다', () => {
    for (const accentColor of ['8b435a', '#8b435', '#8b435az', 'red', 'rgb(1,2,3)', '']) {
      expect(saveCustomizationInputSchema.safeParse(validInput({ accentColor })).success).toBe(false);
    }
  });

  it('섹션이 세 개가 아니거나 중복이면 거부한다', () => {
    const duplicated = [
      { key: 'pinned', visible: true },
      { key: 'pinned', visible: true },
      { key: 'wishlist', visible: true },
    ];
    expect(saveCustomizationInputSchema.safeParse(validInput({ sections: duplicated })).success).toBe(false);
    expect(
      saveCustomizationInputSchema.safeParse(validInput({ sections: [{ key: 'pinned', visible: true }] })).success,
    ).toBe(false);
  });

  it('커버는 asset ID(UUID)이거나 null이다. 브라우저 미리보기 주소는 받지 않는다', () => {
    expect(saveCustomizationInputSchema.safeParse(validInput({ coverAssetId: ASSET_ID })).success).toBe(true);
    expect(saveCustomizationInputSchema.safeParse(validInput({ coverAssetId: null })).success).toBe(true);
    expect(
      saveCustomizationInputSchema.safeParse(validInput({ coverAssetId: 'blob:http://localhost/abc' })).success,
    ).toBe(false);
  });

  it('버전은 0 이상 정수, requestId는 UUID여야 한다', () => {
    expect(saveCustomizationInputSchema.safeParse(validInput({ expectedVersion: -1 })).success).toBe(false);
    expect(saveCustomizationInputSchema.safeParse(validInput({ expectedVersion: 1.5 })).success).toBe(false);
    expect(saveCustomizationInputSchema.safeParse(validInput({ requestId: 'not-a-uuid' })).success).toBe(false);
  });
});

describe('커버 업로드 입력', () => {
  it('허용 형식과 크기만 준비한다', () => {
    expect(prepareCoverInputSchema.safeParse({ mimeType: 'image/webp', bytes: 1024, requestId: REQUEST_ID }).success).toBe(
      true,
    );
    expect(prepareCoverInputSchema.safeParse({ mimeType: 'image/heic', bytes: 1024, requestId: REQUEST_ID }).success).toBe(
      false,
    );
    expect(prepareCoverInputSchema.safeParse({ mimeType: 'image/png', bytes: 0, requestId: REQUEST_ID }).success).toBe(
      false,
    );
    expect(
      prepareCoverInputSchema.safeParse({
        mimeType: 'image/png',
        bytes: 10 * 1024 * 1024 + 1,
        requestId: REQUEST_ID,
      }).success,
    ).toBe(false);
  });

  it('확정·취소는 asset ID 형식을 확인한다', () => {
    expect(finalizeCoverInputSchema.safeParse({ assetId: ASSET_ID }).success).toBe(true);
    expect(finalizeCoverInputSchema.safeParse({ assetId: '../../etc/passwd' }).success).toBe(false);
    expect(discardCoverInputSchema.safeParse({ assetId: ASSET_ID, requestId: REQUEST_ID }).success).toBe(true);
    expect(discardCoverInputSchema.safeParse({ assetId: ASSET_ID }).success).toBe(false);
  });
});

describe('미저장 변경 판단', () => {
  const saved: SavedCustomization = {
    themeKey: 'cream',
    accentColor: '#8b435a',
    coverAssetId: null,
    sections: defaultHomeSections(),
    version: 2,
    coverUploadedByMe: false,
  };

  it('값이 같으면 변경이 아니다(대소문자 차이 포함)', () => {
    expect(sameCustomization(toDraft(saved), toDraft(saved))).toBe(true);
    expect(sameCustomization(toDraft(saved), { ...toDraft(saved), accentColor: '#8B435A' })).toBe(true);
  });

  it('테마·커버·섹션이 달라지면 변경이다', () => {
    const draft: CustomizationDraft = toDraft(saved);
    expect(sameCustomization(draft, { ...draft, themeKey: 'sage' })).toBe(false);
    expect(sameCustomization(draft, { ...draft, coverAssetId: ASSET_ID })).toBe(false);
    expect(
      sameCustomization(draft, {
        ...draft,
        sections: [
          { key: 'wishlist', visible: true },
          { key: 'pinned', visible: true },
          { key: 'recentMemories', visible: true },
        ],
      }),
    ).toBe(false);
  });

  it('초안은 저장 값을 복사한다(배열을 공유하지 않는다)', () => {
    const draft = toDraft(saved);
    const first = draft.sections[0];
    if (first) first.visible = false;
    expect(saved.sections[0]?.visible).toBe(true);
  });
});

describe('저장 멱등성 키', () => {
  const draft: CustomizationDraft = {
    themeKey: 'cream',
    accentColor: '#8b435a',
    coverAssetId: null,
    sections: defaultHomeSections(),
  };

  function tracker() {
    let count = 0;
    return createRequestKeyTracker(() => {
      count += 1;
      return `key-${count}`;
    });
  }

  it('같은 내용을 다시 보내면 같은 키다(응답 유실 재시도)', () => {
    const keys = tracker();
    const first = keys.keyFor(customizationSignatureValues(draft, 3));
    keys.settle(false);
    expect(keys.keyFor(customizationSignatureValues({ ...draft, sections: defaultHomeSections() }, 3))).toBe(first);
  });

  it('설정을 고치면 새 키다', () => {
    const keys = tracker();
    const first = keys.keyFor(customizationSignatureValues(draft, 3));
    expect(keys.keyFor(customizationSignatureValues({ ...draft, themeKey: 'sage' }, 3))).not.toBe(first);
  });

  it('섹션 순서만 바뀌어도 새 키다', () => {
    const keys = tracker();
    const first = keys.keyFor(customizationSignatureValues(draft, 3));
    const reordered = [
      { key: 'recentMemories' as const, visible: true },
      { key: 'pinned' as const, visible: true },
      { key: 'wishlist' as const, visible: true },
    ];
    expect(keys.keyFor(customizationSignatureValues({ ...draft, sections: reordered }, 3))).not.toBe(first);
  });

  it('확정 응답 뒤의 저장은 새 키다(같은 작업을 일부러 다시 할 수 있어야 한다)', () => {
    const keys = tracker();
    const first = keys.keyFor(customizationSignatureValues(draft, 3));
    keys.settle(true);
    expect(keys.keyFor(customizationSignatureValues(draft, 3))).not.toBe(first);
  });

  it('버전이 올라가면 새 키다', () => {
    const keys = tracker();
    const first = keys.keyFor(customizationSignatureValues(draft, 3));
    expect(keys.keyFor(customizationSignatureValues(draft, 4))).not.toBe(first);
  });
});
