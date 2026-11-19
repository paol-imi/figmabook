import { defineProject, mergeConfig } from 'vitest/config';
import { serializerPlugin } from '../packages/capture/scripts/serializer.ts';
import shared from '../vitest.shared.ts';

/**
 * Container-only checks that need Playwright's Chromium: S-05 reference renders, and the S-19
 * provenance run on the ds-react dev server (it captures through `@holotype/capture` sources, so
 * the serializer's virtual module is provided here, as in the capture package).
 */
export default mergeConfig(
  shared,
  defineProject({
    plugins: [serializerPlugin()],
    test: { name: 'spikes-e2e', include: ['S-*/test/**/*.e2e.test.ts'], testTimeout: 60_000, hookTimeout: 180_000 },
  }),
);
