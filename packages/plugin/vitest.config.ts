import { defineProject, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';

// Node by default; UI tests opt into a DOM with `// @vitest-environment happy-dom`.
export default mergeConfig(
  shared,
  defineProject({
    test: { name: 'plugin', setupFiles: ['test/setup.ts'] },
  }),
);
