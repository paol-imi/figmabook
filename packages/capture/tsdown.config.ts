import { defineConfig } from 'tsdown';
import { node } from '../../tsdown.shared.ts';
import { serializerPlugin } from './scripts/serializer.ts';

export default defineConfig(node({ plugins: [serializerPlugin()] }));
