import { z } from 'zod';

import { isCalendarDate } from '@/lib/dates';

import { CALENDAR_LIMITS, EVENT_KINDS, EVENT_STATUSES } from './constants';
import { isClockTime } from './datetime';

/**
 * 일정 입력 검증.
 *
 * 화면과 Server Action이 같은 규칙을 쓴다. DB 함수와 트리거가 같은 제한을 다시 검사하므로
 * 여기서의 검증은 "먼저 걸러 주는 안내"이고 최종 방어는 DB다.
 *
 * 길이는 PostgreSQL `char_length`와 같게 **코드 포인트** 단위로 센다.
 * (자바스크립트 `length`는 UTF-16 단위라 이모지 하나를 2로 센다.)
 *
 * 시각은 날짜(`YYYY-MM-DD`)와 시:분(`HH:MM`)을 따로 보낸다. timestamptz를 클라이언트가 만들지 않는다.
 * 서버(DB)가 한국 시간으로 조립하므로 브라우저 시간대가 달라도 같은 날짜로 저장된다.
 */

export function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

const uuidField = z.string().refine(isUuid, '대상을 찾을 수 없어요.');

/** 0 이상의 정수 버전. 새로 만들 때는 0이다(CONTRACTS.md 0). */
const versionField = z.number().int().min(0).max(2_147_483_647);

function textField(label: string, max: number, options: { required?: boolean } = {}) {
  return z
    .string()
    .transform((value) => value.trim())
    .refine((value) => !options.required || value.length > 0, `${label}을(를) 입력해 주세요.`)
    .refine(
      (value) => codePointLength(value) <= max,
      `${label}은(는) ${max.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`,
    );
}

/** 빈 문자열은 "없음"이다. 값이 있으면 실제로 있는 날짜여야 한다. */
const optionalDateField = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value === '' || isCalendarDate(value), '실제로 있는 날짜를 골라 주세요.')
  .transform((value) => (value === '' ? null : value));

const optionalTimeField = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value === '' || isClockTime(value), '시각을 24시간 형식(예: 14:30)으로 골라 주세요.')
  .transform((value) => (value === '' ? null : value));

// ---------------------------------------------------------------------------
// 일정 정보 (생성·수정)
// ---------------------------------------------------------------------------

const eventInfoObject = z.object({
  kind: z.enum(EVENT_KINDS, { message: '일정 종류를 다시 골라 주세요.' }),
  title: textField('제목', CALENDAR_LIMITS.titleMax, { required: true }),
  location: textField('장소', CALENDAR_LIMITS.locationMax).transform((value) =>
    value === '' ? null : value,
  ),
  note: textField('메모', CALENDAR_LIMITS.noteMax),
  allDay: z.boolean({ message: '종일 여부를 다시 확인해 주세요.' }),
  startDate: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value !== '', '시작 날짜를 골라 주세요.')
    .refine((value) => value === '' || isCalendarDate(value), '실제로 있는 날짜를 골라 주세요.'),
  startTime: optionalTimeField,
  endDate: optionalDateField,
  endTime: optionalTimeField,
  /** 선택적 위시 연결. 빈 값은 "연결 없음"이다. */
  wishItemId: uuidField.nullable(),
});

type TimingShape = {
  allDay: boolean;
  startDate: string;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
};

/**
 * 종일/시간 조합과 시작·종료 순서. DB 함수와 `tg_calendar_time_guard`가 같은 규칙을 다시 검사한다.
 * 날짜·시각이 모두 0으로 채운 고정 폭 문자열이라 문자열 비교로 시간 순서를 판단할 수 있다.
 */
function refineTiming(value: TimingShape, context: z.RefinementCtx): void {
  const add = (path: string, message: string) =>
    context.addIssue({ code: 'custom', path: [path], message });

  if (!isCalendarDate(value.startDate)) return; // 위 refine이 이미 알린다

  if (value.allDay) {
    // 종일 일정에는 시각이 없다. DB 트리거도 KST 자정 정렬을 다시 확인한다.
    if (value.startTime !== null) add('startTime', '종일 일정에는 시각을 넣지 않아요.');
    if (value.endTime !== null) add('endTime', '종일 일정에는 시각을 넣지 않아요.');
    if (value.endDate !== null && value.endDate < value.startDate) {
      add('endDate', '끝나는 날짜는 시작 날짜보다 앞일 수 없어요.');
    }
    return;
  }

  if (value.startTime === null) {
    add('startTime', '시작 시각을 골라 주세요.');
    return;
  }
  if (value.endDate === null && value.endTime === null) return;
  if (value.endTime === null) {
    // 끝나는 날짜만 보내면 언제 끝나는지 알 수 없다. 조용히 자정으로 정하지 않는다.
    add('endTime', '끝나는 시각도 함께 골라 주세요.');
    return;
  }

  const endDate = value.endDate ?? value.startDate;
  if (`${endDate}T${value.endTime}` <= `${value.startDate}T${value.startTime}`) {
    add('endTime', '끝나는 시각은 시작보다 뒤여야 해요.');
  }
}

export const eventInfoSchema = eventInfoObject.superRefine(refineTiming);

export type EventInfoInput = z.input<typeof eventInfoSchema>;
export type EventInfo = z.output<typeof eventInfoSchema>;

export const saveCalendarEventSchema = eventInfoObject
  .extend({
    /** 새로 만들 때는 null. */
    eventId: uuidField.nullable(),
    expectedVersion: versionField,
  })
  .superRefine(refineTiming);

export type SaveCalendarEventInput = z.input<typeof saveCalendarEventSchema>;

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

export const setCalendarEventStatusSchema = z.object({
  eventId: uuidField,
  status: z.enum(EVENT_STATUSES, { message: '상태를 다시 골라 주세요.' }),
  expectedVersion: versionField.min(1),
});

export type SetCalendarEventStatusInput = z.input<typeof setCalendarEventStatusSchema>;

export const deleteCalendarEventSchema = z.object({
  eventId: uuidField,
  expectedVersion: versionField.min(1),
});

export type DeleteCalendarEventInput = z.input<typeof deleteCalendarEventSchema>;
