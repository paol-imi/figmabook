import { defineProject, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';
import { serializerVitePlugin } from '../capture/scripts/serializer.ts';

/** `@holotype/capture` runs from source here, so its serializer string is built on the fly. */
export default mergeConfig(shared, defineProject({ plugins: [serializerVitePlugin()], test: { name: 'cli' } }));
