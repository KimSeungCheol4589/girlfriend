import type { Metadata } from 'next';

import { UpcomingNotice } from '@/components/UpcomingNotice';
import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { RestaurantsListView } from '@/features/restaurants/components/RestaurantsListView';
import {
  buildRestaurantsHref,
  parseRestaurantFilters,
  type RestaurantFilters,
} from '@/features/restaurants/filters';
import { listFilterSuggestions, listRestaurants } from '@/features/restaurants/queries';

export const metadata: Metadata = {
  title: '맛집',
};

export const dynamic = 'force-dynamic';

const PLANNED_ITEMS = [
  '상태(가고 싶은 곳·다녀온 곳) 탭과 이름 검색, 지역·음식 종류 필터',
  '이름·지역·종류·지도 링크·메모 등록과 수정',
  '방문 완료 전환과 방문일 입력, 방문 취소 시 후기 처리 확인',
  '맛집마다 두 사람의 별점과 한 줄 후기를 따로 보관',
];

async function LiveRestaurants({ filters }: { filters: RestaurantFilters }) {
  const [result, suggestions] = await Promise.all([
    listRestaurants(filters, null),
    listFilterSuggestions(),
  ]);
  return (
    <RestaurantsListView
      filters={filters}
      result={result}
      areaOptions={suggestions.areas}
      categoryOptions={suggestions.categories}
    />
  );
}

export default async function RestaurantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isDemoMode()) {
    // 명시적 데모 모드는 기존 동작(준비 중 안내)을 유지한다. 데모 데이터를 실제 저장처럼 보이지 않게 한다.
    return (
      <UpcomingNotice
        title="맛집"
        summary="가고 싶은 곳과 다녀온 곳을 나눠 보고 각자 별점·한 줄 후기를 남기는 화면입니다. 아직 만들지 않았습니다."
        plannedItems={PLANNED_ITEMS}
        taskNote="이 화면은 FOOD-001 작업에서 만듭니다. 홈의 ‘다음에 가고 싶은 맛집’ 목록도 지금은 예시 데이터입니다."
      />
    );
  }

  // DESIGN 3: 필터는 URL 검색 매개변수에서 읽는다.
  const filters = parseRestaurantFilters(await searchParams);

  return (
    <LivePageFrame
      path={buildRestaurantsHref(filters)}
      render={() => <LiveRestaurants filters={filters} />}
    />
  );
}
