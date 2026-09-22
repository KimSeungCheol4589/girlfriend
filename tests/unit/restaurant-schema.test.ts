import { describe, expect, it } from 'vitest';

import { validateWith } from '@/features/auth/schemas';
import {
  checkMapUrl,
  codePointLength,
  dbStyleUrlHost,
  restaurantInfoSchema,
  safeMapHref,
  saveRestaurantSchema,
  saveReviewSchema,
  setStatusSchema,
  visitedDateProblem,
} from '@/features/restaurants/schema';

const UUID = '3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69';

describe('codePointLength', () => {
  it('PostgreSQL char_length처럼 이모지를 한 글자로 센다', () => {
    expect(codePointLength('맛집')).toBe(2);
    expect(codePointLength('🍜🍣')).toBe(2);
    expect('🍜🍣'.length).toBe(4);
  });
});

describe('checkMapUrl — DB 규칙과 같은 판정', () => {
  it('빈 값은 링크 없음(null)이다', () => {
    expect(checkMapUrl('')).toEqual({ ok: true, url: null });
    expect(checkMapUrl('   ')).toEqual({ ok: true, url: null });
    expect(checkMapUrl(undefined)).toEqual({ ok: true, url: null });
  });

  it('허용 호스트의 https 링크를 통과시킨다', () => {
    expect(checkMapUrl('https://map.naver.com/p/entry/place/123')).toEqual({
      ok: true,
      url: 'https://map.naver.com/p/entry/place/123',
    });
    expect(checkMapUrl('  https://naver.me/abc  ')).toEqual({ ok: true, url: 'https://naver.me/abc' });
    expect(checkMapUrl('https://place.map.kakao.com/1234?x=1#y').ok).toBe(true);
    expect(checkMapUrl('https://kko.to/abc').ok).toBe(true);
    // DB도 호스트를 소문자로 비교한다.
    expect(checkMapUrl('https://MAP.naver.com/x').ok).toBe(true);
  });

  it('https가 아니거나 대문자 스킴이면 거부한다(DB 정규식은 대소문자를 구분한다)', () => {
    expect(checkMapUrl('http://map.naver.com/x')).toEqual({ ok: false, reason: 'https_required' });
    expect(checkMapUrl('HTTPS://map.naver.com/x')).toEqual({ ok: false, reason: 'https_required' });
    expect(checkMapUrl('javascript:alert(1)')).toEqual({ ok: false, reason: 'https_required' });
    expect(checkMapUrl('https://map.naver.com/a b')).toEqual({ ok: false, reason: 'https_required' });
  });

  it('허용 목록 밖 호스트·포트·사용자 정보·백슬래시 우회를 거부한다', () => {
    expect(checkMapUrl('https://evil.example.com/x')).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(checkMapUrl('https://map.naver.com.evil.example/x')).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(checkMapUrl('https://map.naver.com:444/x')).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(checkMapUrl('https://user@map.naver.com/x')).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(checkMapUrl('https://evil.example\\@map.naver.com/x')).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(checkMapUrl('https://map.naver.com\\@evil.example/x')).toEqual({ ok: false, reason: 'host_not_allowed' });
  });

  it('길이 11~500자를 지킨다', () => {
    expect(checkMapUrl('https://a.b')).toEqual({ ok: false, reason: 'host_not_allowed' });
    const long = `https://map.naver.com/${'a'.repeat(480)}`;
    expect(codePointLength(long)).toBeGreaterThan(500);
    expect(checkMapUrl(long)).toEqual({ ok: false, reason: 'length' });
  });

  it('dbStyleUrlHost는 DB url_host와 같이 첫 / ? # 앞까지를 소문자로 뽑는다', () => {
    expect(dbStyleUrlHost('https://Map.Naver.com/x')).toBe('map.naver.com');
    expect(dbStyleUrlHost('https://naver.me?x=1')).toBe('naver.me');
    expect(dbStyleUrlHost('https://kko.to#a')).toBe('kko.to');
    expect(dbStyleUrlHost('https://user@map.naver.com/x')).toBe('user@map.naver.com');
    expect(dbStyleUrlHost('https:///x')).toBeNull();
  });

  it('safeMapHref는 저장된 값이라도 규칙을 벗어나면 링크로 만들지 않는다', () => {
    expect(safeMapHref('https://map.kakao.com/x')).toBe('https://map.kakao.com/x');
    expect(safeMapHref('javascript:alert(1)')).toBeNull();
    expect(safeMapHref('https://evil.example.com')).toBeNull();
    expect(safeMapHref(null)).toBeNull();
  });
});

