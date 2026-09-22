import type { Metadata } from 'next';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { MemoriesView } from '@/features/memories/components/MemoriesView';
import { parseMemoryFilters } from '@/features/memories/filters';
import { LiveMemoriesScreen } from '@/features/memories/live/components/LiveMemoriesScreen';

export const metadata: Metadata = {
  title: '추억',
};

export const dynamic = 'force-dynamic';

function ListNotice({ notice }: { notice: string | undefined }) {
  if (notice !== 'deleted' && notice !== 'deleted-cleanup-pending') return null;
  return (
    <p role="status" className="mb-4 rounded-card border border-border bg-surface-muted px-4 py-3 text-sm text-text">
      기록을 지웠어요. 두 사람 모두에게서 사라졌습니다.
      {notice === 'deleted-cleanup-pending'
        ? ' 사진 파일 정리는 끝나지 않아 나중에 다시 정리합니다(누구에게도 보이지 않아요).'
        : ''}
    </p>
  );
}

export default async function MemoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // DESIGN.md 3: 필터는 URL 검색 매개변수에 담아 뒤로 가기에도 유지한다.
  const params = await searchParams;
  const filters = parseMemoryFilters({ month: params.month, tag: params.tag });

  if (isDemoMode()) {
    return <MemoriesView filters={filters} />;
  }

  const notice = Array.isArray(params.notice) ? params.notice[0] : params.notice;

  return (
    <LivePageFrame
      path="/memories"
      render={() => (
        <>
          <ListNotice notice={notice} />
          <LiveMemoriesScreen filters={filters} />
        </>
      )}
    />
  );
}
