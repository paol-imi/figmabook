import type { AppliedGroup, JsonValue } from '@holotype/ir';
import { field, isObject } from '../identify/json';
import type { DcrChange, FieldChange, PartialNodeGroups } from '../schema';
import { boundVariable, fieldInfo, valueFieldOfBinding } from './field-info';
import { diffGroups } from './fields';
import type { TokenIndex } from './tokens';

/*
 * One node's changes against its baseline (15 §4.3), after the noise filter:
 *
 * - Derived geometry is dropped: a size on an axis the node hugs or fills is computed by
 *   auto layout from other values (padding, text, the parent), so a change there is explained
 *   by the change that caused it, or is Figma re-measuring (15 §3.3 "no false positives").
 * - Bindings fold into the value they bind: a rebinding is reported on the value field with
 *   `token.before`/`token.after` (`bind.fills[0]` → `paint.fills[0].color`).
 * - A value that moved only because its variable changed (bound to the same variable before
 *   and after) is the variable's change, reported once as `token.changed` (15 §4.4).
 */

export { boundVariable, fieldInfo, UNMAPPABLE_FIELDS } from './field-info';
export { changedGroupsOf, diffGroups } from './fields';
export { TokenIndex } from './tokens';

/** Reads a field path (`paint.fills[0].color`) out of a node's groups. */
export function valueAt(groups: PartialNodeGroups | undefined, path: string): JsonValue | undefined {
  const parts = path.match(/[^.[\]]+|\[\d+\]/g) ?? [];
  let current: JsonValue | undefined = groups as JsonValue | undefined;
  for (const part of parts) {
    if (part.startsWith('[')) {
      const index = Number(part.slice(1, -1));
      current = Array.isArray(current) ? current[index] : undefined;
    } else {
      current = field(current, part);
    }
    if (current === undefined) return undefined;
  }
  return current;
}

const SIZING_OF: Readonly<Record<string, string>> = {
  'geom.width': 'layoutSizingHorizontal',
  'geom.height': 'layoutSizingVertical',
};

/** Whether auto layout or text auto-resize computes this geometry value (it is never a request). */
export function isDerivedGeometry(path: string, groups: PartialNodeGroups): boolean {
  const sizingKey = SIZING_OF[path];
  if (sizingKey === undefined) return false;
  const sizing = field(groups.layout, sizingKey);
  if (sizing === 'HUG' || sizing === 'FILL') return true;
  if (sizing !== undefined) return false;
  const resize = field(groups.text, 'textAutoResize');
  return resize === 'WIDTH_AND_HEIGHT' || (resize === 'HEIGHT' && path === 'geom.height');
}

export interface NodeDiff {
  readonly nodeType: string;
  readonly before: PartialNodeGroups;
  readonly after: PartialNodeGroups;
  /** Groups to compare (those whose `ah` sub-hash differs); all by default. */
  readonly groups?: readonly AppliedGroup[];
}

/** The changes of one node, noise-filtered and with tokens folded in, sorted by field. */
export function diffNode({ nodeType, before, after, groups }: NodeDiff, tokens: TokenIndex): DcrChange[] {
  const raw = diffGroups(before, after, groups).filter((change) => !isDerivedGeometry(change.field, after));
  const values = new Map<string, FieldChange>();
  const kept: FieldChange[] = [];
  for (const change of raw) if (change.group !== 'bind') values.set(change.field, change);
  for (const change of raw) {
    if (change.group !== 'bind') continue;
    const target = valueFieldOfBinding(change.field, nodeType, [after, before]);
    if (target === undefined) {
      kept.push(change);
      continue;
    }
    if (!values.has(target)) {
      const group = target.slice(0, target.indexOf('.')) as AppliedGroup;
      values.set(target, {
        group,
        field: target,
        before: valueAt(before, target) ?? null,
        after: valueAt(after, target) ?? null,
      });
    }
  }
  const out: DcrChange[] = [...kept];
  for (const change of values.values()) {
    const { bindKey } = fieldInfo(change.field, nodeType);
    const was = boundVariable(before.bind, bindKey);
    const is = boundVariable(after.bind, bindKey);
    // Same variable on both sides: the value moved with the variable (token.changed).
    if (was !== undefined && was === is) continue;
    const token: NonNullable<DcrChange['token']> = {};
    const tokenBefore = was === undefined ? undefined : tokens.cssName(was);
    const tokenAfter = is === undefined ? undefined : tokens.cssName(is);
    if (tokenBefore !== undefined) token.before = tokenBefore;
    if (tokenAfter !== undefined) token.after = tokenAfter;
    out.push(isObject(token) && Object.keys(token).length > 0 ? { ...change, token } : change);
  }
  return out.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
}
