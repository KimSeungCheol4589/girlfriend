import { describe, expect, it } from 'vitest';

import { validateWith } from '@/features/auth/schemas';
import {
  codePointLength,
  deleteCalendarEventSchema,
  eventInfoSchema,
  isUuid,
  saveCalendarEventSchema,
  setCalendarEventStatusSchema,
} from '@/features/calendar/schema';

/**
 * 일정 입력 검증. 마이그레이션의 CHECK·트리거와 같은 규칙을 화면에서도 먼저 걸러 준다.
 * 통과하지 못하는 조합이 서버로 나가지 않는지, 통과하는 조합이 정규화되는지 확인한다.
 */

const BASE = {
  kind: 'date' as const,
  title: '  전시 보러 가기  ',
  location: '  서울시립미술관 ',
  note: ' 예약 필요 ',
  allDay: false,
  startDate: '2026-12-05',
  startTime: '11:00',
  endDate: '',
  endTime: '',
  wishItemId: null as string | null,
};

function check(input: Record<string, unknown>) {
  return validateWith(eventInfoSchema, { ...BASE, ...input });
}

describe('codePointLength', () => {
  it('이모지를 한 글자로 센다', () => {
    expect(codePointLength('🎉')).toBe(1);
    expect('🎉'.length).toBe(2);
  });
});

