/**
 * S-16 reverse mapping, instance properties → args (15 §4.5), and the forward map used to
 * rebuild an instance from args. Pure: the main thread snapshots instances, this module maps.
 */
import type { JsonValue } from '../_shared/json.ts';

export type ValueMapEntry = { readonly figma: string; readonly arg: JsonValue };

/** The slice of `ScenePropertyDef` + `PropSource` (06 §3.1) the round trip needs. */
export type PropDef =
  | {
      readonly key: string;
      readonly type: 'VARIANT' | 'BOOLEAN';
      readonly figmaName: string;
      readonly argName: string;
      readonly valueMap: readonly ValueMapEntry[];
    }
  | { readonly key: string; readonly type: 'TEXT'; readonly figmaName: string; readonly argName: string }
  | {
      readonly key: string;
      readonly type: 'INSTANCE_SWAP';
      readonly figmaName: string;
      readonly argName: string;
      readonly preferredValues: readonly { readonly sid: string; readonly arg: JsonValue }[];
    };

export type Unmapped = { readonly unmapped: JsonValue };
export type ArgValue = JsonValue | Unmapped;

/** What main reads from one instance. */
export type InstanceSnapshot = {
  /** `instance.variantProperties` */
  readonly variant: Readonly<Record<string, string>>;
  /** Non-VARIANT `instance.componentProperties`, keyed by display name (the `#id` suffix removed). */
  readonly props: Readonly<Record<string, string | boolean>>;
  /** For each INSTANCE_SWAP property (display name): the `sid` (or name) of the component it points to. */
  readonly swaps: Readonly<Record<string, string>>;
  /** `instance.overrides`, with node ids replaced by kit roles (`root` = the instance itself). */
  readonly overrides: readonly { readonly role: string; readonly fields: readonly string[] }[];
  /** Fields each role binds to component properties (`componentPropertyReferences` keys). */
  readonly referencedFields: Readonly<Record<string, readonly string[]>>;
  /** Nested instances with their own property definitions, keyed by role. */
  readonly nested: Readonly<Record<string, NestedSnapshot>>;
};

export type NestedSnapshot = { readonly defs: readonly PropDef[]; readonly snapshot: InstanceSnapshot };

export type ReverseResult = {
  readonly args: Readonly<Record<string, ArgValue>>;
  /** Property values with no `valueMap` / `preferredValues` entry (`DCR_PROPERTY_UNMAPPED`). */
  readonly unmapped: readonly { readonly key: string; readonly figma: JsonValue }[];
  /** Overrides that properties do not explain (`instance.deviation`). */
  readonly deviations: readonly { readonly role: string; readonly fields: readonly string[] }[];
  readonly nested: Readonly<Record<string, ReverseResult>>;
};

/** Fields that only carry property plumbing, never a designer deviation. */
const PLUMBING_FIELDS = new Set(['componentProperties', 'componentPropertyReferences', 'pluginData', 'name']);

/** Override fields bound through `componentPropertyReferences` (`characters`, `visible`, `mainComponent`). */
function explainedFields(referenced: readonly string[] | undefined): Set<string> {
  const fields = new Set(referenced ?? []);
  // A TEXT property drives the characters and the styled segments that come with them.
  if (fields.has('characters')) fields.add('styledTextSegments');
  return fields;
}

