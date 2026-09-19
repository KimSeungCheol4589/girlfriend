import type { Metadata } from 'next';

import { MemoryDetailView } from '@/features/memories/components/MemoryDetailView';

export const metadata: Metadata = {
  title: '추억 상세',
};

export default async function MemoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MemoryDetailView memoryId={id} />;
}
