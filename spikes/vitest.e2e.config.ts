import { defineProject, mergeConfig } from 'vitest/config';
import shared from '../vitest.shared.ts';

/** Container-only checks that need Playwright's Chromium (reference renders). */
export default mergeConfig(
  shared,
  defineProject({ test: { name: 'spikes-e2e', include: ['S-*/test/**/*.e2e.test.ts'], testTimeout: 60_000 } }),
);
