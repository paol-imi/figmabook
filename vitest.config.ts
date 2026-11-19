import { defineConfig } from 'vitest/config';

/** Runs every package's tests in one process (handy in editors); CI goes through turbo. */
export default defineConfig({
  test: {
    // `fixtures/*` also matches `fixtures/fonts.lock`, which Vitest rejects as a project.
    projects: ['packages/*', 'tools/*', 'fixtures/*', '!fixtures/fonts.lock', 'spikes', 'docs'],
  },
});
