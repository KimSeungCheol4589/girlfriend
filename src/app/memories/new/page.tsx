import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { isDemoMode } from '@/features/auth/mode';
import { MemoryForm } from '@/features/memories/components/MemoryForm';

export const metadata: Metadata = {
  title: '새 추억',
};

export const dynamic = 'force-dynamic';

export default function NewMemoryPage() {
  // 실제 모드에는 아직 작성 화면이 없다. 데모 폼을 대신 보여 주지 않는다.
  if (!isDemoMode()) redirect('/memories');

  return <MemoryForm />;
}
