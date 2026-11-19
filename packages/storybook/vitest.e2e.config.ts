import { defineProject } from 'vitest/config';
import shared from '../../vitest.shared.ts';

/**
 * `pnpm -F @holotype/storybook test:e2e`: builds the fixture Storybook and renders stories in
 * headless Chromium. Spreads the shared config instead of `mergeConfig`, which would concatenate
 * `include` with the unit-test glob.
 */
export default defineProject({
  ...shared,
  test: {
    ...shared.test,
    name: 'storybook-e2e',
    include: ['test/e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
