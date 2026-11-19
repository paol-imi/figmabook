import { defineConfig } from 'tsdown';
import { node } from '../../tsdown.shared.ts';

// The runner executes `dist/index.js` from the checked-out action, without installing
// dependencies, so everything is bundled into that one file. Playwright is the exception: it
// cannot be bundled (it loads its own files at run time) and the job needs its browser anyway.
export default defineConfig(
  node({
    entry: { index: 'src/main.ts' },
    deps: {
      neverBundle: [/^playwright(?:-core)?(?:\/|$)/],
      alwaysBundle: [/^(?!playwright(?:-core)?(?:\/|$))/],
      // Bundling `node_modules` code is the point of this build: no hint per bundled package.
      onlyBundle: false,
    },
    dts: false,
    sourcemap: false,
  }),
);
