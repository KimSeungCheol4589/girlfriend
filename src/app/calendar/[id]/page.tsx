import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { EventDetailView } from '@/features/calendar/components/EventDetailView';
import { QueryErrorNotice } from '@/features/calendar/components/QueryErrorNotice';
import { parseCalendarBackHref } from '@/features/calendar/filters';
import { getCalendarEventDetail } from '@/features/calendar/queries';

export const metadata: Metadata = {
  title: '일정 상세',
};

export const dynamic = 'force-dynamic';

async function EventDetail({ id, calendarHref }: { id: string; calendarHref: string }) {
  const result = await getCalendarEventDetail(id);
  // 없거나 다른 공간의 일정은 같은 404다(DESIGN 3). 조회 실패는 404로 바꾸지 않는다.
  if (result.status === 'not_found') notFound();
  if (result.status === 'error') {
    return <QueryErrorNotice title="일정을 불러오지 못했어요" message={result.message} />;
  }
  return <EventDetailView event={result.event} calendarHref={calendarHref} />;
}

export default async function CalendarEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isDemoMode()) redirect('/calendar');

  const { id } = await params;
  const calendarHref = parseCalendarBackHref((await searchParams).back);

  return (
    <LivePageFrame
      path={`/calendar/${encodeURIComponent(id)}`}
      render={() => <EventDetail id={id} calendarHref={calendarHref} />}
    />
  );
}
