import type { BundleManifest } from '@holotype/ir';
import { compareSeverity, type Diagnostic, NotImplementedError, type Severity } from '@holotype/shared';

/** Process exit codes (02 §9). */
export const ExitCode = Object.freeze({
  Ok: 0,
  /** Diagnostics at or above `--fail-on`. */
  Diagnostics: 1,
  /** Config or usage error. */
  Usage: 2,
  /** Storybook unreachable or auth failure. */
  StorybookUnreachable: 3,
  Internal: 4,
});

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** Exit code for a finished run: 1 when any diagnostic reaches `failOn` (default `error`). */
export function exitCodeFor(diagnostics: readonly Diagnostic[], failOn: Severity = 'error'): ExitCode {
  return diagnostics.some((d) => compareSeverity(d.severity, failOn) >= 0) ? ExitCode.Diagnostics : ExitCode.Ok;
}

/** Resolved `holotype.config.ts` (11 §config). The schema lands with config loading. */
export type HolotypeConfig = Readonly<Record<string, unknown>>;

export interface ServeOptions {
  /** One of the manifest's loopback ports (D-25). */
  readonly port?: 47321 | 47322 | 47323;
}

/** Runs the full pipeline for a config: discover, plan, capture, map, export. */
export async function run(_config: HolotypeConfig): Promise<ExitCode> {
  throw new NotImplementedError('run', 'Phase 1');
}

/** Starts the local server the plugin pairs with (topology A). */
export async function serve(_options: ServeOptions = {}): Promise<never> {
  throw new NotImplementedError('serve', 'Phase 3');
}

/** Writes a bundle directory or `.holotype.zip` (topology B). */
export async function exportBundle(_config: HolotypeConfig): Promise<BundleManifest> {
  throw new NotImplementedError('exportBundle', 'Phase 1');
}
