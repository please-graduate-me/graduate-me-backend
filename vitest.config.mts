import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** 담당 앱의 테스트만 독립적으로 실행한다. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    name: 'backend',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
  },
});
