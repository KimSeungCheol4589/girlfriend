import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { isDemoMode } from '@/features/auth/mode';
import { MemoryEditView } from '@/features/memories/components/MemoryEditView';

export const metadata: Metadata = {
  title: '기록 수정',
};

export const dynamic = 'force-dynamic';

export default async function EditMemoryPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isDemoMode()) redirect('/memories');

  const { id } = await params;
  return <MemoryEditView memoryId={id} />;
}
