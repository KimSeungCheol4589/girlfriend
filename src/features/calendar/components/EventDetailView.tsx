import Link from 'next/link';

import { SourceMemoriesPanel } from '@/features/memories/links/components/SourceMemoriesPanel';
import type { SourceMemoriesResult } from '@/features/memories/links/types';

import { KIND_HINTS } from '../constants';
import { describeTiming } from '../datetime';

import { KindBadge, OwnerBadge, StatusBadge } from './Badges';
import { DeleteEventButton } from './DeleteEventButton';
import { EventStatusPanel } from './EventStatusPanel';

import type { CalendarEventDetail } from '../types';

/**
 * 일정 상세. 사용자 입력(제목·장소·메모)은 일반 텍스트로만 그린다(DESIGN 5.3).
 *
 * 개인 일정은 두 사람 모두 볼 수 있지만 만든 사람만 고치고 완료 체크한다.
 * 그래서 수정·삭제 버튼도 `canEdit`일 때만 둔다. 버튼을 숨기는 것으로 접근 제어를 대신하지 않고
 * DB가 같은 규칙을 다시 검사한다.
 */
export function EventDetailView({
  event,
  calendarHref,
  dateRecords,
}: {
  event: CalendarEventDetail;
  calendarHref: string;
  /** 이 일정으로 남긴 데이트 기록(DATE-001). 조회 실패도 그대로 전달한다. */
  dateRecords: SourceMemoriesResult;
}) {
  return (
    <div className="space-y-6">
      <Link href={calendarHref} className="btn-quiet !px-0 text-sm">
        ← 캘린더로 돌아가기
      </Link>

      <article className="app-card px-5 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <StatusBadge status={event.status} />
          <OwnerBadge kind={event.kind} ownerLabel={event.ownerLabel} />
          <KindBadge kind={event.kind} />
        </div>
        <h1 className="mt-3 break-words text-2xl font-bold text-text">{event.title}</h1>
        <p className="mt-1 text-sm text-muted" data-testid="event-when">
          {describeTiming(event)}
        </p>

        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="font-semibold text-text">장소</dt>
            <dd className="mt-0.5 break-words text-muted">
              {event.location ? event.location : '적어 둔 장소가 없어요.'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-text">메모</dt>
            <dd className="mt-0.5 whitespace-pre-line break-words text-text">
              {event.note ? event.note : <span className="text-muted">메모가 없어요.</span>}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-text">연결한 위시</dt>
            <dd className="mt-0.5 text-muted" data-testid="event-linked-wish">
              {event.linkedWish ? (
                <Link
                  href={`/wishes/${event.linkedWish.id}`}
                  className="break-words text-accent underline underline-offset-2"
                >
                  {event.linkedWish.title}
                </Link>
              ) : event.wishItemId ? (
                '연결한 위시를 불러오지 못했어요.'
              ) : (
                '연결한 위시가 없어요.'
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-text">만든 사람</dt>
            <dd className="mt-0.5 text-muted">{event.createdByLabel}</dd>
          </div>
        </dl>

        <p className="mt-5 rounded-xl bg-surface-muted px-4 py-3 text-xs leading-relaxed text-muted">
          {KIND_HINTS[event.kind]}
        </p>

        {event.canEdit ? (
          <div className="mt-6 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-4">
            {/* 보고 있던 달·보기·필터를 수정 화면에도 넘긴다. 저장 뒤 상세로, 상세에서 캘린더로
                돌아갈 때까지 같은 상태를 유지한다(독립 검토 P3-3). */}
            <Link
              href={`/calendar/${event.id}/edit?back=${encodeURIComponent(calendarHref)}`}
              className="btn-secondary"
            >
              내용 수정
            </Link>
            <DeleteEventButton
              eventId={event.id}
              eventTitle={event.title}
              version={event.version}
              calendarHref={calendarHref}
            />
          </div>
        ) : null}
      </article>

      <EventStatusPanel
        eventId={event.id}
        status={event.status}
        version={event.version}
        canEdit={event.canEdit}
      />

      <SourceMemoriesPanel
        source="event"
        sourceId={event.id}
        done={event.status === 'done'}
        result={dateRecords}
      />
    </div>
  );
}
