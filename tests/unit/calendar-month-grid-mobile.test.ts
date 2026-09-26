import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 월 보기 일정 칩이 좁은 화면에서 문서 가로 스크롤을 만들지 않게 하는 **한 가지** 조건.
 *
 * ## 무엇이 깨졌었나 (실측)
 *
 * 칩은 `truncate`(=`overflow: hidden`)로 긴 제목을 자른다. 그런데 칩 안의 완료·취소 배지는
 * Tailwind `sr-only`, 즉 **`position: absolute`**다. CSS에서 `overflow: hidden`은
 * **자기가 컨테이닝 블록이 아닌** 조상일 때 절대 배치 자손을 자르지 않는다. 칩이 정적 배치였으므로
 * 배지의 컨테이닝 블록은 칩이 아니었고, 긴 제목 뒤로 밀려난 배지가 **칩의 자르기를 그대로 통과해**
 * 문서 스크롤 폭을 늘렸다.
 *
 * Chromium 375×812에서 이 파일의 실제 클래스 구조로 재현했다(공백 없는 40자 제목 + 완료 배지).
 *
 *   칩에 `relative` 없음 → `documentElement.scrollWidth = 577` (clientWidth 375)
 *   칩에 `relative` 있음 → `documentElement.scrollWidth = 375`
 *
 * 두 경우 모두 배지의 `getBoundingClientRect().right`는 577이다. 달라지는 것은 **누가 자르는가**뿐이다.
 * 실제 Windows 실행에서는 같은 원인으로 661px이 측정됐다(글꼴 폭 차이).
 *
 * ## 그래서 고정하는 것
 *
 * 칩은 **자르기(`truncate`)와 컨테이닝 블록(`relative`)을 함께** 가져야 한다. 하나라도 빠지면
 * 절대 배치 배지가 다시 새어 나간다. 다른 배치 클래스(`table-fixed`·`min-w-0` 등)는 이 현상과
 * 인과가 확인되지 않았으므로 고정하지 않는다.
 *
 * 내용을 숨겨 통과시키는 것이 아니다: 배지는 접근성 트리에 그대로 남고(시각적으로만 잘린다),
 * 제목 전체는 `title` 속성과 일정 상세 화면(`break-words`)에서 볼 수 있다.
 *
 * 실제 렌더 회귀는 QA 보강 스위트의 375px 검사가 담당한다(실제 DB가 필요해 총괄이 실행한다).
 */

const SOURCE = readFileSync(
  resolve(__dirname, '..', '..', 'src/features/calendar/components/MonthGrid.tsx'),
  'utf8',
);

/** 월 보기 일정 칩(`<Link data-testid="calendar-day-event">`)의 여는 태그부터 닫는 태그까지. */
function chipMarkup(): string {
  const anchor = SOURCE.indexOf('data-testid="calendar-day-event"');
  expect(anchor, '월 보기 일정 칩을 찾지 못했다').toBeGreaterThan(-1);
  const start = SOURCE.lastIndexOf('<Link', anchor);
  const end = SOURCE.indexOf('</Link>', anchor);
  expect(start, '칩의 여는 태그를 찾지 못했다').toBeGreaterThan(-1);
  expect(end, '칩의 닫는 태그를 찾지 못했다').toBeGreaterThan(anchor);
  return SOURCE.slice(start, end);
}

/**
 * 칩 `className` 템플릿의 **고정 클래스 부분만** 꺼낸다.
 *
 * 마크업 전체를 문자열로 검사하면 주석에 적힌 단어까지 걸려 통과해 버린다(실제로 그렇게 새는 것을
 * 확인해서 이렇게 좁혔다). 조건부 분기(`${...}`) 앞의 고정 부분만 본다.
 */
function chipStaticClasses(): string[] {
  const chip = chipMarkup();
  const marker = 'className={`';
  const from = chip.indexOf(marker);
  expect(from, '칩의 className 템플릿을 찾지 못했다').toBeGreaterThan(-1);
  const rest = chip.slice(from + marker.length);
  const stop = Math.min(
    ...[rest.indexOf('${'), rest.indexOf('`')].filter((index) => index >= 0),
  );
  return rest
    .slice(0, stop)
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * 칩 안에 있는 `sr-only` **요소**의 개수.
 *
 * 마크업에서 `sr-only`라는 **글자**를 찾으면 주석만 있어도 통과한다(독립 검토 지적). 그래서
 * `className="sr-only"`를 가진 `<span>` 여는 태그만 센다.
 */
function srOnlyBadgeCount(): number {
  return chipMarkup().match(/<span\s+className="sr-only">/g)?.length ?? 0;
}

describe('월 보기 일정 칩', () => {
  it('절대 배치 배지를 품고 있다 (이 조건이 있어야 아래 고정이 의미가 있다)', () => {
    // 배지가 하나도 없으면 아래 `relative` 고정은 지킬 이유가 없어진다.
    expect(srOnlyBadgeCount(), '칩 안에 sr-only 배지가 있어야 한다').toBeGreaterThan(0);
  });

  it('자르기와 컨테이닝 블록을 함께 가진다 (truncate + relative)', () => {
    const classes = chipStaticClasses();
    // `truncate`만 있으면 절대 배치 배지는 잘리지 않는다(재현: scrollWidth 577).
    expect(classes, '칩이 넘치는 제목을 잘라야 한다').toContain('truncate');
    // `relative`가 칩을 컨테이닝 블록으로 만들어 그 자르기가 배지에도 적용된다(재현: 375).
    expect(classes, '칩이 절대 배치 자손의 컨테이닝 블록이어야 한다').toContain('relative');
  });
});
