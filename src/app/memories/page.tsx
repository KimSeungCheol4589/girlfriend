import type { Metadata } from 'next';

import { MemoriesView } from '@/features/memories/components/MemoriesView';
import { parseMemoryFilters } from '@/features/memories/filters';

export const metadata: Metadata = {
  title: '추억',
};

export default async function MemoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // DESIGN.md 3: 필터는 URL 검색 매개변수에 담아 뒤로 가기에도 유지한다.
  const params = await searchParams;
  const filters = parseMemoryFilters({ month: params.month, tag: params.tag });

  return <MemoriesView filters={filters} />;
}
