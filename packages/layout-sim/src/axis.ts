import type { Size } from '@holotype/ir';
import type { AssumptionLog } from './assumptions';
import type { SimNode, Sizing, StackSpec } from './types';

/** `h` = x/width, `v` = y/height. */
export type Axis = 'h' | 'v';

/** Distances from each edge of a frame to its content box. */
export interface Insets {
  readonly t: number;
  readonly r: number;
  readonly b: number;
  readonly l: number;
}

export function isStack(layout: SimNode['layout']): layout is StackSpec {
  return layout !== undefined && layout.mode !== 'GRID';
}

export function primaryAxis(spec: StackSpec): Axis {
  return spec.mode === 'HORIZONTAL' ? 'h' : 'v';
}

export function crossAxis(axis: Axis): Axis {
  return axis === 'h' ? 'v' : 'h';
}

export function length(size: Size, axis: Axis): number {
  return axis === 'h' ? size.w : size.h;
}

export function sizeFrom(axis: Axis, main: number, cross: number): Size {
  return axis === 'h' ? { w: main, h: cross } : { w: cross, h: main };
}

/** The sizing mode a stack's own `*AxisSizingMode` gives on `axis`. */
export function stackSizing(spec: StackSpec, axis: Axis): Sizing {
  const mode = axis === primaryAxis(spec) ? spec.primaryAxisSizingMode : spec.counterAxisSizingMode;
  return mode === 'AUTO' ? 'HUG' : 'FIXED';
}

/** The node's resizing on `axis`: explicit, else from its stack sizing modes, else FIXED. */
export function sizingOf(node: SimNode, axis: Axis): Sizing {
  const explicit = axis === 'h' ? node.sizingH : node.sizingV;
  if (explicit !== undefined) return explicit;
  return isStack(node.layout) ? stackSizing(node.layout, axis) : 'FIXED';
}

export function inFlow(node: SimNode): boolean {
  return node.visible !== false && node.positioning !== 'ABSOLUTE';
}

export function isAutoGap(spec: StackSpec): boolean {
  const align = spec.primaryAxisAlignItems;
  return align === 'SPACE_BETWEEN' || align === 'SPACE_EVENLY' || align === 'SPACE_AROUND';
}

/** Padding plus, when strokes are included in layout, the frame's inside stroke. */
export function insetsOf(node: SimNode, spec: StackSpec, log: AssumptionLog): Insets {
  const { padding } = spec;
  const stroke = node.stroke;
  if (!spec.strokesIncludedInLayout || stroke === undefined) return padding;
  const { weight } = stroke;
  if (weight.t === 0 && weight.r === 0 && weight.b === 0 && weight.l === 0) return padding;
  if (stroke.align !== 'INSIDE') {
    log.use('stroke-included-center-outside');
    return padding;
  }
  if (!(weight.t === weight.r && weight.r === weight.b && weight.b === weight.l)) log.use('stroke-included-per-side');
  return { t: padding.t + weight.t, r: padding.r + weight.r, b: padding.b + weight.b, l: padding.l + weight.l };
}

export function insetStart(insets: Insets, axis: Axis): number {
  return axis === 'h' ? insets.l : insets.t;
}

export function insetEnd(insets: Insets, axis: Axis): number {
  return axis === 'h' ? insets.r : insets.b;
}

export function insetSum(insets: Insets, axis: Axis): number {
  return insetStart(insets, axis) + insetEnd(insets, axis);
}
