import type { CalendarDate } from '@/lib/dates';

import type { MemoryLinkSource } from './constants';
import type { LinkSourceSummary } from './prefill';

/**
 * 연결 기능의 화면 계약 타입. DB 행을 서버에서 이 모양으로 옮겨 넘긴다.
 * 데모 타입(`@/lib/demo/types`)과 섞지 않는다.
 */

/** `memory_links` 한 행. 한 추억에 최대 하나다. */
export type MemoryLink = {
  memoryId: string;
  source: MemoryLinkSource;
  /** 원본 ID. `source`에 해당하는 열의 값이다. */
  sourceId: string;
  /** 마지막으로 연결을 바꾼 구성원. */
  linkedBy: string;
  updatedAt: string;
};

/**
 * 연결 조회 결과.
 *
 * **"연결 없음"과 "조회 실패"를 구분한다.** 실패를 연결 없음으로 바꾸면 사용자가 연결이
 * 사라졌다고 오해하고 다시 연결해 중복을 만든다.
 */
export type MemoryLinkResult =
  | { status: 'none' }
  | { status: 'linked'; link: MemoryLink }
  | { status: 'error'; message: string };

/** 상세 화면이 그리는 연결 카드. 원본 제목을 읽지 못해도 연결 자체는 보여 준다. */
export type LinkedSourceView = {
  link: MemoryLink;
  href: string;
  /**
   * 원본의 표시 정보. 원본을 읽지 못하면 null이고 화면은 "정보를 불러오지 못했어요"를
   * 덧붙인다(연결이 없다고 말하지 않는다).
   */
  detail: {
    title: string;
    /** 한 줄 표기(일정은 기간·시각, 위시는 계획일·분류). */
    summary: string;
    done: boolean;
  } | null;
};

/** 새 기록 화면이 받는 원본 초안. */
export type SourceDraftResult =
  | { status: 'ok'; summary: LinkSourceSummary }
  /** 없거나 다른 공간이거나 형식이 틀린 ID. */
  | { status: 'not_found' }
  /** 조회 자체가 실패했다. "연결 없음"으로 바꾸지 않는다. */
  | { status: 'error'; message: string };

/** 연결 후보(완료한 일정·위시) 한 줄. */
export type LinkCandidate = {
  source: MemoryLinkSource;
  id: string;
  title: string;
  /** 일정은 시작일, 위시는 계획일. 없으면 null. */
  date: CalendarDate | null;
  /** 보조 설명(장소·분류 등). 없으면 null. */
  detail: string | null;
  /** 이미 다른 추억이 연결돼 있는 개수. 0이면 아직 없다(연결을 막지는 않는다). */
  linkedMemoryCount: number;
};

export type LinkCandidatePage = {
  items: LinkCandidate[];
  /** 다음 페이지 커서. 없으면 마지막 페이지다. */
  nextCursor: string | null;
};

export type LinkCandidateResult =
  | ({ ok: true } & LinkCandidatePage)
  | { ok: false; message: string };

export type LinkMemoryData = {
  memoryId: string;
  /** 연결 후의 추억 version. 다음 변경에 이 값을 쓴다. */
  version: number;
  source: MemoryLinkSource;
  sourceId: string;
  /** 이전 연결을 바꿨는지. */
  replacedPreviousLink: boolean;
  /** 이미 같은 원본에 연결돼 있어 아무것도 바뀌지 않았는지. */
  alreadyLinked: boolean;
};

export type UnlinkMemoryData = {
  memoryId: string;
  version: number;
  source: MemoryLinkSource;
  sourceId: string;
};

/** 원본(일정·위시) 상세에서 보여 줄, 그 원본으로 남긴 데이트 기록 한 줄. */
export type SourceMemorySummary = {
  memoryId: string;
  title: string;
  memoryDate: CalendarDate;
  /** 사진 장수. 0이면 사진 없이 남긴 기록이다. */
  photoCount: number;
};

/**
 * 원본 상세용 조회 결과.
 *
 * 실패를 빈 목록으로 바꾸지 않는다. 연결이 사라진 것처럼 보이면 사용자가 같은 기록을 또 만든다.
 */
export type SourceMemoriesResult =
  | { ok: true; items: SourceMemorySummary[] }
  | { ok: false; message: string };
