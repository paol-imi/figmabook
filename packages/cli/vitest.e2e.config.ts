import { defineProject } from 'vitest/config';
import shared from '../../vitest.shared.ts';

/**
 * `pnpm -F @holotype/cli test:e2e`: runs the built `holotype` binary against the fixture
 * Storybook in headless Chromium. The global setup builds the CLI and its dependencies
 * first (Turborepo, cached). Spreads the shared config instead of `mergeConfig`, which
 * would concatenate `include` with the unit-test glob.
 */
export default defineProject({
  ...shared,
  test: {
    ...shared.test,
    name: 'cli-e2e',
    include: ['test/e2e/**/*.e2e.ts'],
    globalSetup: ['test/e2e/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
