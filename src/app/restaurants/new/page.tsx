import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { RestaurantForm } from '@/features/restaurants/components/RestaurantForm';
import { listFilterSuggestions } from '@/features/restaurants/queries';

export const metadata: Metadata = {
  title: '맛집 추가',
};

export const dynamic = 'force-dynamic';

async function NewRestaurant() {
  const suggestions = await listFilterSuggestions();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/restaurants" className="btn-quiet !px-0 text-sm">
        ← 맛집 목록
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-text">맛집 추가</h1>
        <p className="mt-1 text-sm text-muted">
          새 맛집은 ‘가고 싶은 곳’으로 저장돼요. 다녀온 뒤 상세 화면에서 방문일과 후기를 남겨요.
        </p>
      </div>
      <div className="app-card px-5 py-6 sm:px-6">
        <RestaurantForm mode="create" areaOptions={suggestions.areas} categoryOptions={suggestions.categories} />
      </div>
    </div>
  );
}

export default function NewRestaurantPage() {
  // 데모 모드에는 맛집 저장 화면이 없다. 목록의 준비 중 안내로 보낸다.
  if (isDemoMode()) redirect('/restaurants');

  return <LivePageFrame path="/restaurants/new" render={() => <NewRestaurant />} />;
}
