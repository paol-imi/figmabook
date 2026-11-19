import type { BundleManifest } from '@holotype/ir';
import { NotImplementedError } from '@holotype/shared';
import type { ExitCode } from './exit-codes';
import { main } from './main';
import { type CliIo, processIo } from './output/io';

export interface RunOptions {
  /** A `holotype` command, e.g. `capture`. */
  readonly command: string;
  readonly args: readonly string[];
}

/** Runs one CLI command in-process (the GitHub Action's entry, topology D). */
export async function run(options: RunOptions, io: CliIo = processIo()): Promise<ExitCode> {
  return main([options.command, ...options.args], io);
}

export interface ServeOptions {
  /** One of the manifest's loopback ports (D-25). */
  readonly port?: 47321 | 47322 | 47323;
}

/** Starts the local server the plugin pairs with (topology A). */
export async function serve(_options: ServeOptions = {}): Promise<never> {
  throw new NotImplementedError('serve', 'hardening');
}

/** Re-packages a cached run as a bundle without re-rendering (11 §3.3 `export`). */
export async function exportBundle(_options: { readonly file: string }): Promise<BundleManifest> {
  throw new NotImplementedError('exportBundle', 'the capture cache');
}
