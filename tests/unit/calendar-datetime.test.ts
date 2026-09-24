import { describe, expect, it } from 'vitest';

import {
  describeTiming,
  formatKoreanDateWithWeekday,
  formatKoreanTime,
  isClockTime,
  seoulDayStartUtc,
  shortTimeLabel,
  toSeoulMoment,
  weekdayLabel,
} from '@/features/calendar/datetime';

/**
 * 한국 시간 변환. 브라우저·서버의 지역 시간대가 무엇이든 같은 결과가 나와야 한다.
 * (DB는 timestamptz를 저장하고 화면·입력은 한국 달력 날짜·시각으로 다룬다.)
 */

describe('isClockTime', () => {
  it('24시간 HH:MM만 받는다', () => {
    expect(isClockTime('00:00')).toBe(true);
    expect(isClockTime('23:59')).toBe(true);
    expect(isClockTime('9:30')).toBe(false);
    expect(isClockTime('24:00')).toBe(false);
    expect(isClockTime('12:60')).toBe(false);
    expect(isClockTime('12:30:00')).toBe(false);
    expect(isClockTime(1230)).toBe(false);
  });
});

describe('toSeoulMoment', () => {
  it('UTC 표기를 한국 날짜·시각으로 바꾼다', () => {
    expect(toSeoulMoment('2026-11-07T05:30:00Z')).toEqual({ date: '2026-11-07', time: '14:30' });
  });

  it('오프셋 표기도 같은 순간으로 읽는다', () => {
    expect(toSeoulMoment('2026-11-07T14:30:00+09:00')).toEqual({
      date: '2026-11-07',
      time: '14:30',
    });
  });

  it('UTC 자정 이전은 한국 기준 다음 날이다', () => {
    // 2026-11-07 15:00Z == 2026-11-08 00:00 KST
    expect(toSeoulMoment('2026-11-07T15:00:00Z')).toEqual({ date: '2026-11-08', time: '00:00' });
  });

  it('마이크로초가 붙은 값도 읽는다', () => {
    expect(toSeoulMoment('2026-11-07T05:30:00.123456+00:00')).toEqual({
      date: '2026-11-07',
      time: '14:30',
    });
  });

  it('형식이 아니면 null이다(조용히 기본값으로 바꾸지 않는다)', () => {
    expect(toSeoulMoment('')).toBeNull();
    expect(toSeoulMoment('어제')).toBeNull();
    expect(toSeoulMoment(null)).toBeNull();
    expect(toSeoulMoment(1762_000_000_000)).toBeNull();
  });
});

describe('seoulDayStartUtc', () => {
  it('한국 자정을 UTC 표기로 돌려준다', () => {
    expect(seoulDayStartUtc('2026-11-01')).toBe('2026-10-31T15:00:00.000Z');
    expect(seoulDayStartUtc('2026-12-01')).toBe('2026-11-30T15:00:00.000Z');
  });

  it('왕복해도 같은 날짜다', () => {
    expect(toSeoulMoment(seoulDayStartUtc('2027-03-01'))).toEqual({
      date: '2027-03-01',
      time: '00:00',
    });
  });

  it('`+`가 들어가지 않는다(PostgREST or 필터에 그대로 쓴다)', () => {
    expect(seoulDayStartUtc('2026-11-01')).not.toContain('+');
  });

  it('달력 날짜가 아니면 던진다', () => {
    expect(() => seoulDayStartUtc('2026-02-30')).toThrow(RangeError);
  });
});

describe('표시', () => {
  it('오전·오후로 바꾼다', () => {
    expect(formatKoreanTime('00:00')).toBe('오전 12:00');
    expect(formatKoreanTime('09:05')).toBe('오전 9:05');
    expect(formatKoreanTime('12:00')).toBe('오후 12:00');
    expect(formatKoreanTime('14:30')).toBe('오후 2:30');
    expect(formatKoreanTime('23:59')).toBe('오후 11:59');
  });

  it('요일을 붙인다', () => {
    // 2026-11-07은 토요일이다.
    expect(weekdayLabel('2026-11-07')).toBe('토');
    expect(formatKoreanDateWithWeekday('2026-11-07')).toBe('2026년 11월 7일 (토)');
  });
});

describe('describeTiming', () => {
  it('하루 종일', () => {
    expect(
      describeTiming({
        allDay: true,
        startDate: '2026-10-09',
        startTime: null,
        endDate: '2026-10-09',
        endTime: null,
        hasEnd: true,
      }),
    ).toBe('2026년 10월 9일 (금) · 종일');
  });

  it('여러 날 종일', () => {
    expect(
      describeTiming({
        allDay: true,
        startDate: '2026-10-03',
        startTime: null,
        endDate: '2026-10-05',
        endTime: null,
        hasEnd: true,
      }),
    ).toContain('~');
  });

  it('같은 날 시간 일정은 종료 시각만 덧붙인다', () => {
    expect(
      describeTiming({
        allDay: false,
        startDate: '2026-11-07',
        startTime: '14:30',
        endDate: '2026-11-07',
        endTime: '15:30',
        hasEnd: true,
      }),
    ).toBe('2026년 11월 7일 (토) 오후 2:30 ~ 오후 3:30');
  });

  it('종료가 없으면 시작만 보여 준다', () => {
    expect(
      describeTiming({
        allDay: false,
        startDate: '2026-11-07',
        startTime: '14:30',
        endDate: '2026-11-07',
        endTime: null,
        hasEnd: false,
      }),
    ).toBe('2026년 11월 7일 (토) 오후 2:30');
  });

  it('자정을 넘기면 끝나는 날짜까지 보여 준다', () => {
    expect(
      describeTiming({
        allDay: false,
        startDate: '2026-11-07',
        startTime: '23:00',
        endDate: '2026-11-08',
        endTime: '01:30',
        hasEnd: true,
      }),
    ).toBe('2026년 11월 7일 (토) 오후 11:00 ~ 2026년 11월 8일 (일) 오전 1:30');
  });

  it('월 보기 칸의 짧은 표기', () => {
    const base = { startDate: '2026-11-07', endDate: '2026-11-07', hasEnd: false };
    expect(shortTimeLabel({ ...base, allDay: true, startTime: null, endTime: null })).toBe('종일');
    expect(shortTimeLabel({ ...base, allDay: false, startTime: '09:00', endTime: null })).toBe(
      '오전 9:00',
    );
  });
});
