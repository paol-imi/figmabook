import type { UserConfig } from 'tsdown';

const common = {
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  sourcemap: true,
  clean: true,
  // Every package is `"type": "module"`, so plain `.js` / `.d.ts` are ESM and the `exports` maps
  // point at those names. With `platform: 'node'` tsdown would otherwise emit `.mjs` / `.d.mts`.
  fixedExtension: false,
  // The per-file size table and the slow-plugin timing warnings (the d.ts pass through the
  // TypeScript compiler) add nothing to the Turbo log.
  report: false,
  checks: { bundlerTimings: false },
} satisfies UserConfig;

/**
 * Isomorphic packages (02 §6.2 browser-safe set) are bundled for a neutral ES2022 target:
 * a Node built-in import has no resolution there and fails the build.
 */
export function isomorphic(options: UserConfig = {}): UserConfig {
  return { ...common, platform: 'neutral', target: 'es2022', ...options };
}

/** Node packages target the lowest supported Node (D-03, `engines.node`). */
export function node(options: UserConfig = {}): UserConfig {
  return { ...common, platform: 'node', target: 'node22.12', ...options };
}

/**
 * A build-time script (the schema emitters) bundled from source into `dist/.emit/`. Workspace
 * packages resolve through the `@holotype/source` condition and are inlined, so the script runs
 * without a prior build of its dependencies; npm dependencies stay external (they ship built code).
 */
export function emitScript(entry: Record<string, string>): UserConfig {
  return node({
    entry,
    outDir: 'dist/.emit',
    deps: { alwaysBundle: [/^@holotype\//] },
    inputOptions: { resolve: { conditionNames: ['@holotype/source', 'import', 'node', 'default'] } },
    dts: false,
    sourcemap: false,
  });
}
