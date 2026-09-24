import type { EventKind, EventStatus } from './constants';
import type { ClockTime } from './datetime';
import type { CalendarDate } from '@/lib/dates';

/** 화면용 일정 항목. 사용자 입력은 모두 일반 텍스트로만 그린다. */
export type CalendarEventItem = {
  id: string;
  kind: EventKind;
  /** 공동 데이트 일정이면 null. */
  ownerId: string | null;
  title: string;
  location: string | null;
  allDay: boolean;
  status: EventStatus;
  wishItemId: string | null;
  /** 한국 시간 기준 시작 날짜. */
  startDate: CalendarDate;
  startTime: ClockTime | null;
  /** 종일 일정은 **포함** 종료일. 종료가 없는 시간 일정은 시작일과 같다. */
  endDate: CalendarDate;
  endTime: ClockTime | null;
  hasEnd: boolean;
  /** 이 사용자가 바꿀 수 있는지(공동 일정이거나 내 개인 일정). */
  canEdit: boolean;
  /** `내 일정` · `상대 일정` · `함께` 같은 표시 이름. */
  ownerLabel: string;
};

export type CalendarEventDetail = CalendarEventItem & {
  note: string;
  version: number;
  createdBy: string;
  createdByLabel: string;
  updatedAt: string;
  /** 연결한 위시. 지워졌거나 읽지 못하면 null이고, 연결 자체는 `wishItemId`로 알 수 있다. */
  linkedWish: { id: string; title: string } | null;
};

export type WishOption = {
  id: string;
  title: string;
  status: string;
};

export type QueryFailure = {
  ok: false;
  /** 사람이 읽는 문장. DB 원문을 담지 않는다. */
  message: string;
  /** 로그인이 풀려 다시 로그인해야 하는지. */
  unauthenticated?: boolean;
};

export type CalendarMonthResult =
  | {
      ok: true;
      events: CalendarEventItem[];
      /** 상한을 넘겨 일부만 가져왔는지. 조용히 자르지 않고 화면에서 알린다. */
      truncated: boolean;
    }
  | QueryFailure;

export type CalendarEventDetailResult =
  | { status: 'ok'; event: CalendarEventDetail }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export type WishOptionsResult = { ok: true; wishes: WishOption[] } | QueryFailure;
