import { expect, test } from '@playwright/test';

import {
  anonClient,
  apiCreateEvent,
  apiEvent,
  callRpc,
  eventArgs,
  loadCalendarAccounts,
  login,
  monthOf,
  newRequestId,
  newRequestId as requestId,
  stableMonthDay,
  uniqueTitle,
  userClient,
  waitForScreen,
} from './helpers';

/**
 * 권한: 비로그인·외부 공간 계정은 일정의 **존재 여부도** 알 수 없다.
 *
 * 화면 버튼을 숨기는 것으로 검증을 대신하지 않는다(DESIGN 12).
 * 앱을 거치지 않는 직접 API 호출과 테이블 직접 쓰기, DB의 입력 재검증까지 확인한다.
 */

const accounts = loadCalendarAccounts();

test.describe.configure({ mode: 'serial' });

const DAY = stableMonthDay(5);
const MONTH = monthOf(DAY);

let eventId = '';
let eventTitle = '';

test.beforeAll(async () => {
  const api = await userClient(accounts.a);
  eventTitle = uniqueTitle('권한 확인');
  eventId = await apiCreateEvent(api, {
    title: eventTitle,
    kind: 'date',
    startDate: DAY,
    startTime: '13:00',
    note: '비밀 메모',
  });
});

test('비로그인은 캘린더 화면에 들어갈 수 없다', async ({ page }) => {
  await page.goto('/calendar');
  await waitForScreen(page, ['login']);

  await page.goto(`/calendar/${eventId}`);
  await waitForScreen(page, ['login']);

  await page.goto('/calendar/new');
  await waitForScreen(page, ['login']);

  await page.goto(`/calendar/${eventId}/edit`);
  await waitForScreen(page, ['login']);
});

