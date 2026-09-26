import { describe, expect, it } from 'vitest';

import {
  DATE_ORIGIN_NOTICES,
  buildMemoryPrefill,
  type LinkSourceSummary,
} from '@/features/memories/links/prefill';
import { MEMORY_LIMITS } from '@/lib/contracts';
import { saveMemoryInputSchema } from '@/features/memories/live/input-schema';
import { todayInSeoul } from '@/lib/dates';

/**
 * 완료한 일정·위시 → 추억 초안.
 *
 * 지키려는 것
 *   1. 날짜를 **확정할 수 없으면 확정한 척하지 않는다.** 한국 오늘을 임시로 넣고 그 사실을 알린다.
 *   2. 원본은 절대 바뀌지 않는다(이 함수는 순수 함수이므로 구조적으로 보장된다).
 *   3. 위시에는 장소가 없다. 메모·링크에서 유추하지 않고 빈칸으로 둔다.
 *   4. 본문은 만들지 않는다(원본 메모를 실제 경험처럼 복사하지 않는다).
 *   5. 종일 일정은 **시작일**을 쓰고, 포함 종료일은 안내로만 쓴다.
 */

const TODAY = '2026-09-25';

function eventSummary(overrides: Partial<LinkSourceSummary> = {}): LinkSourceSummary {
  return {
    source: 'event',
    id: '11111111-2222-4333-8444-555555555555',
    title: '전시 관람',
    location: '성수동',
    candidateDate: '2026-09-20',
    endDate: null,
    allDay: false,
    done: true,
    ...overrides,
  };
}

function wishSummary(overrides: Partial<LinkSourceSummary> = {}): LinkSourceSummary {
  return {
    source: 'wish',
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    title: '야시장 가기',
    location: null,
    candidateDate: '2026-09-18',
    endDate: null,
    allDay: false,
    done: true,
    ...overrides,
  };
}

describe('일정에서 만든 초안', () => {
  it('제목·장소·시작일을 채운다', () => {
    const prefill = buildMemoryPrefill(eventSummary(), TODAY);
    expect(prefill.title).toBe('전시 관람');
    expect(prefill.location).toBe('성수동');
    expect(prefill.memoryDate).toBe('2026-09-20');
    expect(prefill.dateOrigin).toBe('source');
    expect(prefill.dateNeedsConfirmation).toBe(false);
  });

  it('오늘 날짜의 일정도 그대로 쓴다(경계)', () => {
    const prefill = buildMemoryPrefill(eventSummary({ candidateDate: TODAY }), TODAY);
    expect(prefill.memoryDate).toBe(TODAY);
    expect(prefill.dateOrigin).toBe('source');
  });

  it('장소가 없으면 빈칸이다(임의로 만들지 않는다)', () => {
    expect(buildMemoryPrefill(eventSummary({ location: null }), TODAY).location).toBe('');
  });

  it('종일 여러 날 일정은 시작일을 쓰고 걸친 기간을 알린다', () => {
    const prefill = buildMemoryPrefill(
      eventSummary({ allDay: true, candidateDate: '2026-09-18', endDate: '2026-09-20' }),
      TODAY,
    );
    expect(prefill.memoryDate).toBe('2026-09-18');
    expect(prefill.spansMultipleDays).toBe(true);
    expect(prefill.sourceEndDate).toBe('2026-09-20');
  });

  it('하루 종일 일정(시작=포함 종료일)은 여러 날로 보지 않는다', () => {
    const prefill = buildMemoryPrefill(
      eventSummary({ allDay: true, candidateDate: '2026-09-19', endDate: '2026-09-19' }),
      TODAY,
    );
    expect(prefill.spansMultipleDays).toBe(false);
  });

  it('시간 일정은 종료일 안내를 만들지 않는다', () => {
    const prefill = buildMemoryPrefill(
      eventSummary({ allDay: false, candidateDate: '2026-09-19', endDate: null }),
      TODAY,
    );
    expect(prefill.spansMultipleDays).toBe(false);
    expect(prefill.sourceEndDate).toBeNull();
  });

  it('앞날 시작일은 임시 기본값(오늘)으로 바꾸고 확인을 요청한다', () => {
    const prefill = buildMemoryPrefill(eventSummary({ candidateDate: '2026-12-31' }), TODAY);
    expect(prefill.memoryDate).toBe(TODAY);
    expect(prefill.dateOrigin).toBe('future');
    expect(prefill.dateNeedsConfirmation).toBe(true);
  });
});

