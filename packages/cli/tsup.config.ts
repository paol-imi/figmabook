import { defineConfig } from 'tsup';
import { node } from '../../tsup.shared.ts';

export default defineConfig(node({ entry: ['src/index.ts', 'src/config.ts', 'src/bin.ts'] }));
