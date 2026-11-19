import { defineProject, mergeConfig } from 'vitest/config';
import shared from '../vitest.shared.ts';

export default mergeConfig(
  shared,
  defineProject({
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
    test: {
      name: 'spikes',
      include: ['runner/test/**/*.test.{ts,tsx}', '_shared/test/**/*.test.ts', 'S-*/test/**/*.test.{ts,tsx}'],
      exclude: ['**/*.e2e.test.ts'],
    },
  }),
);
