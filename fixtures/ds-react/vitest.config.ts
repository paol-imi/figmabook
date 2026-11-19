import { defineProject } from 'vitest/config';
import shared from '../../vitest.shared.ts';

/**
 * Fast suite run by `pnpm test`: unit tests plus a Storybook build and the `index.json` id snapshot.
 * Spreads the shared config instead of `mergeConfig`, which would concatenate `include` with the shared glob.
 */
export default defineProject({
  ...shared,
  test: {
    ...shared.test,
    name: 'fixture-ds-react',
    include: ['test/unit/**/*.test.{ts,tsx}'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
