import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * THEME-001 전용 Vitest 설정. 기본 `pnpm test`(tests/unit)와 분리한다.
 *
 *   pnpm exec vitest run --config tests/customize/vitest.config.ts
 *
 * - `unit/`: 서버 전용 모듈(공용 확정 파이프라인)을 가짜 클라이언트로 직접 검증한다. 외부 연결이 없다.
 * - `integration/`: 로컬 Supabase에 실제로 연결한다. THEME_TEST_* 환경 변수가 없으면 건너뛴다.
 * - `server-only`는 node에서 import만으로 예외를 던지므로 빈 모듈로 연결한다(MEM 설정과 같은 방식).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./support/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/customize/unit/**/*.test.ts', 'tests/customize/integration/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', '.agent-runtime/**'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // 통합 테스트는 같은 합성 공간을 쓴다. 파일 단위로 순서대로 실행한다.
    fileParallelism: false,
  },
});
