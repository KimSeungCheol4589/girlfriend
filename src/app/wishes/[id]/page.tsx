import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { QueryErrorNotice } from '@/features/wishes/components/QueryErrorNotice';
import { WishDetailView } from '@/features/wishes/components/WishDetailView';
import { getWishDetail } from '@/features/wishes/queries';

export const metadata: Metadata = {
  title: '위시 상세',
};

export const dynamic = 'force-dynamic';

async function WishDetail({ id }: { id: string }) {
  const result = await getWishDetail(id);
  // 없거나 다른 공간의 위시는 같은 404다(DESIGN 3). 조회 실패는 404로 바꾸지 않는다.
  if (result.status === 'not_found') notFound();
  if (result.status === 'error') {
    return <QueryErrorNotice title="위시를 불러오지 못했어요" message={result.message} />;
  }
  return <WishDetailView wish={result.wish} />;
}

export default async function WishDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (isDemoMode()) redirect('/wishes');

  const { id } = await params;
  return (
    <LivePageFrame path={`/wishes/${encodeURIComponent(id)}`} render={() => <WishDetail id={id} />} />
  );
}
