import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ErrorNotice } from '@/components/ErrorNotice';
import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { CalendarEventForm } from '@/features/calendar/components/CalendarEventForm';
import { QueryErrorNotice } from '@/features/calendar/components/QueryErrorNotice';
import { parseCalendarBackHref } from '@/features/calendar/filters';
import { getCalendarEventDetail, listWishOptions } from '@/features/calendar/queries';
import { withLinkedWishOption } from '@/features/calendar/wish-options';

export const metadata: Metadata = {
  title: '일정 수정',
};

export const dynamic = 'force-dynamic';

async function EditEvent({ id, calendarHref }: { id: string; calendarHref: string }) {
  const result = await getCalendarEventDetail(id);
  if (result.status === 'not_found') notFound();
  if (result.status === 'error') {
    return <QueryErrorNotice title="일정을 불러오지 못했어요" message={result.message} />;
  }

  const { event } = result;
  // 보고 있던 달·필터를 상세로 돌아갈 때까지 유지한다(독립 검토 P3-3).
  const detailHref = `/calendar/${event.id}?back=${encodeURIComponent(calendarHref)}`;

  // 상대방의 개인 일정은 볼 수만 있다. 폼을 그리지 않고 이유를 알린다(DB도 같은 규칙을 다시 검사한다).
  if (!event.canEdit) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href={detailHref} className="btn-quiet !px-0 text-sm">
          ← 상세로 돌아가기
        </Link>
        <ErrorNotice
          title="이 일정은 고칠 수 없어요"
          description="상대방의 개인 일정이라 보기만 할 수 있어요. 함께하는 일정은 두 사람 모두 고칠 수 있어요."
        >
          <Link href={detailHref} className="btn-primary">
            일정 상세 보기
          </Link>
        </ErrorNotice>
      </div>
    );
  }

  const wishes = await listWishOptions();
  /*
   * 연결된 위시가 선택지에 없으면 끼워 넣는다.
   * 목록 조회에 실패한 경우뿐 아니라, 성공했지만 위시가 100건을 넘어 연결된 위시가 목록에서 빠진
   * 경우까지 같은 규칙으로 다룬다(독립 검토 P3-1).
   */
  const options = withLinkedWishOption(wishes.ok ? wishes.wishes : [], {
    id: event.wishItemId,
    title: event.linkedWish?.title ?? null,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={detailHref} className="btn-quiet !px-0 text-sm">
        ← 상세로 돌아가기
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-text">일정 수정</h1>
        <p className="mt-1 text-sm text-muted">
          이 화면을 연 뒤 상대방이 내용이나 상태를 바꿨다면 덮어쓰지 않고 알려 드려요. 완료 체크는 상세
          화면에서 해요.
        </p>
      </div>
      <div className="app-card px-5 py-6 sm:px-6">
        <CalendarEventForm
          mode="edit"
          eventId={event.id}
          version={event.version}
          kindLocked
          calendarHref={calendarHref}
          wishOptions={options}
          wishOptionsMessage={wishes.ok ? null : wishes.message}
          initialValues={{
            kind: event.kind,
            title: event.title,
            location: event.location ?? '',
            note: event.note,
            allDay: event.allDay,
            startDate: event.startDate,
            startTime: event.startTime ?? '',
            // 종료를 저장하지 않았으면 비워 둔다(하루짜리로 다시 저장할 수 있게).
            endDate: event.hasEnd && event.endDate !== event.startDate ? event.endDate : '',
            endTime: event.allDay ? '' : (event.endTime ?? ''),
            wishItemId: event.wishItemId ?? '',
          }}
        />
      </div>
    </div>
  );
}

export default async function EditCalendarEventPage({
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
      path={`/calendar/${encodeURIComponent(id)}/edit`}
      render={() => <EditEvent id={id} calendarHref={calendarHref} />}
    />
  );
}
