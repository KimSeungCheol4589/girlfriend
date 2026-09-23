import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { QueryErrorNotice } from '@/features/restaurants/components/QueryErrorNotice';
import { RestaurantForm } from '@/features/restaurants/components/RestaurantForm';
import { getRestaurantDetail, listFilterSuggestions } from '@/features/restaurants/queries';

export const metadata: Metadata = {
  title: '맛집 수정',
};

export const dynamic = 'force-dynamic';

async function EditRestaurant({ id }: { id: string }) {
  const [result, suggestions] = await Promise.all([getRestaurantDetail(id), listFilterSuggestions()]);
  if (result.status === 'not_found') notFound();
  if (result.status === 'error') {
    return <QueryErrorNotice title="맛집 정보를 불러오지 못했어요" message={result.message} />;
  }

  const { restaurant } = result;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/restaurants/${restaurant.id}`} className="btn-quiet !px-0 text-sm">
        ← 상세로 돌아가기
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-text">맛집 정보 수정</h1>
        <p className="mt-1 text-sm text-muted">
          두 사람 모두 고칠 수 있어요. 이 화면을 연 뒤 상대방이 정보·방문 상태·후기를 바꿨다면 덮어쓰지 않고 알려
          드려요. 방문 상태는 상세 화면에서 바꿔요.
        </p>
      </div>
      <div className="app-card px-5 py-6 sm:px-6">
        <RestaurantForm
          mode="edit"
          restaurantId={restaurant.id}
          version={restaurant.version}
          initialValues={{
            name: restaurant.name,
            area: restaurant.area,
            category: restaurant.category,
            mapUrl: restaurant.mapUrl ?? '',
            memo: restaurant.memo,
          }}
          areaOptions={suggestions.areas}
          categoryOptions={suggestions.categories}
        />
      </div>
    </div>
  );
}

export default async function EditRestaurantPage({ params }: { params: Promise<{ id: string }> }) {
  if (isDemoMode()) redirect('/restaurants');

  const { id } = await params;
  return (
    <LivePageFrame
      path={`/restaurants/${encodeURIComponent(id)}/edit`}
      render={() => <EditRestaurant id={id} />}
    />
  );
}
