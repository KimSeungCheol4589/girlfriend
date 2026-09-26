import type { Metadata } from 'next';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { MemoryForm } from '@/features/memories/components/MemoryForm';
import { LiveMemoryCreateScreen } from '@/features/memories/live/components/LiveMemoryScreens';
import { newMemoryPath, parseSourceQuery } from '@/features/memories/links/source';

export const metadata: Metadata = {
  title: '새 추억',
};

export const dynamic = 'force-dynamic';

export default async function NewMemoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isDemoMode()) return <MemoryForm />;

  const params = await searchParams;
  // 완료한 일정·위시에서 들어온 경우의 원본 참조. enum과 UUID만 받는다.
  const source = parseSourceQuery({ source: params.source, sourceId: params.sourceId });

  return (
    <LivePageFrame
      // 로그인 후 돌아올 경로에는 **정규화한** source query만 넣는다. 거부한 값은 붙이지 않는다.
      path={newMemoryPath(source)}
      render={() => <LiveMemoryCreateScreen source={source} />}
    />
  );
}
