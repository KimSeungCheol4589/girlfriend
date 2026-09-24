import { describe, expect, it } from 'vitest';

import {
  EVENT_STATUSES,
  STATUS_ACTION_LABELS,
  nextStatusChoices,
} from '@/features/calendar/constants';

/**
 * 상태 버튼 목록 규칙 (독립 검토 P3-5 관련).
 *
 * 화면은 **서버가 가진 상태**를 이 함수에 넘긴다. 지금 상태 자신이 버튼으로 남으면
 * "지금 상태: 완료"와 "완료로 바꾸기"가 함께 보이는 자기모순이 된다.
 * E2E로는 그 짧은 창을 결정적으로 볼 수 없어(App Router가 재렌더를 같은 응답으로 돌려준다),
 * 규칙 자체를 여기서 고정한다.
 */

describe('nextStatusChoices', () => {
  it('지금 상태는 고를 수 없다', () => {
    for (const status of EVENT_STATUSES) {
      expect(nextStatusChoices(status), status).not.toContain(status);
    }
  });

  it('나머지 상태는 모두 고를 수 있다', () => {
    expect(nextStatusChoices('scheduled')).toEqual(['done', 'cancelled']);
    expect(nextStatusChoices('done')).toEqual(['scheduled', 'cancelled']);
    expect(nextStatusChoices('cancelled')).toEqual(['scheduled', 'done']);
  });

  it('언제나 상태 수보다 하나 적다', () => {
    for (const status of EVENT_STATUSES) {
      expect(nextStatusChoices(status)).toHaveLength(EVENT_STATUSES.length - 1);
    }
  });

  it('고른 상태마다 버튼 글자가 있다(조사를 조립하지 않는다)', () => {
    for (const status of EVENT_STATUSES) {
      for (const choice of nextStatusChoices(status)) {
        expect(STATUS_ACTION_LABELS[choice]).toMatch(/바꾸기$/);
      }
    }
    // 받침 있는 낱말에는 `으로`가 붙는다. `${라벨}로 바꾸기`로 조립하면 "예정로"가 된다.
    expect(STATUS_ACTION_LABELS.scheduled).toBe('예정으로 바꾸기');
    expect(STATUS_ACTION_LABELS.done).toBe('완료로 바꾸기');
    expect(STATUS_ACTION_LABELS.cancelled).toBe('취소로 바꾸기');
  });

  it('상태 목록 순서를 유지한다(버튼 순서가 흔들리지 않게)', () => {
    const order = [...EVENT_STATUSES];
    for (const status of EVENT_STATUSES) {
      const choices = nextStatusChoices(status);
      const expected = order.filter((value) => value !== status);
      expect(choices).toEqual(expected);
    }
  });
});
