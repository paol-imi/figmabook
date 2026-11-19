import type { CPaintOrder, Rect } from '@holotype/ir';
import { overlaps } from '../geometry';
import type { WorkNode } from '../state';

/*
 * CSS 2.1 Appendix E paint order (07 §7.1). Within a stacking context, boxes paint in these
 * layers, bottom to top: negative z-index, in-flow blocks, floats, inlines, positioned boxes
 * with `z-index: auto | 0` in tree order, positive z-index. A stacking context that is not
 * positioned (opacity, transform, a z-indexed flex item…) paints as positioned with z 0.
 */

type Layer = CPaintOrder['layer'];

const LAYER_RANK: Readonly<Record<Layer, number>> = {
  negative: 0,
  block: 1,
  float: 2,
  inline: 3,
  positioned: 4,
  positive: 5,
};

/** The layer a box paints in, with non-positioned stacking contexts lifted to `positioned`. */
export function effectiveLayer(paint: CPaintOrder): Layer {
  const flowLayer = paint.layer === 'block' || paint.layer === 'float' || paint.layer === 'inline';
  return paint.stackingContext && flowLayer ? 'positioned' : paint.layer;
}

/** Whether the box paints in a positioned layer of its stacking context (07 §7.3 escapes). */
export function isStackPositioned(paint: CPaintOrder): boolean {
  const layer = effectiveLayer(paint);
  return layer === 'negative' || layer === 'positioned' || layer === 'positive';
}

/** A sort key `[layer, z-index, tree order]`; compare with {@link compareKeys}. */
export type PaintKey = readonly [number, number, number];

export function paintKey(paint: CPaintOrder): PaintKey {
  const layer = effectiveLayer(paint);
  const z = (layer === 'negative' || layer === 'positive') && paint.zIndex !== 'auto' ? paint.zIndex : 0;
  return [LAYER_RANK[layer], z, paint.domIndex];
}

/** The key of a box painting in its own flow layer (no positioned ancestor in its context). */
export function flowKey(paint: CPaintOrder): PaintKey {
  return [LAYER_RANK[paint.layer], 0, paint.domIndex];
}

export function compareKeys(a: PaintKey, b: PaintKey): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The area a subtree paints into: the union of its boxes. */
function extent(node: WorkNode): Rect {
  let { x, y } = node.box;
  let right = x + node.box.w;
  let bottom = y + node.box.h;
  const visit = (current: WorkNode): void => {
    for (const child of current.children) {
      x = Math.min(x, child.box.x);
      y = Math.min(y, child.box.y);
      right = Math.max(right, child.box.x + child.box.w);
      bottom = Math.max(bottom, child.box.y + child.box.h);
      visit(child);
    }
  };
  visit(node);
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Children in paint order, bottom → top (Figma child order). Only boxes that overlap need
 * their CSS order; every other pair keeps its flow (DOM) order, because in auto layout
 * child order is flow order (07 §7.2). This is a topological sort of the "paints below"
 * constraints between overlapping siblings that takes the earliest child whenever it can,
 * so it is stable and leaves a tree without overlaps unchanged.
 */
export function sortByPaint(children: readonly WorkNode[]): WorkNode[] {
  const keys = children.map((child) => paintKey(child.capture.paint));
  const extents = children.map(extent);
  /** `below[j]`: children that must come before child j. */
  const below = children.map(() => new Set<number>());
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const [ki, kj, ei, ej] = [keys[i], keys[j], extents[i], extents[j]];
      if (ki === undefined || kj === undefined || ei === undefined || ej === undefined || !overlaps(ei, ej)) continue;
      if (compareKeys(ki, kj) <= 0) below[j]?.add(i);
      else below[i]?.add(j);
    }
  }
  const out: WorkNode[] = [];
  const placed = new Set<number>();
  while (out.length < children.length) {
    const next = children.findIndex((_, i) => !placed.has(i) && [...(below[i] ?? [])].every((k) => placed.has(k)));
    // A cycle cannot occur (the constraints follow one total order), but never loop forever.
    const pick = next >= 0 ? next : children.findIndex((_, i) => !placed.has(i));
    const child = children[pick];
    if (child === undefined) break;
    placed.add(pick);
    out.push(child);
  }
  return out;
}
