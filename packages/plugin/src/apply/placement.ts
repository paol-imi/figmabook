/*
 * Where variant frames go on the page. Until component sets and Sections arrive (B-57), each
 * component's variants form the grid of `SceneVariant.grid` with the gap of `setLayout`, and
 * components are stacked top to bottom below whatever the page already holds.
 */
import type { Rect, SceneComponent } from '@holotype/ir';

/** Vertical space between two components on the page. */
export const COMPONENT_SPACING = 96;

/** The bottom edge of a page's content, or `null` for an empty page. */
export function contentBottom(page: ChildrenMixin): number | null {
  let bottom: number | null = null;
  for (const child of page.children) {
    if ('y' in child && 'height' in child) bottom = Math.max(bottom ?? child.y + child.height, child.y + child.height);
  }
  return bottom;
}

/** The top of the next component: below the page content, or at 0 on an empty page. */
export function nextComponentTop(page: ChildrenMixin): number {
  const bottom = contentBottom(page);
  return bottom === null ? 0 : bottom + COMPONENT_SPACING;
}

export interface VariantGrid {
  /** One box per variant, in `scene.variants` order, in page coordinates. */
  readonly boxes: readonly Rect[];
  /** The bottom edge of the grid. */
  readonly bottom: number;
}

/** Column widths and row heights are the largest variant in each track. */
export function variantGrid(scene: SceneComponent, origin: { readonly x: number; readonly y: number }): VariantGrid {
  const { gap } = scene.setLayout;
  const widths: number[] = [];
  const heights: number[] = [];
  for (const { grid, root } of scene.variants) {
    widths[grid.col] = Math.max(widths[grid.col] ?? 0, root.size.w);
    heights[grid.row] = Math.max(heights[grid.row] ?? 0, root.size.h);
  }
  const offsets = (sizes: readonly (number | undefined)[], spacing: number): number[] => {
    const out: number[] = [];
    let at = 0;
    for (let i = 0; i < sizes.length; i++) {
      out.push(at);
      at += (sizes[i] ?? 0) + spacing;
    }
    return out;
  };
  const xs = offsets(widths, gap.x);
  const ys = offsets(heights, gap.y);
  const boxes = scene.variants.map(({ grid, root }) => ({
    x: origin.x + (xs[grid.col] ?? 0),
    y: origin.y + (ys[grid.row] ?? 0),
    w: root.size.w,
    h: root.size.h,
  }));
  const bottom = Math.max(origin.y, ...boxes.map((box) => box.y + box.h));
  return { boxes, bottom };
}
