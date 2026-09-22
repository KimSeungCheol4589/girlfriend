import type { Metadata } from 'next';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { MemoryDetailView } from '@/features/memories/components/MemoryDetailView';
import { isUuid } from '@/features/memories/live/ids';
import {
  LiveMemoryDetailScreen,
  parseDetailNotice,
} from '@/features/memories/live/components/LiveMemoryScreens';

export const metadata: Metadata = {
  title: '추억 상세',
};

export const dynamic = 'force-dynamic';

export default async function MemoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (isDemoMode()) return <MemoryDetailView memoryId={id} />;

  const notice = parseDetailNotice((await searchParams).notice);
  // 로그인 후 돌아올 경로에는 검증한 ID만 넣는다.
  const path = isUuid(id) ? `/memories/${id}` : '/memories';

  return (
    <LivePageFrame
      path={path}
      render={(context) => <LiveMemoryDetailScreen memoryId={id} context={context} notice={notice} />}
    />
  );
}
