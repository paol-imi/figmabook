/*
 * Read-back after a write (10 §9.1, 09 §6 step 12): the box delta for the report, and the
 * managed property groups behind `ah`, the baseline and the DCR snapshot (06 §6, D-34).
 */
import { appliedHash, normalizeGroups } from '@holotype/ir/core';
import { readGroups } from './groups';

export { readbackDelta } from './delta';
export { type ReadGroups, readGroups } from './groups';

/** `ah` of a node as it stands: its read-back groups, normalized and hashed (06 §6, D-31). */
export async function appliedHashOf(node: SceneNode): Promise<string> {
  return appliedHash(normalizeGroups(await readGroups(node)));
}