test('비로그인 직접 API는 조회도 변경도 막힌다', async () => {
  const anon = anonClient();

  const { data, error } = await anon.from('calendar_events').select('id, title').eq('id', eventId);
  // 권한 거부(42501) 또는 RLS로 0행. 어느 쪽이든 내용은 보이지 않는다.
  if (!error) expect(data ?? []).toHaveLength(0);

  const saved = await callRpc(anon, 'save_calendar_event', {
    ...eventArgs({ title: '비로그인 저장', startDate: DAY, startTime: '10:00' }),
    p_request_id: newRequestId(),
  });
  expect(saved.ok).toBe(false);

  const status = await callRpc(anon, 'set_calendar_event_status', {
    p_event_id: eventId,
    p_status: 'done',
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(status.ok).toBe(false);

  const removed = await callRpc(anon, 'delete_calendar_event', {
    p_event_id: eventId,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(removed.ok).toBe(false);

  // 실제로 아무것도 바뀌지 않았다.
  const api = await userClient(accounts.a);
  const row = await apiEvent(api, eventId);
  expect(row?.status).toBe('scheduled');
  expect(row?.version).toBe(1);
});

test('외부 공간 계정(C)은 화면에서도 내용을 볼 수 없다', async ({ page }) => {
  await login(page, accounts.c);

  await page.goto(`/calendar?month=${MONTH}`);
  await expect(page.getByRole('heading', { name: '커플 캘린더', exact: true })).toBeVisible();
  // 다른 공간의 일정은 달력에 없다.
  await expect(page.getByText(eventTitle)).toHaveCount(0);

  // 상세는 "없음"과 같은 화면이다(존재 여부를 알리지 않는다).
  await page.goto(`/calendar/${eventId}`);
  await expect(page.getByRole('heading', { name: '이 일정을 찾지 못했어요' })).toBeVisible();

  await page.goto(`/calendar/${eventId}/edit`);
  await expect(page.getByRole('heading', { name: '이 일정을 찾지 못했어요' })).toBeVisible();
});

test('외부 공간 계정(C)의 직접 API는 NOT_FOUND이고 아무것도 바꾸지 않는다', async () => {
  const api = await userClient(accounts.c);

  const rows = await api.from('calendar_events').select('id').eq('id', eventId);
  expect(rows.data ?? []).toHaveLength(0);

  const edited = await callRpc(api, 'save_calendar_event', {
    ...eventArgs(
      { title: '가로채기', startDate: DAY, startTime: '10:00' },
      { eventId, expectedVersion: 1 },
    ),
    p_request_id: requestId(),
  });
  expect(edited.ok).toBe(false);
  // 외부 공간에는 "권한 없음"도 알리지 않는다. 존재 자체를 숨긴다.
  if (!edited.ok) expect(edited.code).toBe('GF404');

  const status = await callRpc(api, 'set_calendar_event_status', {
    p_event_id: eventId,
    p_status: 'done',
    p_expected_version: 1,
    p_request_id: requestId(),
  });
  expect(status.ok).toBe(false);
  if (!status.ok) expect(status.code).toBe('GF404');

  const removed = await callRpc(api, 'delete_calendar_event', {
    p_event_id: eventId,
    p_expected_version: 1,
    p_request_id: requestId(),
  });
  expect(removed.ok).toBe(false);
  if (!removed.ok) expect(removed.code).toBe('GF404');

  const owner = await userClient(accounts.a);
  const row = await apiEvent(owner, eventId);
  expect(row?.title).toBe(eventTitle);
  expect(row?.version).toBe(1);
});

test('로그인 사용자도 테이블에 직접 쓸 수 없다(RPC만 허용, 권한 코드 42501)', async () => {
  const api = await userClient(accounts.a);

  const inserted = await api.from('calendar_events').insert({
    title: '직접 삽입',
    kind: 'date',
    starts_at: new Date().toISOString(),
  });
  expect(inserted.error).not.toBeNull();
  expect(inserted.error?.code).toBe('42501');

  const updated = await api
    .from('calendar_events')
    .update({ title: '직접 수정' })
    .eq('id', eventId);
  expect(updated.error).not.toBeNull();
  expect(updated.error?.code).toBe('42501');

  const removed = await api.from('calendar_events').delete().eq('id', eventId);
  expect(removed.error).not.toBeNull();
  expect(removed.error?.code).toBe('42501');

  expect((await apiEvent(api, eventId))?.title).toBe(eventTitle);
});

test('내부 헬퍼 함수는 로그인 사용자에게 노출되지 않는다', async () => {
  const api = await userClient(accounts.a);

  // app_private 스키마는 클라이언트 역할에 노출하지 않는다. RPC 경로로도 부를 수 없다.
  for (const fn of ['kst_moment', 'calendar_can_write']) {
    const result = await callRpc(api, fn, {});
    expect(result.ok, `${fn}은 호출할 수 없어야 한다`).toBe(false);
  }
});

test('DB가 종류·상태·시각 규칙을 다시 검증한다(화면 검증을 우회해도 막힌다)', async () => {
  const api = await userClient(accounts.a);

  const rejected: [string, Record<string, unknown>][] = [
    [
      '허용 밖 종류',
      {
        ...eventArgs({ title: uniqueTitle('종류'), startDate: DAY, startTime: '10:00' }),
        p_kind: 'meeting',
      },
    ],
    [
      '시작 시각 없는 시간 일정',
      eventArgs({ title: uniqueTitle('시각'), startDate: DAY, startTime: null }),
    ],
    [
      '종일인데 시각을 보냄',
      {
        ...eventArgs({ title: uniqueTitle('종일'), allDay: true, startDate: DAY }),
        p_start_time: '10:00',
      },
    ],
    [
      '종료가 시작보다 앞',
      eventArgs({
        title: uniqueTitle('역순'),
        startDate: DAY,
        startTime: '15:00',
        endDate: DAY,
        endTime: '14:00',
      }),
    ],
    [
      '종료가 시작과 같음',
      eventArgs({
        title: uniqueTitle('같은 시각'),
        startDate: DAY,
        startTime: '15:00',
        endDate: DAY,
        endTime: '15:00',
      }),
    ],
    [
      '종료 날짜만 보냄',
      eventArgs({
        title: uniqueTitle('종료일만'),
        startDate: DAY,
        startTime: '15:00',
        endDate: stableMonthDay(6),
        endTime: null,
      }),
    ],
    [
      '종일 종료일이 시작보다 앞',
      eventArgs({
        title: uniqueTitle('종일 역순'),
        allDay: true,
        startDate: stableMonthDay(6),
        endDate: DAY,
      }),
    ],
    [
      '빈 제목',
      eventArgs({ title: '   ', startDate: DAY, startTime: '10:00' }),
    ],
    [
      '101자 제목',
      eventArgs({ title: '가'.repeat(101), startDate: DAY, startTime: '10:00' }),
    ],
    [
      '101자 장소',
      eventArgs({
        title: uniqueTitle('장소'),
        startDate: DAY,
        startTime: '10:00',
        location: '가'.repeat(101),
      }),
    ],
    [
      '2001자 메모',
      eventArgs({
        title: uniqueTitle('메모'),
        startDate: DAY,
        startTime: '10:00',
        note: '가'.repeat(2001),
      }),
    ],
    [
      '생성인데 버전이 0이 아님',
      eventArgs({ title: uniqueTitle('버전'), startDate: DAY, startTime: '10:00' }, { expectedVersion: 3 }),
    ],
  ];

  for (const [label, args] of rejected) {
    const result = await callRpc(api, 'save_calendar_event', {
      ...args,
      p_request_id: newRequestId(),
    });
    expect(result.ok, `거부해야 하는 입력: ${label}`).toBe(false);
    if (!result.ok) expect(result.code, `거부 코드: ${label}`).toBe('GF422');
  }

  const badStatus = await callRpc(api, 'set_calendar_event_status', {
    p_event_id: eventId,
    p_status: 'archived',
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(badStatus.ok).toBe(false);
  if (!badStatus.ok) expect(badStatus.code).toBe('GF422');

  // 거부된 요청은 아무것도 남기지 않는다.
  expect((await apiEvent(api, eventId))?.version).toBe(1);
});

test('자정을 넘기는 일정과 여러 날 종일 일정은 DB가 받아들인다', async () => {
  const api = await userClient(accounts.a);

  const overnight = await callRpc(api, 'save_calendar_event', {
    ...eventArgs({
      title: uniqueTitle('밤샘'),
      startDate: DAY,
      startTime: '23:00',
      endDate: stableMonthDay(6),
      endTime: '01:30',
    }),
    p_request_id: newRequestId(),
  });
  expect(overnight.ok).toBe(true);

  const trip = await callRpc(api, 'save_calendar_event', {
    ...eventArgs({
      title: uniqueTitle('연휴'),
      allDay: true,
      startDate: DAY,
      endDate: stableMonthDay(7),
    }),
    p_request_id: newRequestId(),
  });
  expect(trip.ok).toBe(true);
});
