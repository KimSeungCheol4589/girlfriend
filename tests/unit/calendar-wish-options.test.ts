import { describe, expect, it } from 'vitest';

import { withLinkedWishOption } from '@/features/calendar/wish-options';

import type { WishOption } from '@/features/calendar/types';

/**
 * 수정 화면의 위시 선택지 (독립 검토 P3-1 회귀).
 *
 * 선택지는 최근 100건만 가져온다. 연결된 위시가 그 목록에 없으면 `<select>`가 아무것도 고르지 않은 것처럼
 * 보인다. 목록이 성공했든 실패했든 연결된 위시는 언제나 고를 수 있어야 한다.
 */

const options: WishOption[] = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', title: '최근 위시 1', status: 'wish' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', title: '최근 위시 2', status: 'planned' },
];

const LINKED_ID = 'bbbbbbbb-0000-4000-8000-000000000009';

describe('withLinkedWishOption', () => {
  it('연결이 없으면 목록을 그대로 쓴다', () => {
    expect(withLinkedWishOption(options, { id: null, title: null })).toEqual(options);
  });

  it('연결된 위시가 이미 목록에 있으면 덧붙이지 않는다', () => {
    const result = withLinkedWishOption(options, {
      id: options[1]!.id,
      title: options[1]!.title,
    });
    expect(result).toEqual(options);
    expect(result.filter((option) => option.id === options[1]!.id)).toHaveLength(1);
  });

  it('상한 밖의 연결된 위시를 맨 앞에 끼워 넣는다', () => {
    const result = withLinkedWishOption(options, { id: LINKED_ID, title: '오래된 위시' });
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: LINKED_ID, title: '오래된 위시', status: 'wish' });
    // 기존 선택지는 순서 그대로 남는다.
    expect(result.slice(1)).toEqual(options);
  });

  it('제목을 읽지 못했으면 자리표시 이름을 쓴다(빈 칸으로 보이지 않게)', () => {
    const result = withLinkedWishOption(options, { id: LINKED_ID, title: null });
    expect(result[0]?.title).toBe('연결된 위시');
  });

  it('목록 조회가 실패해 비어 있어도 연결된 위시는 고를 수 있다', () => {
    const result = withLinkedWishOption([], { id: LINKED_ID, title: '오래된 위시' });
    expect(result).toEqual([{ id: LINKED_ID, title: '오래된 위시', status: 'wish' }]);
  });

  it('목록도 비고 연결도 없으면 빈 선택지다', () => {
    expect(withLinkedWishOption([], { id: null, title: null })).toEqual([]);
  });

  it('받은 배열을 바꾸지 않는다', () => {
    const input: WishOption[] = [...options];
    withLinkedWishOption(input, { id: LINKED_ID, title: '오래된 위시' });
    expect(input).toEqual(options);
  });
});
