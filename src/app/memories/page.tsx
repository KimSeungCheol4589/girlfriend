import type { Metadata } from 'next';

import { LivePageFrame } from '@/features/auth/components/LivePageFrame';
import { LivePendingFeature } from '@/features/auth/components/LivePendingFeature';
import { isDemoMode } from '@/features/auth/mode';
import { MemoriesView } from '@/features/memories/components/MemoriesView';
import { parseMemoryFilters } from '@/features/memories/filters';

export const metadata: Metadata = {
  title: '추억',
};

export const dynamic = 'force-dynamic';

export default async function MemoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isDemoMode()) {
    // DESIGN.md 3: 필터는 URL 검색 매개변수에 담아 뒤로 가기에도 유지한다.
    const params = await searchParams;
    const filters = parseMemoryFilters({ month: params.month, tag: params.tag });
    return <MemoriesView filters={filters} />;
  }

  return (
    <LivePageFrame
      path="/memories"
      render={() => (
        <LivePendingFeature
          title="추억"
          summary="사진과 글로 두 사람의 기록을 남기는 화면입니다. 로그인·공간 연결까지 끝났고 실제 기록 저장은 아직 만들지 않았습니다."
          plannedItems={[
            '추억 작성·수정·삭제와 사진 업로드',
            '월·태그 필터와 20개씩 더 보기',
            '두 사람이 같은 기록을 볼 때의 버전 충돌 처리',
          ]}
          taskNote="이 화면은 MEM-001 작업에서 만듭니다. 로그인한 화면에서는 예시 데이터를 실제 기록처럼 보여 주지 않습니다."
        />
      )}
    />
  );
}