describe('isUuid', () => {
  it('UUID 형식만 받는다', () => {
    expect(isUuid('3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69')).toBe(true);
    expect(isUuid('3f1c2b1a8d4e4c3b9a2f1e2d3c4b5a69')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});

describe('eventInfoSchema — 정규화', () => {
  it('제목·장소·메모의 앞뒤 공백을 다듬고 빈 장소는 null이다', () => {
    const result = check({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe('전시 보러 가기');
      expect(result.data.location).toBe('서울시립미술관');
      expect(result.data.note).toBe('예약 필요');
    }

    const blank = check({ location: '   ' });
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.data.location).toBeNull();
  });

  it('빈 날짜·시각은 null이다', () => {
    const result = check({ endDate: '', endTime: '' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.endDate).toBeNull();
      expect(result.data.endTime).toBeNull();
    }
  });
});

describe('eventInfoSchema — 길이·허용값', () => {
  it('제목은 필수이고 100자까지다', () => {
    expect(check({ title: '   ' }).ok).toBe(false);
    expect(check({ title: '가'.repeat(100) }).ok).toBe(true);
    expect(check({ title: '가'.repeat(101) }).ok).toBe(false);
  });

  it('장소는 100자, 메모는 2,000자까지다', () => {
    expect(check({ location: '가'.repeat(101) }).ok).toBe(false);
    expect(check({ note: '가'.repeat(2001) }).ok).toBe(false);
    expect(check({ note: '가'.repeat(2000) }).ok).toBe(true);
  });

  it('허용 목록 밖의 종류는 거부한다', () => {
    const result = check({ kind: 'meeting' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.kind).toBeTruthy();
  });

  it('종일 여부가 불리언이 아니면 거부한다(조작된 요청)', () => {
    expect(check({ allDay: 'true' }).ok).toBe(false);
  });

  it('위시 연결은 UUID이거나 null이다', () => {
    expect(check({ wishItemId: 'not-a-uuid' }).ok).toBe(false);
    expect(check({ wishItemId: null }).ok).toBe(true);
    expect(check({ wishItemId: '3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69' }).ok).toBe(true);
  });
});

describe('eventInfoSchema — 날짜와 시각', () => {
  it('시작 날짜는 필수이고 실제로 있는 날짜여야 한다', () => {
    expect(check({ startDate: '' }).ok).toBe(false);
    expect(check({ startDate: '2026-02-30' }).ok).toBe(false);
    expect(check({ startDate: '2026-12-05' }).ok).toBe(true);
  });

  it('시간 일정에는 시작 시각이 필요하다', () => {
    const result = check({ startTime: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.startTime).toBeTruthy();
  });

  it('시각 형식이 아니면 거부한다', () => {
    expect(check({ startTime: '11시' }).ok).toBe(false);
    expect(check({ startTime: '25:00' }).ok).toBe(false);
  });

  it('종일 일정에는 시각을 넣지 않는다', () => {
    const result = check({ allDay: true, startTime: '11:00', endTime: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.startTime).toBeTruthy();
    expect(check({ allDay: true, startTime: '', endTime: '' }).ok).toBe(true);
  });

  it('종일 일정의 끝나는 날짜는 시작보다 앞일 수 없다', () => {
    const result = check({
      allDay: true,
      startTime: '',
      endDate: '2026-12-04',
      endTime: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.endDate).toBeTruthy();

    expect(check({ allDay: true, startTime: '', endDate: '2026-12-07', endTime: '' }).ok).toBe(true);
  });

  it('끝나는 날짜만 보내면 거부한다', () => {
    const result = check({ endDate: '2026-12-06', endTime: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.endTime).toBeTruthy();
  });

  it('끝나는 시각은 시작보다 뒤여야 한다', () => {
    expect(check({ endTime: '10:00' }).ok).toBe(false);
    expect(check({ endTime: '11:00' }).ok).toBe(false);
    expect(check({ endTime: '11:01' }).ok).toBe(true);
  });

  it('자정을 넘기는 일정은 정상이다', () => {
    expect(
      check({ startTime: '23:00', endDate: '2026-12-06', endTime: '01:30' }).ok,
    ).toBe(true);
  });

  it('끝나는 날짜가 앞이면 시각이 더 커도 거부한다', () => {
    expect(check({ startTime: '10:00', endDate: '2026-12-04', endTime: '23:00' }).ok).toBe(false);
  });

  it('과거·미래 날짜 모두 허용한다(지난 일정도 적어 둘 수 있다)', () => {
    expect(check({ startDate: '2020-01-01' }).ok).toBe(true);
    expect(check({ startDate: '2099-12-31' }).ok).toBe(true);
  });
});

describe('saveCalendarEventSchema', () => {
  const save = { ...BASE, eventId: null as string | null, expectedVersion: 0 };

  it('시각 규칙을 그대로 다시 적용한다', () => {
    expect(validateWith(saveCalendarEventSchema, { ...save, startTime: '' }).ok).toBe(false);
  });

  it('버전은 0 이상의 정수다', () => {
    expect(validateWith(saveCalendarEventSchema, { ...save, expectedVersion: -1 }).ok).toBe(false);
    expect(validateWith(saveCalendarEventSchema, { ...save, expectedVersion: 1.5 }).ok).toBe(false);
  });

  it('수정에는 UUID 형식의 일정 ID가 필요하다', () => {
    expect(validateWith(saveCalendarEventSchema, { ...save, eventId: 'x' }).ok).toBe(false);
    expect(
      validateWith(saveCalendarEventSchema, {
        ...save,
        eventId: '3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69',
        expectedVersion: 2,
      }).ok,
    ).toBe(true);
  });
});

describe('setCalendarEventStatusSchema / deleteCalendarEventSchema', () => {
  const eventId = '3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69';

  it('상태는 허용 목록만 받는다', () => {
    for (const status of ['scheduled', 'done', 'cancelled']) {
      expect(validateWith(setCalendarEventStatusSchema, { eventId, status, expectedVersion: 1 }).ok).toBe(
        true,
      );
    }
    expect(
      validateWith(setCalendarEventStatusSchema, { eventId, status: 'archived', expectedVersion: 1 }).ok,
    ).toBe(false);
  });

  it('상태·삭제는 버전 1 이상이어야 한다(새로 만들 때 쓰는 함수가 아니다)', () => {
    expect(
      validateWith(setCalendarEventStatusSchema, { eventId, status: 'done', expectedVersion: 0 }).ok,
    ).toBe(false);
    expect(validateWith(deleteCalendarEventSchema, { eventId, expectedVersion: 0 }).ok).toBe(false);
    expect(validateWith(deleteCalendarEventSchema, { eventId, expectedVersion: 1 }).ok).toBe(true);
  });
});
