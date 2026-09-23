import { describe, expect, it } from 'vitest';

import { pendingAfterSave, planPendingCoverDiscard, savedNoticeText } from '@/features/customize/cover-pipeline';
import type { SaveCustomizationData } from '@/features/customize/types';

/**
 * 아직 저장하지 않은 커버 파일의 수명 규칙(순수 함수만).
 *
 * 핵심: **이미 저장(첨부)된 커버는 어떤 경로로도 정리 대상이 되지 않는다.**
 * 응답을 잃은 재시도 뒤 같은 파일을 지우면 방금 저장한 커버가 사라지기 때문이다.
 *
 * 범위 주의: 여기서 검증하는 것은 "어떤 파일 ID를 정리할지 정하는 규칙"뿐이다.
 * **어느 파일 ID를 넘기는지**(빠른 교체 때 이전 파이프라인이 자기 파일만 취소하는지)와
 * 화면을 떠날 때의 정리는 브라우저 동작이라 E2E(tests/customize/e2e/cover.spec.ts)에서 확인한다.
 */

const PENDING = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

describe('planPendingCoverDiscard', () => {
  it('아직 저장하지 않은 내 파일은 정리한다', () => {
    expect(
      planPendingCoverDiscard({ pendingAssetId: PENDING, savedCoverAssetId: null, saveInFlight: false }),
    ).toEqual({ discard: PENDING, reason: 'draft' });
  });

  it('이전 커버가 따로 있어도 대기 파일만 정리한다', () => {
    expect(
      planPendingCoverDiscard({ pendingAssetId: PENDING, savedCoverAssetId: OTHER, saveInFlight: false }),
    ).toEqual({ discard: PENDING, reason: 'draft' });
  });

  it('저장에 쓰인 파일(= 지금 커버)은 정리하지 않는다', () => {
    expect(
      planPendingCoverDiscard({ pendingAssetId: PENDING, savedCoverAssetId: PENDING, saveInFlight: false }),
    ).toEqual({ discard: null, reason: 'committed' });
  });

  it('대소문자만 다른 같은 ID도 저장된 커버로 본다', () => {
    expect(
      planPendingCoverDiscard({
        pendingAssetId: PENDING.toUpperCase(),
        savedCoverAssetId: PENDING,
        saveInFlight: false,
      }),
    ).toEqual({ discard: null, reason: 'committed' });
  });

  it('저장 결과를 모르는 동안에는 정리하지 않는다', () => {
    expect(
      planPendingCoverDiscard({ pendingAssetId: PENDING, savedCoverAssetId: null, saveInFlight: true }),
    ).toEqual({ discard: null, reason: 'save_in_flight' });
  });

  it('판단은 넘겨받은 파일 ID 기준이다(교체 때 각 파일을 따로 판단할 수 있어야 한다)', () => {
    // 빠른 교체: 이전 파일은 버리고, 같은 순간 저장에 쓰인 새 파일은 지키는 판단이 동시에 가능해야 한다.
    // 실제로 "자기 파일"을 넘기는지는 E2E에서 확인한다.
    expect(planPendingCoverDiscard({ pendingAssetId: OTHER, savedCoverAssetId: PENDING, saveInFlight: false })).toEqual(
      { discard: OTHER, reason: 'draft' },
    );
    expect(
      planPendingCoverDiscard({ pendingAssetId: PENDING, savedCoverAssetId: PENDING, saveInFlight: false }),
    ).toEqual({ discard: null, reason: 'committed' });
  });

  it('대기 파일이 없으면 할 일이 없다', () => {
    expect(planPendingCoverDiscard({ pendingAssetId: null, savedCoverAssetId: OTHER, saveInFlight: false })).toEqual({
      discard: null,
      reason: 'none',
    });
  });
});

describe('pendingAfterSave', () => {
  const result = (coverAssetId: string | null): SaveCustomizationData => ({
    version: 4,
    coverAssetId,
    cleanup: 'done',
  });

  it('서버가 받아들인 커버는 정리 대상에서 빠진다', () => {
    expect(pendingAfterSave(PENDING, result(PENDING))).toBeNull();
  });

  it('서버가 다른 커버를 저장했으면 내 대기 파일은 남는다', () => {
    expect(pendingAfterSave(PENDING, result(OTHER))).toBe(PENDING);
    expect(pendingAfterSave(PENDING, result(null))).toBe(PENDING);
  });

  it('대기 파일이 없으면 null이다', () => {
    expect(pendingAfterSave(null, result(PENDING))).toBeNull();
  });
});

describe('savedNoticeText', () => {
  it('정리까지 끝나면 저장 사실만 알린다', () => {
    const text = savedNoticeText({ version: 2, coverAssetId: null, cleanup: 'done' });
    expect(text).toContain('저장했어요');
    expect(text).not.toContain('정리는 끝나지 않아');
  });

  it('파일 정리 실패를 저장 실패로 바꾸지 않는다', () => {
    const text = savedNoticeText({ version: 2, coverAssetId: PENDING, cleanup: 'pending' });
    expect(text).toContain('저장했어요');
    expect(text).toContain('정리는 끝나지 않아');
  });
});
