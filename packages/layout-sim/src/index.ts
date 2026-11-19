import type { Px, Rect } from '@holotype/ir';
import { NotImplementedError } from '@holotype/shared';

/** Auto-layout container settings, named after the Figma Plugin API properties. */
export interface AutoLayoutSpec {
  readonly layoutMode: 'HORIZONTAL' | 'VERTICAL';
  readonly paddingTop: Px;
  readonly paddingRight: Px;
  readonly paddingBottom: Px;
  readonly paddingLeft: Px;
  readonly itemSpacing: Px;
  readonly primaryAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  readonly counterAxisAlignItems: 'MIN' | 'CENTER' | 'MAX';
  /** Container size on each axis; `undefined` means HUG. */
  readonly width?: Px;
  readonly height?: Px;
}

/** A child with a FIXED size. FILL, HUG, min/max and wrap arrive with spike S-10. */
export interface LayoutChild {
  readonly width: Px;
  readonly height: Px;
}

export interface LayoutResult {
  /** Container size. */
  readonly width: Px;
  readonly height: Px;
  /** Child rects relative to the container, in child order. */
  readonly children: readonly Rect[];
}

export interface GridSpec {
  readonly columns: number;
  readonly rows: number;
}

/** The size a HUG container takes around its children. */
export function measureHug(spec: AutoLayoutSpec, children: readonly LayoutChild[]): { width: Px; height: Px } {
  const horizontal = spec.layoutMode === 'HORIZONTAL';
  const primary = children.reduce((sum, child) => sum + (horizontal ? child.width : child.height), 0);
  const gaps = Math.max(0, children.length - 1) * spec.itemSpacing;
  const counter = children.reduce((max, child) => Math.max(max, horizontal ? child.height : child.width), 0);
  const content = { primary: primary + gaps, counter };
  return {
    width: spec.paddingLeft + spec.paddingRight + (horizontal ? content.primary : content.counter),
    height: spec.paddingTop + spec.paddingBottom + (horizontal ? content.counter : content.primary),
  };
}

/** Lays out FIXED-size children the way Figma auto layout does (no wrap). */
export function simulateAutoLayout(spec: AutoLayoutSpec, children: readonly LayoutChild[]): LayoutResult {
  const hug = measureHug(spec, children);
  const width = spec.width ?? hug.width;
  const height = spec.height ?? hug.height;
  const horizontal = spec.layoutMode === 'HORIZONTAL';

  const [startPad, endPad] = horizontal ? [spec.paddingLeft, spec.paddingRight] : [spec.paddingTop, spec.paddingBottom];
  const [crossStart, crossEnd] = horizontal
    ? [spec.paddingTop, spec.paddingBottom]
    : [spec.paddingLeft, spec.paddingRight];
  const available = (horizontal ? width : height) - startPad - endPad;
  const crossAvailable = (horizontal ? height : width) - crossStart - crossEnd;
  const used = horizontal
    ? hug.width - spec.paddingLeft - spec.paddingRight
    : hug.height - spec.paddingTop - spec.paddingBottom;
  const free = available - used;

  let cursor = startPad;
  let gap = spec.itemSpacing;
  if (spec.primaryAxisAlignItems === 'CENTER') cursor += free / 2;
  else if (spec.primaryAxisAlignItems === 'MAX') cursor += free;
  else if (spec.primaryAxisAlignItems === 'SPACE_BETWEEN' && children.length > 1) {
    gap += free / (children.length - 1);
  }

  const rects = children.map((child): Rect => {
    const [main, cross] = horizontal ? [child.width, child.height] : [child.height, child.width];
    const crossFree = crossAvailable - cross;
    const crossOffset =
      crossStart +
      (spec.counterAxisAlignItems === 'CENTER' ? crossFree / 2 : spec.counterAxisAlignItems === 'MAX' ? crossFree : 0);
    const rect = horizontal
      ? { x: cursor, y: crossOffset, w: main, h: cross }
      : { x: crossOffset, y: cursor, w: cross, h: main };
    cursor += main + gap;
    return rect;
  });

  return { width, height, children: rects };
}

/** Figma GRID auto layout. Calibrated against real Figma in spike S-10. */
export function simulateGrid(_spec: GridSpec, _children: readonly LayoutChild[]): LayoutResult {
  throw new NotImplementedError('simulateGrid', 'Phase 2, spike S-10');
}
