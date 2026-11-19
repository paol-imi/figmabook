import { canonicalDcr, type FigmaSnapshot, type PartialNodeGroups } from '@holotype/dcr';
import { appliedHash, canonicalJSON, h16, hash, normalizeGroups } from '@holotype/ir';
import { canonicalSnapshot } from './order-free.ts';
import { type BranchMeta, type CaseConfig, type Registry, validateBranchMeta, validateRegistry } from './schemas.ts';

/*
 * Values a case derives from its own content. `pnpm -F @holotype/fixture-dcr seal` writes
 * them; the input checks verify them, so a hand edit that forgets one fails loudly.
 */

/** `header.figma.snapshotHash`: `h16` of the canonical snapshot (order-free arrays sorted, no `fileVersion`). */
export function snapshotHash(snapshot: FigmaSnapshot): string {
  return h16(canonicalDcr(canonicalSnapshot(snapshot)));
}

/** `configHash = h16(canonicalJSON(dcrConfig))` (06 branch block, D-50). */
export function configHash(config: CaseConfig): string {
  return hash(config);
}

/** `ah` of a node as applied: the hash of its normalized baseline groups (06 §6, D-31). */
export function appliedHashOf(groups: PartialNodeGroups): string {
  return appliedHash(normalizeGroups(groups));
}

/** Whether every group present is already normalized (floats to 1e-3, colors to 1e-4). */
export function isNormalized(groups: PartialNodeGroups): boolean {
  const normalized = normalizeGroups(groups);
  return (Object.keys(groups) as (keyof PartialNodeGroups)[]).every(
    (group) =>
      canonicalJSON(groups[group], { numKind: 'ratio' }) === canonicalJSON(normalized[group], { numKind: 'ratio' }),
  );
}

/** Whether a plugin-data string is canonical JSON, as Holotype writes it (10 §2.2). */
export function isCanonicalJsonString(value: string): boolean {
  try {
    return canonicalJSON(JSON.parse(value), { numKind: 'ratio' }) === value;
  } catch {
    return false;
  }
}

/** Plugin-data keys whose values are JSON (10 §2.1, §2.3). */
export const JSON_DATA_KEYS: ReadonlySet<string> = new Set(['src', 'axes', 'props', 'args', 'keep']);
export const isJsonRootKey = (key: string): boolean =>
  key === 'branch:meta' || key === 'registry:meta' || key === 'fontmap' || /^registry:\d+$/.test(key);

/** Parses and validates `branch:meta` from the snapshot's root data. */
export function readBranchMeta(snapshot: FigmaSnapshot): BranchMeta {
  const raw = snapshot.rootData['branch:meta'];
  if (raw === undefined)
    throw new Error('rootData has no "branch:meta": this is not a branch file (DCR_NOT_BRANCH_FILE).');
  const result = validateBranchMeta(JSON.parse(raw));
  if (!result.ok)
    throw new Error(`branch:meta is invalid: ${result.error.map((i) => `${i.path} ${i.message}`).join('; ')}`);
  return result.value;
}

/** Joins and validates the root registry chunks (`registry:meta` + `registry:0..n-1`). */
export function readRegistry(snapshot: FigmaSnapshot): Registry {
  const meta = snapshot.rootData['registry:meta'];
  if (meta === undefined) throw new Error('rootData has no "registry:meta".');
  const { chunks } = JSON.parse(meta) as { chunks: number };
  let joined = '';
  for (let i = 0; i < chunks; i++) {
    const chunk = snapshot.rootData[`registry:${i}`];
    if (chunk === undefined) throw new Error(`rootData has no "registry:${i}" (registry:meta says ${chunks} chunks).`);
    joined += chunk;
  }
  const result = validateRegistry(JSON.parse(joined));
  if (!result.ok)
    throw new Error(`The registry is invalid: ${result.error.map((i) => `${i.path} ${i.message}`).join('; ')}`);
  return result.value;
}
