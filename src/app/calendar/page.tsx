import type { Metadata } from 'next';

import { UpcomingNotice } from '@/components/UpcomingNotice';
import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { CalendarView } from '@/features/calendar/components/CalendarView';
import { buildCalendarHref, parseCalendarFilters, type CalendarFilters } from '@/features/calendar/filters';
import { listMonthEvents } from '@/features/calendar/queries';
import { todayInSeoul } from '@/lib/dates';

export const metadata: Metadata = {
  title: '커플 캘린더',
};

export const dynamic = 'force-dynamic';

const PLANNED_ITEMS = [
  '월 보기와 목록 보기, 달 이동',
  '각자의 개인 일정과 함께하는 데이트 일정 등록·수정',
  '종일·시간 일정, 장소·메모, 완료 체크와 취소',
  '개인 일정은 만든 사람만 수정, 함께하는 일정은 두 사람 모두 수정',
  '위시와 선택적으로 연결하기',
];

async function LiveCalendar({ filters, today }: { filters: CalendarFilters; today: string }) {
  const result = await listMonthEvents(filters);
  return <CalendarView filters={filters} result={result} today={today} />;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isDemoMode()) {
    // 명시적 데모 모드에는 일정 데이터가 없다. 데모 값을 실제 저장처럼 보이지 않게 안내만 한다.
    return (
      <UpcomingNotice
        title="커플 캘린더"
        summary="각자의 일정과 함께하는 데이트 일정을 한 달력에서 보는 화면입니다. 데모 모드에서는 저장하지 않습니다."
        plannedItems={PLANNED_ITEMS}
        taskNote="이 화면은 실제 로그인 상태에서만 동작합니다. 데모 모드에는 일정 저장소가 없습니다."
      />
    );
  }

  // DESIGN 3: 달·보기·필터는 URL 검색 매개변수에서 읽는다.
  const today = todayInSeoul();
  const filters = parseCalendarFilters(await searchParams, today);

  return (
    <LivePageFrame
      path={buildCalendarHref(filters)}
      render={() => <LiveCalendar filters={filters} today={today} />}
    />
  );
}
