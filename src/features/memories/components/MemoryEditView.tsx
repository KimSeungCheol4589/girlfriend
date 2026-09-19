'use client';

import Link from 'next/link';

import { MemoryForm } from '@/features/memories/components/MemoryForm';
import { useDemoStore } from '@/lib/demo/demo-store';

export function MemoryEditView({ memoryId }: { memoryId: string }) {
  const { state } = useDemoStore();
  const memory = state.memories.find((item) => item.id === memoryId);

  if (!memory) {
    return (
      <div className="app-card px-6 py-14 text-center">
        <span aria-hidden className="text-2xl">
          🔍
        </span>
        <h1 className="mt-2 text-xl font-bold text-text">수정할 기록을 찾지 못했어요</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          지워졌거나 주소가 잘못됐을 수 있어요. 목록에서 다시 골라 주세요.
        </p>
        <Link href="/memories" className="btn-primary mt-6">
          추억 목록으로
        </Link>
      </div>
    );
  }

  return <MemoryForm memory={memory} />;
}
