import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { QueryErrorNotice } from '@/features/restaurants/components/QueryErrorNotice';
import { RestaurantDetailView } from '@/features/restaurants/components/RestaurantDetailView';
import { getRestaurantDetail } from '@/features/restaurants/queries';

export const metadata: Metadata = {
  title: '맛집 상세',
};

export const dynamic = 'force-dynamic';

async function RestaurantDetail({ id }: { id: string }) {
  const result = await getRestaurantDetail(id);
  // 없거나 다른 공간의 맛집은 같은 404다(DESIGN 3). 조회 실패는 404로 바꾸지 않는다.
  if (result.status === 'not_found') notFound();
  if (result.status === 'error') {
    return <QueryErrorNotice title="맛집 정보를 불러오지 못했어요" message={result.message} />;
  }
  return <RestaurantDetailView restaurant={result.restaurant} reviews={result.reviews} />;
}

export default async function RestaurantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (isDemoMode()) redirect('/restaurants');

  const { id } = await params;
  return (
    <LivePageFrame
      path={`/restaurants/${encodeURIComponent(id)}`}
      render={() => <RestaurantDetail id={id} />}
    />
  );
}
