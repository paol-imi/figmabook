import { hoistEscapes } from '../order/hoist';
import { sortByPaint } from '../order/paint-order';
import type { WorkNode } from '../state';
import type { VariantStage } from './types';

/*
 * Stage 2, paint-order sort and hoisting (07 §7). Children are sorted bottom → top by the
 * CSS 2.1 Appendix E layers, which is Figma's child order; boxes that escape their parent's
 * paint order are hoisted to their stacking context. Portals stay last: they paint above
 * the story (03 §portals).
 *
 * Flow order versus paint order inside auto layout (07 §7.2: `itemReverseZIndex`, absolute
 * out-of-order children, `LAYOUT_ZORDER_FLOW_CONFLICT`) is decided by the layout stages
 * (B-49), which compare `children` with the capture's flow order.
 */

function sortTree(node: WorkNode, isPinned: (node: WorkNode) => boolean): void {
  const pinned = node.children.filter(isPinned);
  node.children = [...sortByPaint(node.children.filter((child) => !isPinned(child))), ...pinned];
  for (const child of node.children) sortTree(child, () => false);
}

export const orderStage: VariantStage = {
  step: 2,
  name: 'order',
  per: 'variant',
  run(variant) {
    const portals = new Set(variant.capture.portals);
    const isPortal = (node: WorkNode): boolean => portals.has(node.capture);
    sortTree(variant.root, isPortal);
    hoistEscapes(variant.root, isPortal);
  },
};
