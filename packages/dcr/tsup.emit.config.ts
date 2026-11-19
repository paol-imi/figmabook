import { defineConfig } from 'tsup';

/**
 * Bundles the schema emitter from source (workspace packages through the `@holotype/source`
 * condition), so `pnpm -F @holotype/dcr build` works without building `ir` first.
 */
export default defineConfig({
  entry: { 'emit-schemas': 'scripts/emit-schemas.ts' },
  outDir: 'dist/.emit',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // Workspace sources are bundled; npm dependencies stay external (they ship built code).
  noExternal: [/^@holotype\//],
  esbuildOptions(options) {
    options.conditions = ['@holotype/source'];
  },
  clean: true,
  dts: false,
  sourcemap: false,
});
