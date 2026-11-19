import { checkVersion } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';

/** `DesignChangeRequest.dcrVersion` this build writes (15 §6). Majors are breaking. */
export const DCR_VERSION = '1.0.0';

/** `dcrVersion` majors this build reads. */
export const SUPPORTED_DCR_MAJORS: readonly number[] = [1];

/** `FigmaSnapshot.v`, `BaselineSnapshot.v` and `DcrDecisions.v` (integers, like plugin data `v`). */
export const SNAPSHOT_VERSION = 1;

/**
 * Checks a request's `dcrVersion`. Returns `APPLY_IR_VERSION_UNSUPPORTED` for a newer (or
 * malformed) major (15 §11 "reused codes"), `undefined` when this build can read it.
 */
export function checkDcrVersion(version: unknown): Diagnostic | undefined {
  return checkVersion('DCR', version, SUPPORTED_DCR_MAJORS);
}
