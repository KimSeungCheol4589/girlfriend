/**
 * 데이트 기록 연결(DATE-001) 계약 상수.
 *
 * 기준: DESIGN.md 5.2·5.3·7, `supabase/migrations/20260925120100_memory_links_date001.sql`의
 * CHECK 제약·트리거·RPC.
 *
 * 값을 바꾸려면 마이그레이션도 함께 바꿔야 한다. 한쪽만 바꾸면 화면이 통과시킨 입력을 DB가 거부한다.
 * (공용 `src/lib/contracts.ts`는 다른 작업이 함께 쓰는 파일이라 이 작업에서 건드리지 않는다.)
 */

/** DB: memory_links_source_allowed. 한 연결 행은 **정확히 하나**의 원본을 가리킨다. */
export const MEMORY_LINK_SOURCES = ['event', 'wish'] as const;
export type MemoryLinkSource = (typeof MEMORY_LINK_SOURCES)[number];

export function isMemoryLinkSource(value: unknown): value is MemoryLinkSource {
  return typeof value === 'string' && (MEMORY_LINK_SOURCES as readonly string[]).includes(value);
}

export const SOURCE_LABELS: Record<MemoryLinkSource, string> = {
  event: '완료한 일정',
  wish: '해낸 위시',
};

/** 색상만으로 구분하지 않도록 글자와 함께 쓰는 기호(PROJECT_PLAN 5). */
export const SOURCE_ICONS: Record<MemoryLinkSource, string> = {
  event: '🗓',
  wish: '✓',
};

export const SOURCE_PICKER_LABELS: Record<MemoryLinkSource, string> = {
  event: '완료한 일정에서 찾기',
  wish: '해낸 위시에서 찾기',
};

/** 원본 상세 화면 경로. 캘린더·위시 화면은 이 작업에서 수정하지 않고 링크만 건다. */
export function sourceDetailHref(source: MemoryLinkSource, sourceId: string): string {
  return source === 'event' ? `/calendar/${sourceId}` : `/wishes/${sourceId}`;
}

/**
 * 연결 후보 목록의 한 페이지 크기.
 *
 * 완료한 일정·위시는 계속 늘어나므로 **조용히 자르지 않고** 커서로 더 불러온다
 * (추억 목록의 "더 보기"와 같은 방식).
 */
export const LINK_CANDIDATE_PAGE_SIZE = 10;

/** 후보 목록 커서 문자열의 상한. 형식이 어긋난 커서는 첫 페이지로 되돌리지 않고 빈 결과로 끝낸다. */
export const LINK_CURSOR_MAX_LENGTH = 80;
