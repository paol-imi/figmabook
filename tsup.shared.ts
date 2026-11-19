import type { Options } from 'tsup';

const common = {
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  sourcemap: true,
  clean: true,
  // Keep `node:` specifiers: every supported Node handles them and they mark built-ins clearly.
  removeNodeProtocol: false,
} satisfies Options;

/**
 * Isomorphic packages (02 §6.2 browser-safe set) are bundled for a neutral ES2022 target:
 * a Node built-in import has no resolution there and fails the build.
 */
export function isomorphic(options: Options = {}): Options {
  return { ...common, platform: 'neutral', target: 'es2022', ...options };
}

/** Node packages target the lowest supported Node (D-03). */
export function node(options: Options = {}): Options {
  return { ...common, platform: 'node', target: 'node22', ...options };
}
