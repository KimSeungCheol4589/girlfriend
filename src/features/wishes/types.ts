import type { WishCategory, WishStatus } from './constants';
import type { WishCursor } from './filters';

/** 화면용 위시 목록 항목. 사용자 입력은 모두 일반 텍스트로만 그린다. */
export type WishListItem = {
  id: string;
  title: string;
  category: WishCategory;
  status: WishStatus;
  plannedDate: string | null;
  createdAt: string;
};

export type WishDetail = WishListItem & {
  memo: string;
  linkUrl: string | null;
  version: number;
  createdBy: string;
  updatedAt: string;
  /** 만든 사람의 표시 이름. 닉네임이 없으면 "나"/"상대방". */
  createdByLabel: string;
};

export type WishPage = {
  items: WishListItem[];
  /** 다음 페이지가 없으면 null. */
  nextCursor: WishCursor | null;
};

export type QueryFailure = {
  ok: false;
  /** 사람이 읽는 문장. DB 원문을 담지 않는다. */
  message: string;
  /** 로그인이 풀려 다시 로그인해야 하는지. */
  unauthenticated?: boolean;
};

export type WishPageResult = ({ ok: true } & WishPage) | QueryFailure;

export type WishDetailResult =
  | { status: 'ok'; wish: WishDetail }
  | { status: 'not_found' }
  | { status: 'error'; message: string };
