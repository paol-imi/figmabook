import { defineConfig } from 'tsdown';
import { node } from '../../tsdown.shared.ts';

export default defineConfig(node({ entry: ['src/index.ts', 'src/config.ts', 'src/bin.ts'] }));
