import { defineProject } from 'vitest/config';
import shared from '../../vitest.shared.ts';
import { serializerPlugin } from './scripts/serializer.ts';

/**
 * `pnpm -F @holotype/capture test:e2e`: builds the fixture Storybook and captures stories in
 * headless Chromium. Spreads the shared config instead of `mergeConfig`, which would concatenate
 * `include` with the unit-test glob.
 */
export default defineProject({
  ...shared,
  plugins: [serializerPlugin()],
  test: {
    ...shared.test,
    name: 'capture-e2e',
    include: ['test/e2e/**/*.e2e.ts'],
    testTimeout: 90_000,
    hookTimeout: 180_000,
  },
});
