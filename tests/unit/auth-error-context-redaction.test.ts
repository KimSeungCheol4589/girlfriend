import { describe, expect, it } from 'vitest';

import { redactSnapshotBlocks } from '../auth/reporters/redact-error-context';

/**
 * 실패 산출물에서 페이지 스냅샷만 지우는 규칙을 고정한다.
 * (리포터가 실제로 파일을 바꾸는지는 설치된 Playwright로 따로 실험해 확인했다.)
 */
const SAMPLE = [
  '# Error details',
  '',
  '```',
  'Error: expect(locator).toBeVisible() failed',
  '```',
  '',
  '```yaml',
  '- main:',
  '  - textbox "이메일": someone@test.invalid',
  '  - textbox "비밀번호": super-secret-value',
  '```',
  '',
  '# Test source',
  '',
  '```ts',
  "await page.getByLabel('비밀번호').fill(account.password);",
  '```',
].join('\n');

describe('redactSnapshotBlocks', () => {
  it('페이지 스냅샷의 입력값을 남기지 않는다', () => {
    const redacted = redactSnapshotBlocks(SAMPLE);
    expect(redacted).not.toContain('super-secret-value');
    expect(redacted).not.toContain('someone@test.invalid');
    expect(redacted).not.toContain('```yaml');
  });

  it('오류 상세와 테스트 소스는 그대로 둔다', () => {
    const redacted = redactSnapshotBlocks(SAMPLE);
    expect(redacted).toContain('# Error details');
    expect(redacted).toContain('Error: expect(locator).toBeVisible() failed');
    expect(redacted).toContain('# Test source');
    expect(redacted).toContain("await page.getByLabel('비밀번호').fill(account.password);");
  });

  it('스냅샷이 여러 개여도 모두 지운다', () => {
    const doubled = `${SAMPLE}\n\n\`\`\`yaml\n- textbox "이메일": second@test.invalid\n\`\`\``;
    const redacted = redactSnapshotBlocks(doubled);
    expect(redacted).not.toContain('second@test.invalid');
    expect(redacted.match(/```yaml/g)).toBeNull();
  });

  it('스냅샷이 없으면 내용을 바꾸지 않는다', () => {
    const plain = '# Error details\n\n```\nError: boom\n```\n';
    expect(redactSnapshotBlocks(plain)).toBe(plain);
  });
});
