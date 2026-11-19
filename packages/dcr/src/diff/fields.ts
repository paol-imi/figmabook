import {
  APPLIED_GROUPS,
  type AppliedGroup,
  groupHashes,
  type JsonValue,
  normalizeGroups,
  splitAppliedHash,
} from '@holotype/ir';
import { compareStrings, isObject, sameJson } from '../identify/json';
import type { FieldChange, PartialNodeGroups } from '../schema';

/*
 * The field-level diff of 15 §4.3. Groups are compared through `ah` first: a group whose
 * sub-hash still matches is unchanged and skipped. A changed group is then walked down to
 * its atomic values, named by their read-back path (`layout.paddingLeft`,
 * `paint.fills[0].color`, `text.lineHeight`, `bind.fills[0]`).
 */

/** Values that change as a whole: colors, `{ unit, value }`, font names and points. */
function isAtomic(value: JsonValue): boolean {
  if (!isObject(value)) return !Array.isArray(value);
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  const only = (allowed: readonly string[]) => keys.every((key) => allowed.includes(key));
  return (
    (only(['r', 'g', 'b', 'a']) && ['r', 'g', 'b'].every((key) => typeof value[key] === 'number')) ||
    (only(['unit', 'value']) && typeof value.unit === 'string') ||
    (only(['family', 'style']) && typeof value.family === 'string') ||
    (only(['x', 'y']) && typeof value.x === 'number')
  );
}

const childPath = (path: string, key: string) => `${path}.${key}`;

function diffValue(
  group: AppliedGroup,
  path: string,
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  out: FieldChange[],
): void {
  if (sameJson(before, after)) return;
  const b = before ?? null;
  const a = after ?? null;
  if (Array.isArray(b) && Array.isArray(a) && b.length === a.length) {
    for (const [i, item] of b.entries()) diffValue(group, `${path}[${i}]`, item, a[i], out);
    return;
  }
  // A missing object counts as empty, so a new key reads as its own field (`…References.characters`).
  const container = (value: JsonValue) => isObject(value) && !isAtomic(value);
  if ((container(b) || b === null) && (container(a) || a === null) && (b !== null || a !== null)) {
    const from = isObject(b) ? b : {};
    const to = isObject(a) ? a : {};
    const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort(compareStrings);
    for (const key of keys) diffValue(group, childPath(path, key), from[key], to[key], out);
    return;
  }
  out.push({ group, field: path, before: b, after: a });
}

/** The groups whose read-back differs from what `ah` recorded; all present groups without a valid `ah`. */
export function changedGroupsOf(ah: string | undefined, groups: PartialNodeGroups): AppliedGroup[] {
  const present = APPLIED_GROUPS.filter((group) => groups[group] !== undefined);
  if (ah === undefined) return present;
  let stored: Record<AppliedGroup, string>;
  try {
    stored = splitAppliedHash(ah);
  } catch {
    return present;
  }
  const current = groupHashes(normalizeGroups(groups));
  return present.filter((group) => stored[group] !== current[group]);
}

/**
 * Field changes from `before` to `after` in the given groups (all groups by default), sorted
 * by field. A group absent on one side counts as empty.
 */
export function diffGroups(
  before: PartialNodeGroups | undefined,
  after: PartialNodeGroups,
  groups: readonly AppliedGroup[] = APPLIED_GROUPS,
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const group of groups) {
    const b = before?.[group] ?? {};
    const a = after[group] ?? {};
    if (isObject(b) && isObject(a)) {
      const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort(compareStrings);
      for (const key of keys) diffValue(group, `${group}.${key}`, b[key], a[key], out);
    } else {
      diffValue(group, `${group}.value`, b, a, out);
    }
  }
  return out.sort((x, y) => compareStrings(x.field, y.field));
}
