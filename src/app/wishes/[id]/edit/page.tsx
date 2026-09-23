import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { QueryErrorNotice } from '@/features/wishes/components/QueryErrorNotice';
import { WishForm } from '@/features/wishes/components/WishForm';
import { getWishDetail } from '@/features/wishes/queries';

export const metadata: Metadata = {
  title: '위시 수정',
};

export const dynamic = 'force-dynamic';

async function EditWish({ id }: { id: string }) {
  const result = await getWishDetail(id);
  if (result.status === 'not_found') notFound();
  if (result.status === 'error') {
    return <QueryErrorNotice title="위시를 불러오지 못했어요" message={result.message} />;
  }

  const { wish } = result;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/wishes/${wish.id}`} className="btn-quiet !px-0 text-sm">
        ← 상세로 돌아가기
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-text">위시 수정</h1>
        <p className="mt-1 text-sm text-muted">
          두 사람 모두 고칠 수 있어요. 이 화면을 연 뒤 상대방이 내용이나 상태를 바꿨다면 덮어쓰지 않고 알려 드려요.
          상태와 계획한 날짜는 상세 화면에서 바꿔요.
        </p>
      </div>
      <div className="app-card px-5 py-6 sm:px-6">
        <WishForm
          mode="edit"
          wishId={wish.id}
          version={wish.version}
          initialValues={{
            title: wish.title,
            category: wish.category,
            memo: wish.memo,
            linkUrl: wish.linkUrl ?? '',
          }}
        />
      </div>
    </div>
  );
}

export default async function EditWishPage({ params }: { params: Promise<{ id: string }> }) {
  if (isDemoMode()) redirect('/wishes');

  const { id } = await params;
  return (
    <LivePageFrame path={`/wishes/${encodeURIComponent(id)}/edit`} render={() => <EditWish id={id} />} />
  );
}
