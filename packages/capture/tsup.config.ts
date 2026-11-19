import { defineConfig } from 'tsup';
import { node } from '../../tsup.shared.ts';
import { serializerEsbuildPlugin } from './scripts/serializer.ts';

export default defineConfig(node({ esbuildPlugins: [serializerEsbuildPlugin()] }));
