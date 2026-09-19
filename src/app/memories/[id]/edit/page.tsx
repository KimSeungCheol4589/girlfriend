import type { Metadata } from 'next';

import { MemoryEditView } from '@/features/memories/components/MemoryEditView';

export const metadata: Metadata = {
  title: '기록 수정',
};

export default async function EditMemoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MemoryEditView memoryId={id} />;
}
