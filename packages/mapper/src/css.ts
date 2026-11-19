import type { CComputed, CNode, Color, Mat2x3 } from '@holotype/ir';
import { hasArea } from './geometry';

/*
 * Facts about computed CSS that several stages need. Sides and corners are in CSS order:
 * top, right, bottom, left and top-left, top-right, bottom-right, bottom-left.
 */

export const SIDES = ['t', 'r', 'b', 'l'] as const;
export type Side = (typeof SIDES)[number];

const INVISIBLE_BORDER_STYLES = new Set(['none', 'hidden']);

export const isTransparent = (color: Color): boolean => color.a <= 0;

/** The same color in the same space, up to ratio rounding (06 §5). */
export const sameColor = (a: Color, b: Color): boolean =>
  a.space === b.space &&
  Math.abs(a.r - b.r) < 1e-6 &&
  Math.abs(a.g - b.g) < 1e-6 &&
  Math.abs(a.b - b.b) < 1e-6 &&
  Math.abs(a.a - b.a) < 1e-6;

/** Whether border side `i` (0 = top) draws anything. */
export function borderSideVisible(computed: CComputed, i: number): boolean {
  const width = computed.border.width[i] ?? 0;
  const style = computed.border.style[i] ?? 'none';
  const color = computed.border.color[i];
  return width > 0 && !INVISIBLE_BORDER_STYLES.has(style) && color !== undefined && !isTransparent(color);
}

export function outlineVisible(computed: CComputed): boolean {
  const { outline } = computed;
  return outline !== undefined && outline.width > 0 && outline.style !== 'none' && !isTransparent(outline.color);
}

/** A CSS value that is set to something (`none`, `auto` and empty mean unset). */
export const isSet = (value: string | undefined): value is string =>
  value !== undefined && value !== '' && value !== 'none' && value !== 'auto';

/** Whether the element's own box paints anything: background, border, shadow or outline. */
export function hasOwnPaint(node: CNode): boolean {
  const computed = node.computed;
  if (!computed) return false;
  // Shadows and outlines paint outside the box, so they show even on a zero-size box.
  if (computed.boxShadow.length > 0 || outlineVisible(computed)) return true;
  if (!hasArea(node.borderBox)) return false;
  if (!isTransparent(computed.background.color) || computed.background.layers.length > 0) return true;
  return SIDES.some((_, i) => borderSideVisible(computed, i));
}

const IDENTITY: Mat2x3 = [
  [1, 0, 0],
  [0, 1, 0],
];

/** Whether a page-space transform is more than the identity (a translation is already in the rect). */
export function isTransformed(transform: Mat2x3 | undefined): boolean {
  if (transform === undefined) return false;
  return transform.some((row, r) =>
    row.slice(0, 2).some((value, c) => Math.abs(value - (IDENTITY[r]?.[c] ?? 0)) > 1e-9),
  );
}
