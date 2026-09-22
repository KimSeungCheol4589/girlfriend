/**
 * 실제 추억 데이터의 화면 계약 타입.
 * 데모 타입(`@/lib/demo/types`)과 섞지 않는다. DB 행을 서버에서 이 모양으로 옮겨 넘긴다.
 */

export type LiveMemoryPhoto = {
  assetId: string;
  sortOrder: number;
};

export type LiveMemory = {
  id: string;
  title: string;
  body: string;
  memoryDate: string;
  location: string | null;
  tags: string[];
  isPinned: boolean;
  version: number;
  authorId: string;
  updatedAt: string;
  /** 표시 순서(sort_order 오름차순). */
  photos: LiveMemoryPhoto[];
};

export type LiveMemoryPage = {
  items: LiveMemory[];
  /** 다음 페이지 커서. 없으면 마지막 페이지다. */
  nextCursor: string | null;
};

export type LiveFilterOptions = {
  months: string[];
  tags: string[];
};

/** 저장 후 Storage 정리 결과. 실패해도 저장 자체는 성공이다. */
export type PhotoCleanupStatus = 'none' | 'done' | 'pending';

export type SaveMemoryData = {
  memoryId: string;
  version: number;
  cleanup: PhotoCleanupStatus;
};

export type DeleteMemoryData = {
  memoryId: string;
  cleanup: PhotoCleanupStatus;
};

export type PreparedPhoto = {
  assetId: string;
  bucket: string;
  objectPath: string;
};
