import { canonicalJSON } from './canonical';
import { fnv1a64 } from './hash';
import type { JsonValue } from './schema/primitives';

/*
 * The one normalizer behind the applied hash `ah`, the branch baseline `base:*` and the DCR
 * snapshot (06 §6 "ah", 10 §9.1, D-34). The plugin reads each managed node into the seven
 * groups below (B-58 `readGroups`, Figma property names); this module is the pure half.
 */

/** The `ah` property groups, in hash order (06 §6). A readback field belongs to exactly one. */
export const APPLIED_GROUPS = ['geom', 'layout', 'paint', 'text', 'vis', 'bind', 'inst'] as const;
export type AppliedGroup = (typeof APPLIED_GROUPS)[number];

/** Raw readback per group. An absent group (e.g. `text` on a frame) normalizes to `{}`. */
export type RawNodeGroups = { readonly [G in AppliedGroup]?: unknown };

/** Normalized groups: plain JSON, floats to 1e-3, color channels to 1e-4, no `undefined`. */
export type NodeGroups = { readonly [G in AppliedGroup]: JsonValue };

/** Length of `ah`: seven 16-hex FNV-1a-64 sub-hashes. */
export const APPLIED_HASH_LENGTH = APPLIED_GROUPS.length * 16;

const FLOAT_SCALE = 1e3;
const COLOR_SCALE = 1e4;
const COLOR_KEYS = new Set(['r', 'g', 'b', 'a']);

/** Normalizes raw readback groups (pure, isomorphic). Idempotent; key order does not matter. */
export function normalizeGroups(raw: RawNodeGroups): NodeGroups {
  const out = {} as Record<AppliedGroup, JsonValue>;
  for (const group of APPLIED_GROUPS) {
    out[group] = raw[group] === undefined ? {} : normalizeValue(raw[group], `${group}`);
  }
  return out;
}

function normalizeValue(value: unknown, at: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return round(value, FLOAT_SCALE, at);
  if (Array.isArray(value)) return value.map((item, i) => normalizeValue(item, `${at}/${i}`));
  if (typeof value === 'object') {
    const color = isColor(value);
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      const normalized =
        color && COLOR_KEYS.has(key)
          ? round(item as number, COLOR_SCALE, `${at}/${key}`)
          : normalizeValue(item, `${at}/${key}`);
      // A data property even for a key like `__proto__`.
      Object.defineProperty(out, key, { value: normalized, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  throw new TypeError(`normalizeGroups: ${typeof value} is not readback data (at ${at})`);
}

/** A Figma `RGB`/`RGBA`: numeric `r`, `g`, `b`, optional `a`, nothing else. */
function isColor(value: object): boolean {
  const keys = Object.keys(value);
  const record = value as Record<string, unknown>;
  return (
    ['r', 'g', 'b'].every((key) => typeof record[key] === 'number') &&
    keys.every((key) => COLOR_KEYS.has(key) && typeof record[key] === 'number')
  );
}

function round(value: number, scale: number, at: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`normalizeGroups: non-finite number ${value} at ${at}`);
  const scaled = value * scale;
  // Past 2^53 every float is an integer step apart: rounding would only add float error.
  const rounded = Math.abs(scaled) < Number.MAX_SAFE_INTEGER ? Math.round(scaled) / scale : value;
  return rounded === 0 ? 0 : rounded;
}

/** Canonical form of one normalized group: what its sub-hash covers. */
export function canonicalGroup(group: JsonValue): string {
  // Values are already rounded; `ratio` (1e-6) keeps both 1e-3 and 1e-4 steps exact.
  return canonicalJSON(group, { numKind: 'ratio' });
}

/** The per-group FNV-1a-64 sub-hashes, 16 hex each. */
export function groupHashes(groups: NodeGroups): Record<AppliedGroup, string> {
  const out = {} as Record<AppliedGroup, string>;
  for (const group of APPLIED_GROUPS) out[group] = fnv1a64(canonicalGroup(groups[group]));
  return out;
}

/** `ah`: the seven sub-hashes concatenated in `APPLIED_GROUPS` order (112 hex). */
export function appliedHash(groups: NodeGroups): string {
  const hashes = groupHashes(groups);
  return APPLIED_GROUPS.map((group) => hashes[group]).join('');
}

/** Splits an `ah` back into its sub-hashes. Throws on a malformed value. */
export function splitAppliedHash(ah: string): Record<AppliedGroup, string> {
  if (!new RegExp(`^[0-9a-f]{${APPLIED_HASH_LENGTH}}$`).test(ah)) {
    throw new RangeError(`Malformed applied hash: expected ${APPLIED_HASH_LENGTH} lowercase hex characters.`);
  }
  const out = {} as Record<AppliedGroup, string>;
  APPLIED_GROUPS.forEach((group, i) => {
    out[group] = ah.slice(i * 16, i * 16 + 16);
  });
  return out;
}

/** The groups whose sub-hash differs between two `ah` values: what a designer edited (10 §9.1). */
export function changedGroups(stored: string, current: string): AppliedGroup[] {
  const a = splitAppliedHash(stored);
  const b = splitAppliedHash(current);
  return APPLIED_GROUPS.filter((group) => a[group] !== b[group]);
}
