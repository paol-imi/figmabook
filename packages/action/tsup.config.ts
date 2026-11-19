import { defineConfig } from 'tsup';
import { node } from '../../tsup.shared.ts';

// The runner executes `dist/index.js` from the checked-out action, without installing
// dependencies, so everything is bundled into that one file.
export default defineConfig(
  node({ entry: { index: 'src/main.ts' }, noExternal: [/.*/], dts: false, sourcemap: false }),
);
