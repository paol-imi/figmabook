import { defineProject, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';
import { serializerVitePlugin } from './scripts/serializer.ts';

export default mergeConfig(shared, defineProject({ plugins: [serializerVitePlugin()], test: { name: 'capture' } }));
