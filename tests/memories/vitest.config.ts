import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * MEM-001 전용 Vitest 설정. 기본 `pnpm test`(tests/unit)와 분리한다.
 *
 *   pnpm exec vitest run --config tests/memories/vitest.config.ts
 *
 * - `decoder/`: 실제 sharp로 서버 확정 검증기(읽기 전용 디코딩·40MP·치수·메타데이터 거부)를 검증한다.
 * - `integration/`: 로컬 Supabase에 실제로 연결한다(확정 프로토콜·동시성·정리). MEM_TEST_* 환경 변수가 없으면 건너뛴다.
 * - `server-only`는 node에서 import만으로 예외를 던지므로 빈 모듈로 연결한다(서버 모듈을 직접 검증하기 위해).
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
    include: ['tests/memories/decoder/**/*.test.ts', 'tests/memories/integration/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', '.agent-runtime/**'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // 통합 테스트는 같은 합성 공간을 쓴다. 파일 단위로 순서대로 실행한다.
    fileParallelism: false,
  },
});
