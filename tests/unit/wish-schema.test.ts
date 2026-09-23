import { describe, expect, it } from 'vitest';

import {
  checkLinkUrl,
  codePointLength,
  dbStyleUrlHost,
  deleteWishSchema,
  isUuid,
  plannedDateProblem,
  safeLinkHref,
  saveWishSchema,
  setWishStatusSchema,
  wishInfoSchema,
} from '@/features/wishes/schema';
import { WISH_LIMITS } from '@/features/wishes/constants';
import { validateWith } from '@/features/auth/schemas';

/**
 * 위시 입력 검증 단위 테스트.
 *
 * 확인하는 것
 *   - 길이는 DB의 char_length와 같게 코드 포인트로 센다.
 *   - 링크는 HTTPS·길이·호스트 규칙을 DB와 같은 방식으로 본다. 링크를 가져오지 않는다.
 *   - 상태·계획일 조합 규칙(‘wish’에는 계획일이 없다, 미래 계획일은 정상).
 */

const WISH_ID = '3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69';

describe('codePointLength', () => {
  it('이모지를 한 글자로 센다(자바스크립트 length와 다르다)', () => {
    expect('👩‍❤️‍👨'.length).toBeGreaterThan(codePointLength('👩‍❤️‍👨'));
    expect(codePointLength('가나다')).toBe(3);
    expect(codePointLength('🎈')).toBe(1);
  });
});

describe('isUuid', () => {
  it('UUID 형식만 통과시킨다', () => {
    expect(isUuid(WISH_ID)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(123)).toBe(false);
  });
});

describe('dbStyleUrlHost', () => {
  it('DB의 url_host와 같은 방식으로 호스트를 뽑는다', () => {
    expect(dbStyleUrlHost('https://example.invalid/a?b#c')).toBe('example.invalid');
    expect(dbStyleUrlHost('https://EXAMPLE.invalid/a')).toBe('example.invalid');
    expect(dbStyleUrlHost('https://example.invalid:8443/a')).toBe('example.invalid:8443');
    // 사용자 정보가 붙으면 호스트 조각에 그대로 남는다(그래서 거부할 수 있다).
    expect(dbStyleUrlHost('https://trusted.invalid@evil.invalid/a')).toBe('trusted.invalid@evil.invalid');
    expect(dbStyleUrlHost('https://')).toBeNull();
  });
});

describe('checkLinkUrl', () => {
  it('빈 값은 링크 없음(null)이다', () => {
    expect(checkLinkUrl('')).toEqual({ ok: true, url: null });
    expect(checkLinkUrl('   ')).toEqual({ ok: true, url: null });
    expect(checkLinkUrl(null)).toEqual({ ok: true, url: null });
    expect(checkLinkUrl(undefined)).toEqual({ ok: true, url: null });
  });

  it('https 주소는 다듬어서 그대로 돌려준다', () => {
    expect(checkLinkUrl('  https://example.invalid/wish  ')).toEqual({
      ok: true,
      url: 'https://example.invalid/wish',
    });
  });

  it('맛집 지도와 달리 호스트 허용 목록이 없다', () => {
    expect(checkLinkUrl('https://any-site.invalid/page').ok).toBe(true);
    expect(checkLinkUrl('https://example.invalid:8443/page').ok).toBe(true);
  });

  it('https가 아니면 거부한다(대문자 스킴·다른 스킴 포함)', () => {
    expect(checkLinkUrl('http://example.invalid/a')).toEqual({ ok: false, reason: 'https_required' });
    // DB 정규식은 대소문자를 구분한다.
    expect(checkLinkUrl('HTTPS://example.invalid/a')).toEqual({ ok: false, reason: 'https_required' });
    expect(checkLinkUrl('javascript:alert(1)')).toEqual({ ok: false, reason: 'https_required' });
    expect(checkLinkUrl('data:text/html,<script>')).toEqual({ ok: false, reason: 'https_required' });
    expect(checkLinkUrl('https://exa mple.invalid/a')).toEqual({ ok: false, reason: 'https_required' });
  });

  it('길이 범위를 벗어나면 거부한다', () => {
    expect(checkLinkUrl('https://a')).toEqual({ ok: false, reason: 'length' });
    const tooLong = `https://example.invalid/${'a'.repeat(WISH_LIMITS.linkUrlMax)}`;
    expect(checkLinkUrl(tooLong)).toEqual({ ok: false, reason: 'length' });
  });

  it('사용자 정보가 붙은 주소는 거부한다(진짜 호스트를 가린다)', () => {
    expect(checkLinkUrl('https://trusted.invalid@evil.invalid/a')).toEqual({
      ok: false,
      reason: 'host_not_allowed',
    });
    expect(checkLinkUrl('https://user:pw@evil.invalid/a')).toEqual({
      ok: false,
      reason: 'host_not_allowed',
    });
  });
});

describe('safeLinkHref', () => {
  it('규칙을 통과한 주소만 링크로 만든다', () => {
    expect(safeLinkHref('https://example.invalid/a')).toBe('https://example.invalid/a');
    expect(safeLinkHref('javascript:alert(1)')).toBeNull();
    expect(safeLinkHref('https://trusted.invalid@evil.invalid/a')).toBeNull();
    expect(safeLinkHref(null)).toBeNull();
  });
});