describe('위시에서 만든 초안', () => {
  it('계획일을 쓰고 장소는 비워 둔다', () => {
    const prefill = buildMemoryPrefill(wishSummary(), TODAY);
    expect(prefill.memoryDate).toBe('2026-09-18');
    expect(prefill.dateOrigin).toBe('source');
    expect(prefill.location).toBe('');
  });

  it('계획일이 없으면 오늘을 임시로 넣고 확인을 요청한다', () => {
    const prefill = buildMemoryPrefill(wishSummary({ candidateDate: null }), TODAY);
    expect(prefill.memoryDate).toBe(TODAY);
    expect(prefill.dateOrigin).toBe('missing');
    expect(prefill.dateNeedsConfirmation).toBe(true);
  });

  it('계획일이 앞날이면 오늘을 임시로 넣는다(계획일은 바꾸지 않는다)', () => {
    const summary = wishSummary({ candidateDate: '2027-01-01' });
    const prefill = buildMemoryPrefill(summary, TODAY);
    expect(prefill.memoryDate).toBe(TODAY);
    expect(prefill.dateOrigin).toBe('future');
    // 원본 스냅샷은 그대로다(순수 함수).
    expect(summary.candidateDate).toBe('2027-01-01');
  });

  it('형식이 깨진 계획일은 오늘로 물러난다', () => {
    for (const bad of ['2026-02-30', '2026-13-01', 'yesterday', '']) {
      const prefill = buildMemoryPrefill(wishSummary({ candidateDate: bad }), TODAY);
      expect(prefill.memoryDate).toBe(TODAY);
      expect(prefill.dateOrigin).toBe('missing');
    }
  });

  it('여러 날 안내는 위시에 쓰이지 않는다', () => {
    expect(buildMemoryPrefill(wishSummary(), TODAY).spansMultipleDays).toBe(false);
  });
});

describe('제목 상한', () => {
  it('100자 원본 제목을 80자로 줄이고 알린다', () => {
    const prefill = buildMemoryPrefill(eventSummary({ title: '가'.repeat(100) }), TODAY);
    expect(prefill.title).toHaveLength(MEMORY_LIMITS.titleMax);
    expect(prefill.titleTruncated).toBe(true);
  });

  it('이모지 제목도 JS·DB 두 제한을 모두 통과한다', () => {
    const prefill = buildMemoryPrefill(eventSummary({ title: '😀'.repeat(100) }), TODAY);
    expect(prefill.title.length).toBeLessThanOrEqual(MEMORY_LIMITS.titleMax);
    expect(Array.from(prefill.title).length).toBeLessThanOrEqual(MEMORY_LIMITS.titleMax);
    expect(prefill.titleTruncated).toBe(true);
  });

  it('줄이지 않았으면 안내하지 않는다', () => {
    expect(buildMemoryPrefill(eventSummary(), TODAY).titleTruncated).toBe(false);
  });
});

describe('초안은 실제 저장 검증을 통과한다', () => {
  const base = {
    memoryId: null,
    body: '',
    tags: [],
    photoAssetIds: [],
    isPinned: false,
    expectedVersion: 0,
    requestId: '11111111-2222-4333-8444-555555555555',
  };

  it('오늘 기준 초안이 Zod 검증을 통과한다(미래 날짜가 아니다)', () => {
    const today = todayInSeoul();
    for (const summary of [
      eventSummary({ title: '😀'.repeat(100), candidateDate: null }),
      eventSummary({ candidateDate: '2099-01-01' }),
      wishSummary({ candidateDate: null }),
      wishSummary({ title: '가'.repeat(100) }),
    ]) {
      const prefill = buildMemoryPrefill(summary, today);
      const parsed = saveMemoryInputSchema.safeParse({
        ...base,
        title: prefill.title,
        memoryDate: prefill.memoryDate,
        location: prefill.location,
      });
      expect(parsed.success, `원본 ${summary.source}`).toBe(true);
    }
  });
});

describe('임시 날짜 안내 문장', () => {
  it('원본 날짜를 쓴 경우에는 안내가 없다', () => {
    expect(DATE_ORIGIN_NOTICES.source).toBeNull();
  });

  it('없음·앞날일 때는 "임시"임을 분명히 적는다', () => {
    for (const origin of ['missing', 'future'] as const) {
      const notice = DATE_ORIGIN_NOTICES[origin];
      expect(notice).not.toBeNull();
      expect(notice).toContain('임시');
      expect(notice).toContain('실제로 다녀온 날');
    }
  });

  it('앞날 안내는 계획을 바꾸지 않았다고 알린다', () => {
    expect(DATE_ORIGIN_NOTICES.future).toContain('바꾸지 않았어요');
  });
});
