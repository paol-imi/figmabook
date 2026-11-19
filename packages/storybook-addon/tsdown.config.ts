import { defineConfig } from 'tsdown';
import { isomorphic } from '../../tsdown.shared.ts';

// One neutral build: `preview` runs in the Storybook preview iframe, `preset` in Node
// (it keeps its `node:` imports external).
export default defineConfig(
  isomorphic({ entry: ['src/index.ts', 'src/preset.ts', 'src/preview.ts'], deps: { neverBundle: [/^node:/] } }),
);
