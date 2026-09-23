import type { RestaurantStatus } from './constants';
import type { RestaurantCursor } from './filters';

/** 화면용 맛집 목록 항목. 사용자 입력은 모두 일반 텍스트로만 그린다. */
export type RestaurantListItem = {
  id: string;
  name: string;
  area: string;
  category: string;
  status: RestaurantStatus;
  visitedDate: string | null;
  createdAt: string;
};

export type RestaurantDetail = RestaurantListItem & {
  mapUrl: string | null;
  memo: string;
  version: number;
  createdBy: string;
  updatedAt: string;
};

export type ReviewView = {
  id: string;
  userId: string;
  rating: number;
  comment: string;
  version: number;
  updatedAt: string;
  isMine: boolean;
  /** 표시 이름(닉네임). 없으면 "상대방"/"나". */
  authorLabel: string;
};

export type RestaurantPage = {
  items: RestaurantListItem[];
  /** 다음 페이지가 없으면 null. */
  nextCursor: RestaurantCursor | null;
};

export type QueryFailure = {
  ok: false;
  /** 사람이 읽는 문장. DB 원문을 담지 않는다. */
  message: string;
  /** 로그인이 풀려 다시 로그인해야 하는지. */
  unauthenticated?: boolean;
};

export type RestaurantPageResult = ({ ok: true } & RestaurantPage) | QueryFailure;

export type RestaurantDetailResult =
  | { status: 'ok'; restaurant: RestaurantDetail; reviews: ReviewView[] }
  | { status: 'not_found' }
  | { status: 'error'; message: string };