describe('wishInfoSchema', () => {
  const valid = { title: '  한강 가기  ', category: 'activity', memo: ' 자전거 ', linkUrl: '' };

  it('제목·메모를 다듬고 링크 없음은 null로 만든다', () => {
    const result = validateWith(wishInfoSchema, valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        title: '한강 가기',
        category: 'activity',
        memo: '자전거',
        linkUrl: null,
      });
    }
  });

  it('빈 제목과 너무 긴 제목을 거부한다', () => {
    expect(validateWith(wishInfoSchema, { ...valid, title: '   ' }).ok).toBe(false);
    expect(
      validateWith(wishInfoSchema, { ...valid, title: '가'.repeat(WISH_LIMITS.titleMax + 1) }).ok,
    ).toBe(false);
    expect(validateWith(wishInfoSchema, { ...valid, title: '가'.repeat(WISH_LIMITS.titleMax) }).ok).toBe(
      true,
    );
  });

  it('메모 길이는 코드 포인트로 센다', () => {
    expect(validateWith(wishInfoSchema, { ...valid, memo: '🎈'.repeat(WISH_LIMITS.memoMax) }).ok).toBe(
      true,
    );
    expect(
      validateWith(wishInfoSchema, { ...valid, memo: '🎈'.repeat(WISH_LIMITS.memoMax + 1) }).ok,
    ).toBe(false);
  });

  it('허용되지 않은 분류를 거부한다', () => {
    const result = validateWith(wishInfoSchema, { ...valid, category: 'restaurant' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.category).toBeTruthy();
  });

  it('잘못된 링크는 필드 오류가 된다', () => {
    const result = validateWith(wishInfoSchema, { ...valid, linkUrl: 'http://example.invalid/a' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.linkUrl).toBeTruthy();
  });
});

describe('saveWishSchema', () => {
  it('새 위시는 wishId가 null일 수 있다', () => {
    const result = validateWith(saveWishSchema, {
      wishId: null,
      title: '제목',
      category: 'other',
      memo: '',
      linkUrl: '',
      expectedVersion: 0,
    });
    expect(result.ok).toBe(true);
  });

  it('형식이 틀린 wishId와 음수 버전을 거부한다', () => {
    expect(
      validateWith(saveWishSchema, {
        wishId: 'nope',
        title: '제목',
        category: 'other',
        memo: '',
        linkUrl: '',
        expectedVersion: 1,
      }).ok,
    ).toBe(false);
    expect(
      validateWith(saveWishSchema, {
        wishId: WISH_ID,
        title: '제목',
        category: 'other',
        memo: '',
        linkUrl: '',
        expectedVersion: -1,
      }).ok,
    ).toBe(false);
  });
});

describe('plannedDateProblem', () => {
  it('달력 날짜 형식만 통과시킨다', () => {
    expect(plannedDateProblem('2026-09-23')).toBeNull();
    // 앞으로 할 일이므로 미래 날짜가 정상이다(맛집 방문일과 다른 점).
    expect(plannedDateProblem('2099-01-01')).toBeNull();
    expect(plannedDateProblem('2026-02-30')).toBeTruthy();
    expect(plannedDateProblem('')).toBeTruthy();
    expect(plannedDateProblem('2026/09/23')).toBeTruthy();
  });
});

describe('setWishStatusSchema', () => {
  const base = { wishId: WISH_ID, expectedVersion: 1 };

  it('계획됨·해냈어요는 날짜가 있어도 없어도 된다', () => {
    expect(validateWith(setWishStatusSchema, { ...base, status: 'planned', plannedDate: null }).ok).toBe(
      true,
    );
    expect(
      validateWith(setWishStatusSchema, { ...base, status: 'planned', plannedDate: '2099-01-01' }).ok,
    ).toBe(true);
    expect(validateWith(setWishStatusSchema, { ...base, status: 'done', plannedDate: null }).ok).toBe(
      true,
    );
  });

  it('하고 싶음으로 되돌릴 때는 날짜가 반드시 비어 있어야 한다', () => {
    const result = validateWith(setWishStatusSchema, {
      ...base,
      status: 'wish',
      plannedDate: '2099-01-01',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.plannedDate).toBeTruthy();
    expect(validateWith(setWishStatusSchema, { ...base, status: 'wish', plannedDate: null }).ok).toBe(
      true,
    );
  });

  it('형식이 틀린 날짜와 상태를 거부한다', () => {
    expect(
      validateWith(setWishStatusSchema, { ...base, status: 'planned', plannedDate: '2026-13-01' }).ok,
    ).toBe(false);
    expect(
      validateWith(setWishStatusSchema, { ...base, status: 'cancelled', plannedDate: null }).ok,
    ).toBe(false);
  });

  it('수정은 버전 1 이상이어야 한다', () => {
    expect(
      validateWith(setWishStatusSchema, {
        wishId: WISH_ID,
        status: 'done',
        plannedDate: null,
        expectedVersion: 0,
      }).ok,
    ).toBe(false);
  });
});

describe('deleteWishSchema', () => {
  it('올바른 ID와 버전 1 이상만 받는다', () => {
    expect(validateWith(deleteWishSchema, { wishId: WISH_ID, expectedVersion: 2 }).ok).toBe(true);
    expect(validateWith(deleteWishSchema, { wishId: 'x', expectedVersion: 2 }).ok).toBe(false);
    expect(validateWith(deleteWishSchema, { wishId: WISH_ID, expectedVersion: 0 }).ok).toBe(false);
  });
});
