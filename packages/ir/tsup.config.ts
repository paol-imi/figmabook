import { defineConfig } from 'tsup';
import { isomorphic } from '../../tsup.shared.ts';

// `core` is the lean entry for the plugin main thread: no schemas (see src/core.ts).
export default defineConfig(isomorphic({ entry: ['src/index.ts', 'src/core.ts'] }));
