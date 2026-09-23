import type { ThemeKey } from '@/lib/contracts';

import type { HomeSection } from './sections';

/**
 * 실제 꾸미기 데이터의 화면 계약 타입.
 * 데모 타입(`@/lib/demo/types`)과 섞지 않는다. DB 행을 서버에서 이 모양으로 옮겨 넘긴다.
 */

/** 저장된 공유 설정 한 벌(= `space_settings` 한 행). */
export type SavedCustomization = {
  themeKey: ThemeKey;
  accentColor: string;
  /** 붙어 있는 커버 파일. 없으면 null. */
  coverAssetId: string | null;
  sections: HomeSection[];
  /** 저장 직전에 읽은 버전. `expectedVersion`으로 그대로 보낸다. */
  version: number;
  /**
   * 커버를 올린 사람이 나인지. 새 커버는 올린 사람만 지정할 수 있다(CONTRACTS.md 5).
   * `null`은 **모름**이다(파일 메타데이터를 읽지 못한 경우). 안내 문구를 지어내지 않기 위해 구분한다.
   */
  coverUploadedByMe: boolean | null;
};

/** 저장 성공 결과. 커버 파일 정리는 저장과 별개로 실패할 수 있다. */
export type SaveCustomizationData = {
  version: number;
  coverAssetId: string | null;
  /** 떼어 낸 이전 커버의 Storage 정리 결과. `pending`이어도 설정 저장은 성공이다. */
  cleanup: 'none' | 'done' | 'pending';
};

export type PreparedCover = {
  assetId: string;
  bucket: string;
  objectPath: string;
};

/** 고정 후보로 보여 주는 추억 한 건. 고정 저장에 필요한 서버 스냅샷을 그대로 들고 있는다. */
export type PinCandidate = {
  id: string;
  title: string;
  memoryDate: string;
  isPinned: boolean;
  /** 서버가 렌더한 시점의 값. 고정 저장은 이 스냅샷 그대로를 보낸다. */
  snapshot: {
    title: string;
    body: string;
    memoryDate: string;
    location: string;
    tags: string[];
    photoAssetIds: string[];
    expectedVersion: number;
  };
};

export type PinCandidatePage = {
  items: PinCandidate[];
  nextCursor: string | null;
};

/**
 * 조회 실패 코드. 서버 모듈이 아니라 여기에 둬서 클라이언트 컴포넌트가
 * `server-only` 모듈을 타입 때문에 참조하지 않게 한다.
 */
export type QueryFailureCode = 'UNAUTHENTICATED' | 'CONFIG_ERROR' | 'RETRYABLE_ERROR';
export type QueryResult<T> = { ok: true; data: T } | { ok: false; code: QueryFailureCode };
