import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { isDemoMode } from '@/features/auth/mode';
import { MemoryDetailView } from '@/features/memories/components/MemoryDetailView';

export const metadata: Metadata = {
  title: '추억 상세',
};

export const dynamic = 'force-dynamic';

export default async function MemoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isDemoMode()) redirect('/memories');

  const { id } = await params;
  return <MemoryDetailView memoryId={id} />;
}
