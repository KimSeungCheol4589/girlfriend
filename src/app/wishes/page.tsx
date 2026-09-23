import type { Metadata } from 'next';

import { UpcomingNotice } from '@/components/UpcomingNotice';
import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { WishesListView } from '@/features/wishes/components/WishesListView';
import { buildWishesHref, parseWishFilters, type WishFilters } from '@/features/wishes/filters';
import { listWishes } from '@/features/wishes/queries';

export const metadata: Metadata = {
  title: '하고 싶은 일',
};

export const dynamic = 'force-dynamic';

const PLANNED_ITEMS = [
  '상태(하고 싶어요·계획했어요·해냈어요) 탭과 제목 검색, 분류 필터',
  '제목·분류·링크·메모 등록과 수정',
  '계획한 날짜 입력과 상태 전환, 완료 후에도 기록 보존',
  '두 사람이 같은 위시를 함께 고치고, 먼저 저장된 변경을 덮어쓰지 않기',
];

async function LiveWishes({ filters }: { filters: WishFilters }) {
  const result = await listWishes(filters, null);
  return <WishesListView filters={filters} result={result} />;
}

export default async function WishesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isDemoMode()) {
    // 명시적 데모 모드에는 위시 데이터가 없다. 데모 값을 실제 저장처럼 보이지 않게 안내만 한다.
    return (
      <UpcomingNotice
        title="하고 싶은 일"
        summary="맛집 말고 둘이 함께 하고 싶은 일을 모아 두는 화면입니다. 데모 모드에서는 저장하지 않습니다."
        plannedItems={PLANNED_ITEMS}
        taskNote="이 화면은 실제 로그인 상태에서만 동작합니다. 데모 모드에는 위시 저장소가 없습니다."
      />
    );
  }

  // DESIGN 3: 필터는 URL 검색 매개변수에서 읽는다.
  const filters = parseWishFilters(await searchParams);

  return (
    <LivePageFrame path={buildWishesHref(filters)} render={() => <LiveWishes filters={filters} />} />
  );
}
