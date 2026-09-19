import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // Playwright 스펙은 `pnpm test:e2e`에서 별도로 실행한다.
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**', '.agent-runtime/**'],
  },
});
