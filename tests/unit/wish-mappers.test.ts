import { describe, expect, it } from 'vitest';

import { buildPage, toDetail, toListItem } from '@/features/wishes/mappers';

/**
 * DB 행 → 화면 모델 변환 단위 테스트.
 *
 * 핵심 규칙: 계약과 다른 행은 조용히 기본값으로 바꾸지 않고 null을 돌려준다.
 * 호출자가 그 행을 "조회 실패"로 다루기 때문에, 실패가 빈 목록처럼 보이지 않는다.
 */

const ID = '3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69';
const USER_A = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const USER_B = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    title: '한강 가기',
    category: 'activity',
    status: 'planned',
    planned_date: '2099-01-01',
    created_at: '2026-09-23T01:02:03.123456+00:00',
    ...overrides,
  };
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return row({
    memo: '자전거',
    link_url: 'https://example.invalid/a',
    version: 3,
    created_by: USER_A,
    updated_at: '2026-09-23T02:00:00+00:00',
    ...overrides,
  });
}

describe('toListItem', () => {
  it('열 이름을 화면 모델로 옮긴다', () => {
    expect(toListItem(row())).toEqual({
      id: ID,
      title: '한강 가기',
      category: 'activity',
      status: 'planned',
      plannedDate: '2099-01-01',
      createdAt: '2026-09-23T01:02:03.123456+00:00',
    });
  });

  it('계획일 없음은 null이다', () => {
    expect(toListItem(row({ planned_date: null }))?.plannedDate).toBeNull();
  });

  it('빈 제목은 유효한 값이다(길이 검증은 DB가 한다)', () => {
    expect(toListItem(row({ title: '' }))?.title).toBe('');
  });

  it('모르는 상태·분류는 null(조회 실패)로 돌려준다', () => {
    expect(toListItem(row({ status: 'archived' }))).toBeNull();
    expect(toListItem(row({ category: 'restaurant' }))).toBeNull();
  });

  it('필수 열이 없거나 형식이 다르면 null이다', () => {
    expect(toListItem(row({ id: undefined }))).toBeNull();
    expect(toListItem(row({ created_at: 42 }))).toBeNull();
    expect(toListItem(row({ title: null }))).toBeNull();
  });
});

describe('toDetail', () => {
  const nicknames = new Map<string, string | null>([
    [USER_A, '에이'],
    [USER_B, null],
  ]);

  it('상세 열을 옮기고 닉네임을 붙인다', () => {
    expect(toDetail(detailRow(), USER_B, nicknames)).toEqual({
      id: ID,
      title: '한강 가기',
      category: 'activity',
      status: 'planned',
      plannedDate: '2099-01-01',
      createdAt: '2026-09-23T01:02:03.123456+00:00',
      memo: '자전거',
      linkUrl: 'https://example.invalid/a',
      version: 3,
      createdBy: USER_A,
      updatedAt: '2026-09-23T02:00:00+00:00',
      createdByLabel: '에이',
    });
  });

  it('닉네임이 없으면 나/상대방으로 표시한다', () => {
    const empty = new Map<string, string | null>();
    expect(toDetail(detailRow(), USER_A, empty)?.createdByLabel).toBe('나');
    expect(toDetail(detailRow(), USER_B, empty)?.createdByLabel).toBe('상대방');
  });

  it('메모·링크가 비어 있어도 안전한 기본값을 준다', () => {
    const mapped = toDetail(detailRow({ memo: null, link_url: null }), USER_A, nicknames);
    expect(mapped?.memo).toBe('');
    expect(mapped?.linkUrl).toBeNull();
  });

  it('버전·작성자가 빠지면 null이다', () => {
    expect(toDetail(detailRow({ version: '3' }), USER_A, nicknames)).toBeNull();
    expect(toDetail(detailRow({ created_by: undefined }), USER_A, nicknames)).toBeNull();
  });
});

describe('buildPage', () => {
  function rows(count: number) {
    return Array.from({ length: count }, (_, index) =>
      row({
        id: `3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a${String(index).padStart(2, '0')}`,
        created_at: `2026-09-2${index % 9}T01:02:03+00:00`,
      }),
    );
  }

  it('pageSize만큼 자르고 다음 커서를 만든다', () => {
    const page = buildPage(rows(4), 3);
    expect(page?.items).toHaveLength(3);
    expect(page?.nextCursor).toEqual({
      createdAt: page?.items[2]?.createdAt,
      id: page?.items[2]?.id,
    });
  });

  it('더 없으면 커서는 null이다', () => {
    expect(buildPage(rows(2), 3)?.nextCursor).toBeNull();
    expect(buildPage([], 3)).toEqual({ items: [], nextCursor: null });
  });

  it('행 하나라도 형식이 어긋나면 페이지 전체가 null(조회 실패)이다', () => {
    const broken = [row(), row({ status: 'archived' })];
    expect(buildPage(broken, 10)).toBeNull();
  });
});
