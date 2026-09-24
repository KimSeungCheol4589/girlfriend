import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ErrorNotice } from '@/components/ErrorNotice';
import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { CalendarEventForm } from '@/features/calendar/components/CalendarEventForm';
import { QueryErrorNotice } from '@/features/calendar/components/QueryErrorNotice';
import { getCalendarEventDetail, listWishOptions } from '@/features/calendar/queries';

export const metadata: Metadata = {
  title: '일정 수정',
};

export const dynamic = 'force-dynamic';

async function EditEvent({ id }: { id: string }) {
  const result = await getCalendarEventDetail(id);
  if (result.status === 'not_found') notFound();
  if (result.status === 'error') {
    return <QueryErrorNotice title="일정을 불러오지 못했어요" message={result.message} />;
  }

  const { event } = result;

  // 상대방의 개인 일정은 볼 수만 있다. 폼을 그리지 않고 이유를 알린다(DB도 같은 규칙을 다시 검사한다).
  if (!event.canEdit) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href={`/calendar/${event.id}`} className="btn-quiet !px-0 text-sm">
          ← 상세로 돌아가기
        </Link>
        <ErrorNotice
          title="이 일정은 고칠 수 없어요"
          description="상대방의 개인 일정이라 보기만 할 수 있어요. 함께하는 일정은 두 사람 모두 고칠 수 있어요."
        >
          <Link href={`/calendar/${event.id}`} className="btn-primary">
            일정 상세 보기
          </Link>
        </ErrorNotice>
      </div>
    );
  }

  const wishes = await listWishOptions();
  // 목록을 못 읽었는데 이 일정에 연결된 위시가 있으면, 고를 수 없는 값이 조용히 지워지지 않게
  // 현재 연결을 선택지에 남긴다.
  const options = wishes.ok
    ? wishes.wishes
    : event.wishItemId
      ? [
          {
            id: event.wishItemId,
            title: event.linkedWish?.title ?? '연결된 위시',
            status: 'wish',
          },
        ]
      : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/calendar/${event.id}`} className="btn-quiet !px-0 text-sm">
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

export default async function EditCalendarEventPage({ params }: { params: Promise<{ id: string }> }) {
  if (isDemoMode()) redirect('/calendar');

  const { id } = await params;
  return (
    <LivePageFrame
      path={`/calendar/${encodeURIComponent(id)}/edit`}
      render={() => <EditEvent id={id} />}
    />
  );
}
