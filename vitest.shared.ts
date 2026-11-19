import { defineConfig } from 'vitest/config';

/**
 * Workspace packages expose their TypeScript sources under the `@holotype/source`
 * export condition, so tests (like `tsc`) run against source without a prior build.
 */
const conditions = ['@holotype/source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
