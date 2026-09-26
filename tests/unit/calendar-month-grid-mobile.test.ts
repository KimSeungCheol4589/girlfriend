import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 월 보기가 좁은 화면에서 가로 스크롤을 만들지 않도록 지키는 두 장치.
 *
 * ## 왜 이 테스트인가 (실측 근거)
 *
 * 캘린더 스위트에는 모바일 뷰포트 검증이 없었다(`tests/calendar/playwright.config.ts`는 1280×900만 쓴다).
 * QA 보강에서 375px 검사를 붙이며 월 보기를 실제로 재 봤다. 제품의 클래스 문자열을 그대로 옮긴 복제
 * DOM을 Chromium 375×812에서 측정한 결과:
 *
 *   - 공백 없는 40자 제목이 붙은 일정 칩은 칸 밖으로 **약 267px** 삐져나간다.
 *   - 그래도 문서 가로 스크롤은 생기지 않는다(`documentElement.scrollWidth = 375`).
 *     `table-fixed`가 표 너비를 컨테이너(341px)에 묶고, 래퍼의 `overflow-hidden`이 남은 삐져나감을 자른다.
 *   - `table-fixed`만 빼면 표가 **603px**로 벌어진다(래퍼가 자르므로 문서 스크롤은 그대로).
 *
 * 즉 두 클래스가 **함께** 모바일 배치를 지탱한다. 하나만 남아도 지금은 문서 스크롤이 생기지 않지만,
 * 둘 다 사라지면 화면 밖으로 밀려 누를 수 없는 영역이 생긴다. 실행 없이도 지켜지도록 소스로 고정한다.
 *
 * 내용을 숨겨서 통과시키는 것이 아니다: 칩은 `truncate`로 줄이고 `title` 속성에 전체 제목을 남기며,
 * 일정 상세 화면(`EventDetailView`)은 `break-words`로 제목 전체를 보여 준다.
 */

const SOURCE = readFileSync(
  resolve(__dirname, '..', '..', 'src/features/calendar/components/MonthGrid.tsx'),
  'utf8',
);

describe('월 보기 모바일 배치 장치', () => {
  it('표를 컨테이너 너비에 묶는다 (table-fixed + w-full)', () => {
    expect(SOURCE).toMatch(/<table className="w-full table-fixed border-collapse">/);
  });

  it('표 래퍼가 삐져나간 내용을 자른다 (overflow-hidden)', () => {
    expect(SOURCE).toMatch(/<div className="app-card overflow-hidden p-0">/);
  });

  it('일정 칩은 줄이고, 전체 제목은 title 속성으로 남긴다', () => {
    // 줄이기만 하고 전체 내용을 잃지 않는다.
    expect(SOURCE).toMatch(/className=\{`block truncate rounded-md/);
    expect(SOURCE).toMatch(/title=\{event\.title\}/);
  });

  it('칸이 배정된 너비보다 줄어들 수 있다 (min-w-0)', () => {
    expect(SOURCE).toMatch(/h-\[6\.5rem\] min-w-0 border-b border-r border-border/);
  });
});
