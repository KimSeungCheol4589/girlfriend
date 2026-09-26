import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { isUuid } from '@/features/memories/live/ids';
import { LiveMemoryLinkScreen } from '@/features/memories/live/components/LiveMemoryScreens';
import { memoryLinkPath, parseSourceQuery } from '@/features/memories/links/source';

export const metadata: Metadata = {
  title: '계획과 연결하기',
};

export const dynamic = 'force-dynamic';

/**
 * 기존 추억을 완료한 일정·위시와 연결하는 화면.
 *
 * 데모 모드에는 실제 저장이 없다. 저장처럼 보이지 않도록 추억 목록으로 보낸다.
 */
export default async function MemoryLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (isDemoMode()) redirect('/memories');

  const query = await searchParams;
  const source = parseSourceQuery({ source: query.source, sourceId: query.sourceId });

  // 로그인 후 돌아올 경로에는 검증한 ID와 정규화한 query만 넣는다.
  const path = isUuid(id)
    ? memoryLinkPath(id, source.status === 'ok' ? source.ref : null)
    : '/memories';

  return (
    <LivePageFrame path={path} render={() => <LiveMemoryLinkScreen memoryId={id} source={source} />} />
  );
}
