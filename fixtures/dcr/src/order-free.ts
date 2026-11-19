import type { BaselineSnapshot, FigmaSnapshot, SnapNode } from '@holotype/dcr';
import type { FixtureProvenance } from './schemas.ts';

/*
 * Which input arrays carry no meaning in their order (12 §2.4 "Determinism test"). The
 * shuffle permutes exactly these (plus every object's key order); everything else keeps its
 * order because it means something: `children` is layer order (auto-layout order), baseline
 * `order` is managed child order, axes, axis values and paints are ordered by Figma.
 *
 * `canonicalSnapshot` sorts the same arrays, so it is the form a snapshot hash is taken over.
 */

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function sortedBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => byCodeUnit(key(a), key(b)));
}

/** A node with its order-free arrays sorted. */
function canonicalNode(node: SnapNode): SnapNode {
  const out: SnapNode = { ...node };
  if (node.annotations) {
    out.annotations = sortedBy(node.annotations, (a) => JSON.stringify([a.label, a.category ?? '']));
  }
  if (node.instance) {
    out.instance = {
      ...node.instance,
      overrides: sortedBy(
        node.instance.overrides.map((o) => ({ ...o, fields: [...o.fields].sort(byCodeUnit) })),
        (o) => o.id,
      ),
    };
  }
  return out;
}

/**
 * The snapshot in canonical array order, without `fileVersion` (outside the core, D-48):
 * pages by id, their top-level node ids, annotations, overrides and override fields sorted.
 * Two snapshots that differ only in those orders (and in object key order) are equal here.
 */
export function canonicalSnapshot(snapshot: FigmaSnapshot): FigmaSnapshot {
  const { fileVersion: _version, ...rest } = snapshot;
  return {
    ...rest,
    pages: sortedBy(
      snapshot.pages.map((page) => ({ ...page, topLevel: [...page.topLevel].sort(byCodeUnit) })),
      (page) => page.id,
    ),
    nodes: Object.fromEntries(Object.entries(snapshot.nodes).map(([id, node]) => [id, canonicalNode(node)])),
  };
}

/** Baselines in canonical order: by `(sid, vk, set snapshot last)`. Their content has no order-free arrays. */
export function canonicalBaselines(baselines: readonly BaselineSnapshot[]): BaselineSnapshot[] {
  return sortedBy(baselines, (b) => JSON.stringify([b.sid, b.vk, b.props === undefined ? 0 : 1]));
}

/** Provenance in canonical order: components by sid. */
export function canonicalProvenance(provenance: FixtureProvenance): FixtureProvenance {
  return { ...provenance, components: sortedBy(provenance.components, (c) => c.code.sid) };
}
