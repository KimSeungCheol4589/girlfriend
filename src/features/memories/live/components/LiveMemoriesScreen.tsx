import { buildMemoriesHref, type MemoryFilters } from '@/features/memories/filters';

import { listFilterOptions, listMemoriesPage } from '../../server/queries';

import { LiveMemoriesList } from './LiveMemoriesList';
import { QueryFailure } from './QueryFailure';

/** 실제 추억 목록 화면(서버). 첫 페이지와 필터 선택지를 사용자 세션으로 읽는다. */
export async function LiveMemoriesScreen({ filters }: { filters: MemoryFilters }) {
  const [page, options] = await Promise.all([
    listMemoriesPage({ month: filters.month, tag: filters.tag, cursor: null }),
    listFilterOptions(),
  ]);

  if (!page.ok) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-text">추억</h1>
        <QueryFailure code={page.code} />
      </div>
    );
  }

  return (
    <LiveMemoriesList
      // 필터나 첫 페이지 내용이 바뀌면 새로 만든다. 이전 커서·더 보기 결과가 섞이지 않는다.
      key={`${buildMemoriesHref(filters)}#${page.data.items.map((item) => `${item.id}:${item.version}`).join('|')}`}
      filters={filters}
      initialPage={page.data}
      options={options.ok ? options.data : null}
    />
  );
}
