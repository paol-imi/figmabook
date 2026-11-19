import { defineProject } from 'vitest/config';
import shared from '../../vitest.shared.ts';

/**
 * `pnpm test:smoke`: builds Storybook and renders every story in headless Chromium.
 * Spreads the shared config instead of `mergeConfig`, which would concatenate `include` with the shared glob.
 */
export default defineProject({
  ...shared,
  test: {
    ...shared.test,
    name: 'fixture-ds-react-smoke',
    include: ['test/smoke/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
