import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { WishForm } from '@/features/wishes/components/WishForm';

export const metadata: Metadata = {
  title: '위시 추가',
};

export const dynamic = 'force-dynamic';

function NewWish() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/wishes" className="btn-quiet !px-0 text-sm">
        ← 하고 싶은 일 목록
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-text">위시 추가</h1>
        <p className="mt-1 text-sm text-muted">
          새 위시는 ‘하고 싶어요’로 저장돼요. 날짜를 정하거나 해낸 뒤에는 상세 화면에서 상태를 바꿔요.
        </p>
      </div>
      <div className="app-card px-5 py-6 sm:px-6">
        <WishForm mode="create" />
      </div>
    </div>
  );
}

export default function NewWishPage() {
  // 데모 모드에는 위시 저장소가 없다. 목록의 안내 화면으로 보낸다.
  if (isDemoMode()) redirect('/wishes');

  return <LivePageFrame path="/wishes/new" render={() => <NewWish />} />;
}
