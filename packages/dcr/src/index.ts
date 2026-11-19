import { NotImplementedError } from '@holotype/shared';
import type { BaselineSnapshot, FigmaSnapshot } from './schema';

/*
 * Design Change Request extraction is a pure function (D-35): no network, no clock and
 * no randomness, so the same file version and baseline give a byte-identical DCR. The
 * package runs in Node (CLI) and in the plugin UI.
 */

export * from './schema';

/** Diffs a branch snapshot against its embedded baselines (D-34). Built by B-65. */
export function extractDcr(_snapshot: FigmaSnapshot, _baselines: readonly BaselineSnapshot[]): never {
  throw new NotImplementedError('extractDcr', 'Phase 4.5');
}
