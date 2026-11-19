import { defineProject, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';
import { serializerPlugin } from './scripts/serializer.ts';

export default mergeConfig(shared, defineProject({ plugins: [serializerPlugin()], test: { name: 'capture' } }));