export function reverseMap(defs: readonly PropDef[], snapshot: InstanceSnapshot): ReverseResult {
  const args: Record<string, ArgValue> = {};
  const unmapped: { key: string; figma: JsonValue }[] = [];
  const miss = (def: PropDef, figma: JsonValue) => {
    args[def.argName] = { unmapped: figma };
    unmapped.push({ key: def.key, figma });
  };

  for (const def of defs) {
    switch (def.type) {
      case 'VARIANT':
      case 'BOOLEAN': {
        const raw = def.type === 'VARIANT' ? snapshot.variant[def.figmaName] : snapshot.props[def.figmaName];
        if (raw === undefined) {
          miss(def, null);
          break;
        }
        const entry = def.valueMap.find((candidate) => candidate.figma === String(raw));
        if (entry) args[def.argName] = entry.arg;
        else miss(def, raw);
        break;
      }
      case 'TEXT': {
        const raw = snapshot.props[def.figmaName];
        if (typeof raw === 'string') args[def.argName] = raw;
        else miss(def, raw ?? null);
        break;
      }
      case 'INSTANCE_SWAP': {
        const sid = snapshot.swaps[def.figmaName];
        const entry = def.preferredValues.find((candidate) => candidate.sid === sid);
        if (entry) args[def.argName] = entry.arg;
        else miss(def, sid ?? null);
        break;
      }
    }
  }

  const deviations = snapshot.overrides
    .map(({ role, fields }) => {
      const explained = explainedFields(snapshot.referencedFields[role]);
      return { role, fields: fields.filter((field) => !explained.has(field) && !PLUMBING_FIELDS.has(field)).sort() };
    })
    .filter(({ fields }) => fields.length > 0)
    .sort((a, b) => a.role.localeCompare(b.role));

  const nested: Record<string, ReverseResult> = {};
  for (const [role, entry] of Object.entries(snapshot.nested)) nested[role] = reverseMap(entry.defs, entry.snapshot);

  return { args, unmapped, deviations, nested };
}

export function isUnmapped(value: ArgValue): value is Unmapped {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'unmapped' in value;
}

export type ForwardResult = {
  /** VARIANT values by Figma axis name. */
  readonly variant: Readonly<Record<string, string>>;
  /** BOOLEAN / TEXT values by display name. */
  readonly props: Readonly<Record<string, string | boolean>>;
  /** INSTANCE_SWAP targets (`sid`) by display name. */
  readonly swaps: Readonly<Record<string, string>>;
};

/**
 * Args → Figma property values. An unmapped arg carries its Figma value through unchanged,
 * which is what the DCR does too (15 §4.5 rule 4).
 */
export function forwardMap(defs: readonly PropDef[], args: Readonly<Record<string, ArgValue>>): ForwardResult {
  const variant: Record<string, string> = {};
  const props: Record<string, string | boolean> = {};
  const swaps: Record<string, string> = {};
  for (const def of defs) {
    const value = args[def.argName];
    if (value === undefined) continue;
    const raw = isUnmapped(value) ? value.unmapped : null;
    switch (def.type) {
      case 'VARIANT':
      case 'BOOLEAN': {
        const figma = isUnmapped(value)
          ? raw
          : def.valueMap.find((entry) => JSON.stringify(entry.arg) === JSON.stringify(value))?.figma;
        if (figma === undefined || figma === null) break;
        if (def.type === 'VARIANT') variant[def.figmaName] = String(figma);
        else props[def.figmaName] = typeof figma === 'boolean' ? figma : figma === 'true';
        break;
      }
      case 'TEXT':
        if (typeof value === 'string') props[def.figmaName] = value;
        else if (typeof raw === 'string') props[def.figmaName] = raw;
        break;
      case 'INSTANCE_SWAP': {
        const sid = isUnmapped(value)
          ? raw
          : def.preferredValues.find((entry) => JSON.stringify(entry.arg) === JSON.stringify(value))?.sid;
        if (typeof sid === 'string') swaps[def.figmaName] = sid;
        break;
      }
    }
  }
  return { variant, props, swaps };
}

export type RoundTripDiff = { readonly field: string; readonly before: JsonValue; readonly after: JsonValue };

/** Differences between the original instance and the rebuilt one, over what properties carry. */
export function compareSnapshots(before: InstanceSnapshot, after: InstanceSnapshot): RoundTripDiff[] {
  const diffs: RoundTripDiff[] = [];
  const compare = (prefix: string, a: Readonly<Record<string, JsonValue>>, b: Readonly<Record<string, JsonValue>>) => {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const left = a[key] ?? null;
      const right = b[key] ?? null;
      if (JSON.stringify(left) !== JSON.stringify(right))
        diffs.push({ field: `${prefix}.${key}`, before: left, after: right });
    }
  };
  compare('variant', before.variant, after.variant);
  compare('props', before.props, after.props);
  compare('swaps', before.swaps, after.swaps);
  for (const role of [...new Set([...Object.keys(before.nested), ...Object.keys(after.nested)])].sort()) {
    const a = before.nested[role]?.snapshot;
    const b = after.nested[role]?.snapshot;
    if (a && b) for (const diff of compareSnapshots(a, b)) diffs.push({ ...diff, field: `${role}.${diff.field}` });
  }
  return diffs;
}
