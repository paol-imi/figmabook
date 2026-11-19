import { defineProject } from 'vitest/config';
import shared from '../../vitest.shared.ts';

/**
 * `pnpm test:smoke` (B-15): the built CLI captures fixture stories in headless Chromium, then
 * the plugin's import and apply code builds the bundle in figma-fake. The global setup
 * builds the CLI and the plugin first (Turborepo, cached).
 */
export default defineProject({
  ...shared,
  test: {
    ...shared.test,
    name: 'smoke',
    include: ['test/**/*.smoke.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
