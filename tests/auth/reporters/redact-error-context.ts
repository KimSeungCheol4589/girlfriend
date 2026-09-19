import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * 실패 산출물에서 **페이지 스냅샷만** 지우는 리포터.
 *
 * 배경: Playwright 1.63은 테스트가 실패하면 `error-context.md`에 페이지의 aria 스냅샷을 남긴다.
 * 이 스냅샷에는 **입력 필드의 값이 그대로 들어간다**(`type="password"` 필드 포함).
 * 인증 스위트는 비밀번호·이메일·토큰을 입력하므로 그대로 두면 파일에 남는다.
 *
 * 확인한 사실(설치된 1.63.0에서 직접 실험):
 *   - `trace`·`video`·`screenshot`을 모두 꺼도 이 파일은 생성된다.
 *   - `PLAYWRIGHT_NO_COPY_PROMPT=1`은 설정 파일에서 켜도, 러너 프로세스 환경으로 넘겨도
 *     스냅샷을 막지 못했다(단언 실패 시 matcher가 붙이는 경로는 그 스위치를 거치지 않는다).
 *
 * 그래서 공개 리포터 API(`onTestEnd`)로 파일이 만들어진 **뒤에** 스냅샷 블록만 덜어 낸다.
 * 오류 메시지·호출 로그·테스트 소스 같은 진단 정보는 그대로 남긴다.
 */
const SNAPSHOT_BLOCK = /```yaml\r?\n[\s\S]*?```/g;

const REPLACEMENT =
  '```text\n(페이지 스냅샷은 인증 스위트 정책에 따라 제거했습니다. ' +
  '입력값이 그대로 담겨 비밀번호·이메일·토큰이 남을 수 있습니다.)\n```';

export function redactSnapshotBlocks(content: string): string {
  return content.replace(SNAPSHOT_BLOCK, REPLACEMENT);
}

export default class RedactErrorContextReporter implements Reporter {
  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.name !== 'error-context' || !attachment.path) continue;
      if (!existsSync(attachment.path)) continue;

      const original = readFileSync(attachment.path, 'utf8');
      const redacted = redactSnapshotBlocks(original);
      if (redacted !== original) writeFileSync(attachment.path, redacted, 'utf8');
    }
  }
}
