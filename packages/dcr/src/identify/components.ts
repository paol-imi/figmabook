import type { JsonValue } from '@holotype/ir';
import type { BaselineSnapshot, SnapNode, VariantValues } from '../schema';
import { compareStrings, field, sameJson } from './json';
import type { SetAxis, SetSource, SnapshotIndex } from './snapshot-index';

/*
 * Identification of managed components (15 §4.2): a set with `holotype/sid`, its variants by
 * `vk`, and what the designer did to them. A variant whose name values equal its `vk`'s values
 * is the managed variant; another component with the same `vk` (a duplicate inherits plugin
 * data) is a new variant derived from it, and a baseline variant with no managed node left was
 * removed. The first matching node in layer order keeps the identity.
 */

/** Baselines by `(sid, vk)`; set snapshots (with `props`) apart from variant snapshots. */
export class BaselineIndex {
  private readonly variants = new Map<string, BaselineSnapshot>();
  private readonly sets = new Map<string, BaselineSnapshot>();

  constructor(baselines: readonly BaselineSnapshot[]) {
    for (const baseline of baselines) {
      if (baseline.props !== undefined) this.sets.set(baseline.sid, baseline);
      else this.variants.set(`${baseline.sid}\u0000${baseline.vk}`, baseline);
    }
  }

  variant(sid: string, vk: string): BaselineSnapshot | undefined {
    return this.variants.get(`${sid}\u0000${vk}`);
  }

  set(sid: string): BaselineSnapshot | undefined {
    return this.sets.get(sid);
  }

  /** The variant baselines of a component, by `vk`. */
  variantsOf(sid: string): BaselineSnapshot[] {
    return [...this.variants.values()]
      .filter((baseline) => baseline.sid === sid)
      .sort((a, b) => compareStrings(a.vk, b.vk));
  }
}

/** Parses a Figma variant name, `Variant=Primary, Size=Md`, into its values. */
export function parseVariantName(name: string): VariantValues {
  const values: VariantValues = {};
  for (const part of name.split(',')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    values[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return values;
}

/** The variant values a component shows now. */
export const currentValues = (node: SnapNode): VariantValues =>
  node.component?.variantValues ?? parseVariantName(node.name);

/** The variant values a baseline was applied with (its root layer name). */
export function baselineValues(baseline: BaselineSnapshot): VariantValues {
  const name = field(baseline.nodes.root?.vis, 'name');
  return typeof name === 'string' ? parseVariantName(name) : {};
}

export interface ManagedVariant {
  readonly node: SnapNode;
  readonly vk: string;
  readonly baseline: BaselineSnapshot;
  readonly values: VariantValues;
}

/** A component in a managed set that is not the managed variant of its `vk` (15 §4.2). */
export interface DerivedVariant {
  readonly node: SnapNode;
  readonly values: VariantValues;
  readonly from: ManagedVariantRef;
}

/** A baseline variant: what a derived or removed variant refers to. */
export interface ManagedVariantRef {
  readonly vk: string;
  readonly baseline: BaselineSnapshot;
  readonly values: VariantValues;
  /** The `args` of the variant as applied, when a node still carries them. */
  readonly args: Readonly<Record<string, JsonValue>>;
}

export interface ComponentModel {
  readonly set: SnapNode;
  readonly sid: string;
  readonly axes: readonly SetAxis[];
  readonly source: SetSource;
  /** The set snapshot (`props`, `nodes.set`), when embedded. */
  readonly setBaseline?: BaselineSnapshot;
  readonly managed: readonly ManagedVariant[];
  readonly derived: readonly DerivedVariant[];
  /** Components in the set without `vk` (not a duplicate of a managed variant). */
  readonly unkeyed: readonly SnapNode[];
  /** Variants with a `vk` but no baseline (DCR_BASELINE_MISSING). */
  readonly unbased: readonly SnapNode[];
  readonly removed: readonly ManagedVariantRef[];
}

/** Identifies the variants of a managed set (15 §4.2). */
export function identifyComponent(index: SnapshotIndex, baselines: BaselineIndex, set: SnapNode): ComponentModel {
  const sid = set.data.sid as string;
  const managed: ManagedVariant[] = [];
  const pending: Array<{ node: SnapNode; vk: string; baseline: BaselineSnapshot }> = [];
  const unkeyed: SnapNode[] = [];
  const unbased: SnapNode[] = [];
  const kept = new Set<string>();
  for (const node of index.children(set)) {
    if (node.type !== 'COMPONENT') continue;
    const vk = node.data.vk;
    if (vk === undefined) {
      unkeyed.push(node);
      continue;
    }
    const baseline = baselines.variant(sid, vk);
    if (!baseline) {
      unbased.push(node);
      continue;
    }
    const values = baselineValues(baseline);
    if (!kept.has(vk) && sameJson(currentValues(node), values)) {
      kept.add(vk);
      managed.push({ node, vk, baseline, values });
    } else {
      pending.push({ node, vk, baseline });
    }
  }
  const refOf = (vk: string, baseline: BaselineSnapshot): ManagedVariantRef => {
    const carrier = managed.find((variant) => variant.vk === vk)?.node ?? pending.find((p) => p.vk === vk)?.node;
    return { vk, baseline, values: baselineValues(baseline), args: carrier ? index.args(carrier) : {} };
  };
  const derived = pending.map(({ node, vk, baseline }) => ({
    node,
    values: currentValues(node),
    from: refOf(vk, baseline),
  }));
  const removed = baselines
    .variantsOf(sid)
    .filter((baseline) => !kept.has(baseline.vk))
    .map((baseline) => refOf(baseline.vk, baseline));
  const setBaseline = baselines.set(sid);
  return {
    set,
    sid,
    axes: index.axes(set),
    source: index.source(set),
    ...(setBaseline === undefined ? {} : { setBaseline }),
    managed,
    derived,
    unkeyed,
    unbased,
    removed,
  };
}
