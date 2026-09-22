import type { Metadata } from 'next';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { MemoryEditView } from '@/features/memories/components/MemoryEditView';
import { isUuid } from '@/features/memories/live/ids';
import { LiveMemoryEditScreen } from '@/features/memories/live/components/LiveMemoryScreens';

export const metadata: Metadata = {
  title: '기록 수정',
};

export const dynamic = 'force-dynamic';

export default async function EditMemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isDemoMode()) return <MemoryEditView memoryId={id} />;

  const path = isUuid(id) ? `/memories/${id}/edit` : '/memories';
  return <LivePageFrame path={path} render={() => <LiveMemoryEditScreen memoryId={id} />} />;
}
