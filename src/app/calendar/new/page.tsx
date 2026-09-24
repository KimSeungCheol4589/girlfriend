import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { CalendarEventForm } from '@/features/calendar/components/CalendarEventForm';
import { QueryErrorNotice } from '@/features/calendar/components/QueryErrorNotice';
import { DEFAULT_KIND, EVENT_KINDS, type EventKind } from '@/features/calendar/constants';
import { parseCalendarBackHref } from '@/features/calendar/filters';
import { listWishOptions } from '@/features/calendar/queries';
import { isUuid } from '@/features/calendar/schema';
import { isCalendarDate, todayInSeoul } from '@/lib/dates';

export const metadata: Metadata = {
  title: '일정 추가',
};

export const dynamic = 'force-dynamic';

/** 달력의 날짜 칸에서 들어오면 그 날짜를, 아니면 한국 기준 오늘을 채운다. */
function initialDate(raw: string | string[] | undefined, today: string): string {
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  return isCalendarDate(value.trim()) ? value.trim() : today;
}

function initialKind(raw: string | string[] | undefined): EventKind {
  const value = ((Array.isArray(raw) ? raw[0] : raw) ?? '').trim();
  return (EVENT_KINDS as readonly string[]).includes(value) ? (value as EventKind) : DEFAULT_KIND;
}

/** 위시 상세에서 "일정 만들기"로 들어올 때의 미리 연결. 형식이 아니면 무시한다. */
function initialWishId(raw: string | string[] | undefined): string {
  const value = ((Array.isArray(raw) ? raw[0] : raw) ?? '').trim();
  return isUuid(value) ? value : '';
}

async function NewEvent({
  backHref,
  startDate,
  kind,
  wishItemId,
}: {
  backHref: string;
  startDate: string;
  kind: EventKind;
  wishItemId: string;
}) {
  const wishes = await listWishOptions();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={backHref} className="btn-quiet !px-0 text-sm">
        ← 캘린더로 돌아가기
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-text">일정 추가</h1>
        <p className="mt-1 text-sm text-muted">
          새 일정은 ‘예정’으로 저장돼요. 개인 일정은 상대방도 볼 수 있지만 고치는 건 만든 사람만 할 수
          있어요.
        </p>
      </div>
      {!wishes.ok && wishes.unauthenticated ? (
        <QueryErrorNotice
          title="로그인이 필요해요"
          message={wishes.message}
          unauthenticated
          loginNext="/calendar"
        />
      ) : null}
      <div className="app-card px-5 py-6 sm:px-6">
        <CalendarEventForm
          mode="create"
          calendarHref={backHref}
          wishOptions={wishes.ok ? wishes.wishes : []}
          wishOptionsMessage={wishes.ok ? null : wishes.message}
          initialValues={{
            kind,
            title: '',
            location: '',
            note: '',
            allDay: false,
            startDate,
            startTime: '19:00',
            endDate: '',
            endTime: '',
            // 목록을 못 읽었으면 고를 수 없으므로 연결도 비운다.
            wishItemId: wishes.ok ? wishItemId : '',
          }}
        />
      </div>
    </div>
  );
}

export default async function NewCalendarEventPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // 데모 모드에는 일정 저장소가 없다. 안내 화면으로 보낸다.
  if (isDemoMode()) redirect('/calendar');

  const params = await searchParams;
  const today = todayInSeoul();
  const backHref = parseCalendarBackHref(params.back, today);

  return (
    <LivePageFrame
      path="/calendar/new"
      render={() => (
        <NewEvent
          backHref={backHref}
          startDate={initialDate(params.date, today)}
          kind={initialKind(params.kind)}
          wishItemId={initialWishId(params.wishId)}
        />
      )}
    />
  );
}
