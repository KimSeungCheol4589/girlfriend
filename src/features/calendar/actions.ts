'use server';

import { revalidatePath } from 'next/cache';

import { isRequestId } from '@/features/auth/request-id';
import { validateWith } from '@/features/auth/schemas';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import {
  logCalendarFailure,
  mapCalendarRpcError,
  validationFailure,
  type CalendarFailure,
} from './errors';
import {
  deleteCalendarEventSchema,
  saveCalendarEventSchema,
  setCalendarEventStatusSchema,
  type DeleteCalendarEventInput,
  type SaveCalendarEventInput,
  type SetCalendarEventStatusInput,
} from './schema';

import type { EventStatus } from './constants';

/**
 * 캘린더 Server Action.
 *
 * 공통 규칙(CONTRACTS.md 0·7)
 *   - 사용자·공간은 DB 함수가 세션으로 확인한다. 클라이언트가 보낸 사용자·공간 ID는 받지 않는다.
 *   - 개인 일정의 소유자도 DB가 정한다(항상 만든 사람). 클라이언트가 owner를 지정할 수 없다.
 *   - 시각은 **한국 시간 날짜·시:분**으로 보내고 DB가 조립한다. timestamptz를 여기서 만들지 않는다.
 *   - 입력은 여기서 다시 검증한다(화면 검증을 믿지 않는다). 최종 검증은 DB 함수와 트리거가 한다.
 *   - 변경은 전용 RPC로만 한다. 요청 키(requestId)는 **클라이언트가 만든 값만** 쓴다.
 *     서버가 대신 만들면 재시도마다 키가 달라져 중복 반영을 막지 못한다.
 *   - 실패는 코드·문장으로 돌려주고, 로그에는 작업 이름·코드·요청 키만 남긴다.
 */

export type CalendarActionResult<T> = { ok: true; data: T } | CalendarFailure;

type WithRequestId<T> = T & { requestId: string };

const CONFIG_FAILURE: CalendarFailure = {
  ok: false,
  code: 'CONFIG_ERROR',
  message: '서버 설정이 없어 저장할 수 없어요. 운영자에게 알려 주세요.',
};

const BAD_REQUEST_ID: CalendarFailure = {
  ok: false,
  code: 'VALIDATION_ERROR',
  message: '요청 정보가 올바르지 않아요. 화면을 새로 불러온 뒤 다시 시도해 주세요.',
};

async function getClient() {
  try {
    return await createSupabaseServerClient();
  } catch (error) {
    if (isSupabaseConfigError(error)) return null;
    throw error;
  }
}

type RpcCall = {
  operation: string;
  fn: string;
  args: Record<string, unknown>;
  requestId: string;
};

async function callRpc(
  call: RpcCall,
): Promise<{ ok: true; data: Record<string, unknown> } | CalendarFailure> {
  const supabase = await getClient();
  if (!supabase) return CONFIG_FAILURE;

  let response: {
    data: unknown;
    error: { code?: string; message?: string; details?: string } | null;
  };
  try {
    response = await supabase.rpc(call.fn, call.args);
  } catch {
    // 네트워크 예외: 서버가 처리했는지 모른다. 같은 키로 다시 보내야 한다.
    const failure = mapCalendarRpcError({ code: '' });
    logCalendarFailure(call.operation, failure.code, call.requestId);
    return failure;
  }

  if (response.error) {
    const failure = mapCalendarRpcError(response.error);
    logCalendarFailure(call.operation, failure.code, call.requestId);
    return failure;
  }

  const data = response.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    // 계약과 다른 응답. 저장 여부를 단정하지 않는다.
    const failure = mapCalendarRpcError({ code: '' });
    logCalendarFailure(call.operation, 'UNKNOWN', call.requestId);
    return failure;
  }
  return { ok: true, data: data as Record<string, unknown> };
}

