import { MEMORY_LIMITS } from '@/lib/contracts';
import { isCalendarDate, todayInSeoul, type CalendarDate } from '@/lib/dates';

import type { MemoryLinkSource } from './constants';
import { fitLocation, fitTitle } from './title';

/**
 * 완료한 일정·위시에서 추억 초안 만들기 — 순수 함수.
 *
 * 원칙(DATE-001)
 *   - **원본을 바꾸지 않는다.** 날짜를 모른다고 해서 일정·위시의 계획일을 고치지 않는다.
 *   - 날짜를 확정할 수 없으면 한국 오늘을 **임시 기본값**으로 채우고 그 사실을 알린다.
 *     "저장하면 그날로 기록된다"를 조용히 결정하지 않는다.
 *   - 본문은 만들지 않는다. 원본 메모를 실제 경험처럼 복사하지 않는다(연결 카드에서 참고만 한다).
 *   - 위시에는 장소 열이 없다. 빈칸으로 두고 추측하지 않는다(메모·링크에서 장소를 유추하지 않는다).
 */

/** 서버가 원본 상세에서 뽑아 넘기는 최소 사실. 화면 문구·권한 판단은 담지 않는다. */
export type LinkSourceSummary = {
  source: MemoryLinkSource;
  id: string;
  /** 원본 제목 원문(자르지 않은 값). */
  title: string;
  /** 일정의 장소. **위시는 항상 null**이다(열이 없다). */
  location: string | null;
  /**
   * 날짜 후보. 일정은 시작일(한국 시간), 위시는 계획일이다.
   * 위시의 계획일은 비어 있거나 미래일 수 있다.
   */
  candidateDate: string | null;
  /** 종일 일정의 **포함** 종료일. 하루 일정은 시작일과 같고, 위시는 null이다. */
  endDate: string | null;
  allDay: boolean;
  /** 원본이 완료(done) 상태인지. false면 연결할 수 없다. */
  done: boolean;
};

/** 날짜를 어떻게 정했는지. 화면이 이 값으로 안내 문장을 고른다. */
export type PrefillDateOrigin =
  /** 원본의 날짜를 그대로 썼다. */
  | 'source'
  /** 원본에 날짜가 없어 한국 오늘을 임시로 채웠다. */
  | 'missing'
  /** 원본의 날짜가 앞날이라(추억은 미래 날짜를 저장할 수 없다) 한국 오늘을 임시로 채웠다. */
  | 'future';

export type MemoryPrefill = {
  title: string;
  /** 제목이 80자 상한 때문에 줄었는지. */
  titleTruncated: boolean;
  location: string;
  locationTruncated: boolean;
  memoryDate: CalendarDate;
  dateOrigin: PrefillDateOrigin;
  /** 사용자가 실제 날짜를 확인해야 하는지(`source`가 아니면 항상 true). */
  dateNeedsConfirmation: boolean;
  /** 여러 날에 걸친 종일 일정이라 **시작일**을 골랐는지. */
  spansMultipleDays: boolean;
  /** 원본이 준 종료일(여러 날 일정 안내에 쓴다). */
  sourceEndDate: string | null;
};

export function buildMemoryPrefill(
  summary: LinkSourceSummary,
  today: CalendarDate = todayInSeoul(),
): MemoryPrefill {
  const title = fitTitle(summary.title, MEMORY_LIMITS.titleMax);
  const location = fitLocation(summary.location, MEMORY_LIMITS.locationMax);

  let memoryDate = today;
  let dateOrigin: PrefillDateOrigin = 'missing';
  const candidate = summary.candidateDate;
  if (candidate !== null && isCalendarDate(candidate)) {
    // 문자열 비교가 날짜 순서와 같다(YYYY-MM-DD).
    if (candidate <= today) {
      memoryDate = candidate;
      dateOrigin = 'source';
    } else {
      dateOrigin = 'future';
    }
  }

  const spansMultipleDays =
    summary.allDay &&
    summary.endDate !== null &&
    candidate !== null &&
    summary.endDate !== candidate;

  return {
    title: title.value,
    titleTruncated: title.truncated,
    location: location.value,
    locationTruncated: location.truncated,
    memoryDate,
    dateOrigin,
    dateNeedsConfirmation: dateOrigin !== 'source',
    spansMultipleDays,
    sourceEndDate: summary.endDate,
  };
}

/** 임시 날짜 안내 문장. `source`면 안내가 필요 없다. */
export const DATE_ORIGIN_NOTICES: Record<PrefillDateOrigin, string | null> = {
  source: null,
  missing:
    '이 계획에는 날짜가 없어 오늘(한국 날짜)을 임시로 넣어 두었어요. 실제로 다녀온 날로 바꿔 주세요.',
  future:
    '이 계획의 날짜가 앞날이라 그대로 쓸 수 없어 오늘(한국 날짜)을 임시로 넣어 두었어요. 실제로 다녀온 날로 바꿔 주세요. 계획의 날짜는 바꾸지 않았어요.',
};
