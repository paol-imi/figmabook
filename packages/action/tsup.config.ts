import { defineConfig } from 'tsup';
import { node } from '../../tsup.shared.ts';

// The runner executes `dist/index.js` from the checked-out action, without installing
// dependencies, so everything is bundled into that one file. Playwright is the exception: it
// cannot be bundled (it loads its own files at run time) and the job needs its browser anyway.
export default defineConfig(
  node({
    entry: { index: 'src/main.ts' },
    noExternal: [/^(?!playwright(?:-core)?(?:\/|$))/],
    external: ['playwright', 'playwright-core'],
    dts: false,
    sourcemap: false,
  }),
);