function revalidateCalendar(): void {
  revalidatePath('/calendar', 'layout');
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// ---------------------------------------------------------------------------
// 일정 정보 (생성·수정)
// ---------------------------------------------------------------------------

export async function saveCalendarEventAction(
  input: WithRequestId<SaveCalendarEventInput>,
): Promise<CalendarActionResult<{ eventId: string; version: number }>> {
  if (!isRequestId(input?.requestId)) return BAD_REQUEST_ID;
  const parsed = validateWith(saveCalendarEventSchema, input);
  if (!parsed.ok) return validationFailure(parsed.fieldErrors);
  const value = parsed.data;

  if (value.eventId === null && value.expectedVersion !== 0) {
    return validationFailure({ _form: '새 일정은 버전 0으로 만들어야 해요.' });
  }

  const result = await callRpc({
    operation: 'saveCalendarEvent',
    fn: 'save_calendar_event',
    requestId: input.requestId,
    args: {
      p_event_id: value.eventId,
      p_kind: value.kind,
      p_title: value.title,
      p_location: value.location,
      p_note: value.note,
      p_all_day: value.allDay,
      p_start_date: value.startDate,
      // 종일 일정에는 시각을 보내지 않는다(DB도 거부한다).
      p_start_time: value.allDay ? null : value.startTime,
      p_end_date: value.endDate,
      p_end_time: value.allDay ? null : value.endTime,
      p_wish_item_id: value.wishItemId,
      p_expected_version: value.expectedVersion,
      p_request_id: input.requestId,
    },
  });
  if (!result.ok) return result;

  const eventId = text(result.data.eventId);
  const version = num(result.data.version);
  if (!eventId || version === null) {
    logCalendarFailure('saveCalendarEvent', 'UNKNOWN', input.requestId);
    return mapCalendarRpcError({ code: '' });
  }

  revalidateCalendar();
  return { ok: true, data: { eventId, version } };
}

// ---------------------------------------------------------------------------
// 상태 (완료 체크·취소)
// ---------------------------------------------------------------------------

export async function setCalendarEventStatusAction(
  input: WithRequestId<SetCalendarEventStatusInput>,
): Promise<CalendarActionResult<{ version: number; status: EventStatus }>> {
  if (!isRequestId(input?.requestId)) return BAD_REQUEST_ID;
  const parsed = validateWith(setCalendarEventStatusSchema, input);
  if (!parsed.ok) return validationFailure(parsed.fieldErrors);
  const value = parsed.data;

  const result = await callRpc({
    operation: 'setCalendarEventStatus',
    fn: 'set_calendar_event_status',
    requestId: input.requestId,
    args: {
      p_event_id: value.eventId,
      p_status: value.status,
      p_expected_version: value.expectedVersion,
      p_request_id: input.requestId,
    },
  });
  if (!result.ok) return result;

  const version = num(result.data.version);
  const status = text(result.data.status);
  if (
    version === null ||
    (status !== 'scheduled' && status !== 'done' && status !== 'cancelled')
  ) {
    logCalendarFailure('setCalendarEventStatus', 'UNKNOWN', input.requestId);
    return mapCalendarRpcError({ code: '' });
  }

  revalidateCalendar();
  return { ok: true, data: { version, status } };
}

// ---------------------------------------------------------------------------
// 삭제
// ---------------------------------------------------------------------------

export async function deleteCalendarEventAction(
  input: WithRequestId<DeleteCalendarEventInput>,
): Promise<CalendarActionResult<{ eventId: string }>> {
  if (!isRequestId(input?.requestId)) return BAD_REQUEST_ID;
  const parsed = validateWith(deleteCalendarEventSchema, input);
  if (!parsed.ok) return validationFailure(parsed.fieldErrors);
  const value = parsed.data;

  const result = await callRpc({
    operation: 'deleteCalendarEvent',
    fn: 'delete_calendar_event',
    requestId: input.requestId,
    args: {
      p_event_id: value.eventId,
      p_expected_version: value.expectedVersion,
      p_request_id: input.requestId,
    },
  });
  if (!result.ok) return result;

  revalidateCalendar();
  return { ok: true, data: { eventId: value.eventId } };
}
