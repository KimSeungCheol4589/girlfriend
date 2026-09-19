import type { CalendarDate } from '@/lib/dates';
import type { HomeSectionKey, ThemeKey } from '@/lib/contracts';

/**
 * 데모 전용 형태다. DESIGN.md 5.2의 DB 스키마나 7의 서버 작업 계약을 대신하지 않는다.
 * 실제 Supabase 연동을 붙일 때는 이 타입을 그대로 쓰지 말고 서버 계약 타입을 따로 정의한다.
 */

export type DemoPhoto = {
  id: string;
  /** public/ 아래의 합성 SVG 경로 또는 브라우저에서 만든 objectURL. 원격 사진을 쓰지 않는다. */
  src: string;
  alt: string;
};

export type DemoMemory = {
  id: string;
  title: string;
  body: string;
  memoryDate: CalendarDate;
  location: string | null;
  tags: string[];
  isPinned: boolean;
  photos: DemoPhoto[];
  authorName: string;
};

export type DemoRestaurant = {
  id: string;
  name: string;
  area: string;
  category: string;
  status: 'wishlist' | 'visited';
  memo: string;
};

export type DemoSpace = {
  name: string;
  introduction: string;
  relationshipStartDate: CalendarDate | null;
};

export type DemoHomeSection = {
  key: HomeSectionKey;
  visible: boolean;
};

/**
 * DESIGN.md 4.2의 저장 모델과 같은 모양이다.
 * `coverAssetId`는 Storage에 올라간 파일의 asset ID이며 데모 모드에서는 항상 null이다.
 * 브라우저에서 고른 커버 미리보기는 이 안에 넣지 않는다(아래 DemoCoverPreview 참고).
 */
export type DemoCustomization = {
  themeKey: ThemeKey;
  accentColor: string;
  coverAssetId: string | null;
  sections: DemoHomeSection[];
};

/**
 * 데모 전용 커버 미리보기.
 *
 * `objectUrl`은 이 브라우저 탭에서만 유효한 blob: 주소다.
 * 업로드하지 않으며 `coverAssetId`와 같은 값이 아니다. 저장 계약에 섞지 않는다.
 * 실제 커버 업로드는 prepareUpload/finalizeUpload/saveCustomization(DESIGN.md 7) 구현 후에 붙인다.
 */
export type DemoCoverPreview = {
  id: string;
  objectUrl: string;
  fileName: string;
  alt: string;
};

export type DemoState = {
  space: DemoSpace;
  customization: DemoCustomization;
  /** 꾸미기 계약과 분리해 둔다. 새로고침하면 사라진다. */
  coverPreview: DemoCoverPreview | null;
  memories: DemoMemory[];
  restaurants: DemoRestaurant[];
};

/** 데모 화면이 돌려주는 결과. DESIGN.md 7의 `{ ok, data }` / `{ ok, code, message }` 모양만 빌려온다. */
export type DemoResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };
