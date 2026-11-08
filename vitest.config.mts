import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** 담당 앱의 테스트만 독립적으로 실행한다. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    name: 'backend',
    // 공용 테스트 DB의 큐를 다른 테스트 파일이 가져가지 않도록 직렬화한다.
    fileParallelism: !process.env.TEST_DATABASE_URL,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
  },
});