describe('restaurantInfoSchema', () => {
  it('앞뒤 공백을 다듬고 빈 지도 링크는 null로 보낸다', () => {
    const result = validateWith(restaurantInfoSchema, {
      name: '  성수 파스타 ',
      area: ' 성수 ',
      category: '',
      mapUrl: '',
      memo: ' 창가 ',
    });
    expect(result).toEqual({
      ok: true,
      data: { name: '성수 파스타', area: '성수', category: '', mapUrl: null, memo: '창가' },
    });
  });

  it('이름은 필수이고 100자(코드 포인트)까지다', () => {
    const empty = validateWith(restaurantInfoSchema, { name: '   ', area: '', category: '', mapUrl: '', memo: '' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.firstField).toBe('name');

    const emoji100 = validateWith(restaurantInfoSchema, {
      name: '🍜'.repeat(100),
      area: '',
      category: '',
      mapUrl: '',
      memo: '',
    });
    expect(emoji100.ok).toBe(true);

    const tooLong = validateWith(restaurantInfoSchema, {
      name: '가'.repeat(101),
      area: '',
      category: '',
      mapUrl: '',
      memo: '',
    });
    expect(tooLong.ok).toBe(false);
  });

  it('지역·종류 50자, 메모 2000자 제한과 지도 링크 오류를 필드에 붙인다', () => {
    const result = validateWith(restaurantInfoSchema, {
      name: '이름',
      area: '가'.repeat(51),
      category: '나'.repeat(51),
      mapUrl: 'https://evil.example.com/x',
      memo: '다'.repeat(2001),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual(['area', 'category', 'mapUrl', 'memo']);
      expect(result.fieldErrors.mapUrl).toContain('네이버 지도·카카오맵');
    }
  });

  it('saveRestaurantSchema는 형식이 틀린 ID와 음수 버전을 거부한다', () => {
    const base = { name: '이름', area: '', category: '', mapUrl: '', memo: '' };
    expect(validateWith(saveRestaurantSchema, { ...base, restaurantId: 'x', expectedVersion: 1 }).ok).toBe(false);
    expect(validateWith(saveRestaurantSchema, { ...base, restaurantId: null, expectedVersion: -1 }).ok).toBe(false);
    expect(validateWith(saveRestaurantSchema, { ...base, restaurantId: null, expectedVersion: 1.5 }).ok).toBe(false);
    expect(validateWith(saveRestaurantSchema, { ...base, restaurantId: UUID, expectedVersion: 3 }).ok).toBe(true);
  });
});

describe('방문 상태·방문일', () => {
  it('visitedDateProblem은 한국 달력 기준 오늘까지만 허용한다', () => {
    expect(visitedDateProblem('2026-09-21', '2026-09-21')).toBeNull();
    expect(visitedDateProblem('2026-09-20', '2026-09-21')).toBeNull();
    expect(visitedDateProblem('2026-09-22', '2026-09-21')).toContain('오늘보다 뒤');
    expect(visitedDateProblem('2026-02-30', '2026-09-21')).toContain('날짜');
    expect(visitedDateProblem('', '2026-09-21')).toContain('날짜');
  });

  it('visited에는 올바른 과거 날짜가 필요하다', () => {
    const base = { restaurantId: UUID, status: 'visited', confirmDeleteReviews: false, expectedVersion: 1 } as const;
    expect(validateWith(setStatusSchema, { ...base, visitedDate: '2020-01-01' }).ok).toBe(true);
    const future = validateWith(setStatusSchema, { ...base, visitedDate: '2999-01-01' });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.firstField).toBe('visitedDate');
    expect(validateWith(setStatusSchema, { ...base, visitedDate: null }).ok).toBe(false);
  });

  it('wishlist에는 방문일을 보낼 수 없다', () => {
    const base = { restaurantId: UUID, status: 'wishlist', confirmDeleteReviews: true, expectedVersion: 2 } as const;
    expect(validateWith(setStatusSchema, { ...base, visitedDate: null }).ok).toBe(true);
    expect(validateWith(setStatusSchema, { ...base, visitedDate: '2020-01-01' }).ok).toBe(false);
  });

  it('알 수 없는 상태와 버전 0은 거부한다', () => {
    expect(
      validateWith(setStatusSchema, {
        restaurantId: UUID,
        status: 'closed',
        visitedDate: null,
        confirmDeleteReviews: false,
        expectedVersion: 1,
      }).ok,
    ).toBe(false);
    expect(
      validateWith(setStatusSchema, {
        restaurantId: UUID,
        status: 'wishlist',
        visitedDate: null,
        confirmDeleteReviews: false,
        expectedVersion: 0,
      }).ok,
    ).toBe(false);
  });
});

describe('saveReviewSchema', () => {
  const base = { restaurantId: UUID, comment: '맛있다', expectedVersion: 0 };

  it('별점은 1~5 정수만 허용한다', () => {
    for (const rating of [1, 3, 5]) {
      expect(validateWith(saveReviewSchema, { ...base, rating }).ok).toBe(true);
    }
    for (const rating of [0, 6, 2.5, Number.NaN]) {
      expect(validateWith(saveReviewSchema, { ...base, rating }).ok).toBe(false);
    }
  });

  it('후기는 500자(코드 포인트)까지다', () => {
    expect(validateWith(saveReviewSchema, { ...base, rating: 4, comment: '😋'.repeat(500) }).ok).toBe(true);
    const tooLong = validateWith(saveReviewSchema, { ...base, rating: 4, comment: '가'.repeat(501) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.firstField).toBe('comment');
  });
});
