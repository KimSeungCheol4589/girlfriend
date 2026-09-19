import type { Metadata } from 'next';

import { MemoryForm } from '@/features/memories/components/MemoryForm';

export const metadata: Metadata = {
  title: '새 추억',
};

export default function NewMemoryPage() {
  return <MemoryForm />;
}
