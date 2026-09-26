import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { shouldAttemptLink } from '@/features/memories/links/link-attempt';

/**
 * 부분 성공 상태 진입 규칙(독립 검토 P1 회귀 방지).
 *
 * 막으려는 회귀
 *   1. 연결할 계획이 없는 저장에서 "연결만 다시 시도" 부분 성공 UI가 뜨는 것.
 *   2. 사용자가 "연결 없이 기록하기"를 고른 뒤에도 재시도로 연결이 생기는 것.
 *
 * 화면 단위 테스트 도구(jsdom/testing-library)는 이 저장소에 없고 추가하려면 lockfile을
 * 건드려야 해서, 판단 규칙을 순수 함수로 분리해 고정하고 **호출부 연결까지 소스로 확인**한다.
 */

describe('shouldAttemptLink', () => {
  it('연결 대상이 없으면 시도하지 않는다', () => {
    expect(shouldAttemptLink({ hasLink: false, linkEnabled: true })).toBe(false);
    expect(shouldAttemptLink({ hasLink: false, linkEnabled: false })).toBe(false);
  });

  it('사용자가 연결을 껐으면 시도하지 않는다', () => {
    expect(shouldAttemptLink({ hasLink: true, linkEnabled: false })).toBe(false);
  });

  it('연결 대상이 있고 사용자가 켜 두었을 때만 시도한다', () => {
    expect(shouldAttemptLink({ hasLink: true, linkEnabled: true })).toBe(true);
  });
});

describe('LiveMemoryForm이 이 규칙을 실제로 쓴다', () => {
  const source = readFileSync(
    resolve(__dirname, '..', '..', 'src/features/memories/live/components/LiveMemoryForm.tsx'),
    'utf8',
  );

  it('savedMemory는 규칙을 통과한 경우에만 설정한다', () => {
    // `setSavedMemory(` 호출은 두 곳이다: 연결 시도 분기와, 연결 성공 뒤 version 갱신.
    // 둘 다 연결을 시도하는 경로 안에 있어야 한다.
    const guarded = /if \(link && shouldAttemptLink\(\{ hasLink: true, linkEnabled \}\)\) \{\s*\n\s*setSavedMemory\(saved\);/;
    expect(guarded.test(source), 'setSavedMemory가 연결 시도 분기 안에 있어야 한다').toBe(true);

    // 저장 성공 직후 무조건 설정하는 옛 코드가 남아 있으면 회귀다.
    expect(source).not.toMatch(/setSavedMemory\(saved\);\s*\n\s*\n?\s*if \(link/);
  });

  it('runLink의 방어 분기가 submitting을 되돌린다', () => {
    const guard =
      /if \(!link \|\| !shouldAttemptLink\(\{ hasLink: true, linkEnabled \}\)\) \{\s*\n\s*setSubmitting\(false\);\s*\n\s*return;/;
    expect(guard.test(source), '방어 분기에서 setSubmitting(false)를 불러야 한다').toBe(true);
  });

  it('부분 성공 상태에서 편집 입력을 잠근다(P2)', () => {
    // 제목·날짜·장소·태그·이야기 입력에 disabled가 붙어 있어야 조용히 버려지는 입력이 없다.
    for (const field of ['title', 'memoryDate', 'location', 'tags', 'body']) {
      const pattern = new RegExp(`id=\\{FIELD_IDS\\.${field}\\}\\s*\\n\\s*disabled=\\{disabled\\}`);
      expect(pattern.test(source), `${field} 입력에 disabled가 필요하다`).toBe(true);
    }
    // 그리고 어디서 고쳐야 하는지 알려 준다.
    expect(source).toContain('저장한 기록의 수정 화면');
  });

  it('부분 성공 상태에서 홈 고정 체크박스도 잠근다(재검토 P2)', () => {
    // 고정 체크박스에는 `FIELD_IDS` 항목이 없어 `checked` 속성을 기준으로 확인한다.
    const pinned = /checked=\{form\.isPinned\}\s*\n\s*disabled=\{disabled\}/;
    expect(pinned.test(source), '고정 체크박스에 disabled가 필요하다').toBe(true);

    // 체크박스가 더 늘어나도 잠금을 놓치지 않게, 이 화면의 모든 체크박스를 확인한다.
    const checkboxes = source.match(/<input\b[^>]*type="checkbox"[\s\S]*?\/>/g) ?? [];
    expect(checkboxes.length, '검사할 체크박스를 찾지 못했다').toBeGreaterThan(0);
    for (const box of checkboxes) {
      expect(box, `체크박스에 disabled가 없다: ${box}`).toContain('disabled={disabled}');
    }

    // 안내 문장도 고정·사진이 이미 저장돼 바꿀 수 없다는 사실을 알려 준다.
    expect(source).toContain('이야기·사진·고정은 이미 저장돼');
  });
});
