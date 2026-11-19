import { defineConfig } from 'vitest/config';

/** Runs every package's tests in one process (handy in editors); CI goes through turbo. */
export default defineConfig({
  test: {
    projects: ['packages/*', 'tools/*', 'fixtures/*', 'spikes'],
  },
});
