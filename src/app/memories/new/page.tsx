import type { Metadata } from 'next';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { isDemoMode } from '@/features/auth/mode';
import { MemoryForm } from '@/features/memories/components/MemoryForm';
import { LiveMemoryCreateScreen } from '@/features/memories/live/components/LiveMemoryScreens';

export const metadata: Metadata = {
  title: '새 추억',
};

export const dynamic = 'force-dynamic';

export default function NewMemoryPage() {
  if (isDemoMode()) return <MemoryForm />;

  return <LivePageFrame path="/memories/new" render={() => <LiveMemoryCreateScreen />} />;
}
