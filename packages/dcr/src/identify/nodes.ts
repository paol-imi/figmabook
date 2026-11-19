import type { BaselineSnapshot, SnapNode } from '../schema';
import { compareStrings } from './json';
import type { SnapshotIndex } from './snapshot-index';

/*
 * The layers of one managed variant against its baseline (15 §4.2): a node with an `nk`
 * unique in the variant is managed; a later copy of a duplicated `nk` and a node without one
 * are added; a baseline `nk` with no node left was removed. Locked subtrees are designer-owned
 * and skipped (15 §3.2). Only the top-most added or removed layer is reported: its subtree is
 * part of it.
 */

export interface AddedNode {
  readonly node: SnapNode;
  readonly parent: SnapNode;
  /** The `nk` this layer is a later copy of. */
  readonly copiedFrom?: string;
}

export interface VariantLayers {
  /** `nk` → the node that keeps it (first in layer order). */
  readonly managed: ReadonlyMap<string, SnapNode>;
  readonly added: readonly AddedNode[];
  /** Top-most baseline `nk`s with no node. */
  readonly removed: readonly string[];
}

/** Parent `nk` of every baseline node, from `order`. */
export function baselineParents(baseline: BaselineSnapshot): Map<string, string> {
  const parents = new Map<string, string>();
  for (const parent of Object.keys(baseline.order)) {
    for (const child of baseline.order[parent] ?? []) parents.set(child, parent);
  }
  return parents;
}

export function walkVariant(index: SnapshotIndex, variant: SnapNode, baseline: BaselineSnapshot): VariantLayers {
  const managed = new Map<string, SnapNode>();
  const locked = new Set<string>();
  const added: AddedNode[] = [];
  type Mode = 'managed' | 'added' | 'locked';
  const visit = (node: SnapNode, parent: SnapNode | undefined, inherited: Mode) => {
    const nk = parent === undefined ? 'root' : node.data.nk;
    let mode: Mode = inherited;
    if (inherited === 'locked' || node.data.lock === '1') {
      mode = 'locked';
      if (nk !== undefined) locked.add(nk);
    } else if (inherited === 'managed') {
      if (parent === undefined || (nk !== undefined && !managed.has(nk) && nk in baseline.nodes)) {
        managed.set(nk ?? 'root', node);
      } else {
        mode = 'added';
        added.push({ node, parent, ...(nk !== undefined && managed.has(nk) ? { copiedFrom: nk } : {}) });
      }
    }
    for (const child of index.children(node)) visit(child, node, mode);
  };
  visit(variant, undefined, 'managed');

  const parents = baselineParents(baseline);
  const missing = new Set(Object.keys(baseline.nodes).filter((nk) => !managed.has(nk) && !locked.has(nk)));
  const removed = [...missing].filter((nk) => {
    const parent = parents.get(nk);
    return parent === undefined || !missing.has(parent);
  });
  return { managed, added, removed: removed.sort(compareStrings) };
}
