import { normalizeNumber, type Point, type Rect } from '@holotype/ir';

/** Rounds a length to the Scene IR grid of 1/1000 px (06 §5). */
export const px = (value: number): number => normalizeNumber(value, 'px');

/** `rect` relative to `origin`, rounded. */
export function relativeRect(rect: Rect, origin: Point): Rect {
  return { x: px(rect.x - origin.x), y: px(rect.y - origin.y), w: px(rect.w), h: px(rect.h) };
}

/** Lengths within this distance are the same (07 §4.4 `near`). */
export const NEAR_PX = 0.5;

export const hasArea = (rect: Rect): boolean => rect.w > 0 && rect.h > 0;

/** The overlap of two rects; empty (zero size) when they do not meet. */
export function intersectRects(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/** Whether two rects share some area (touching edges do not count). */
export const overlaps = (a: Rect, b: Rect): boolean => hasArea(intersectRects(a, b));

/** Per-side lengths in CSS order: top, right, bottom, left. */
export type SideLengths = readonly [number, number, number, number];

/** `rect` shrunk by per-side insets; never below zero size. */
export function insetRect(rect: Rect, [t, r, b, l]: SideLengths): Rect {
  return { x: rect.x + l, y: rect.y + t, w: Math.max(0, rect.w - l - r), h: Math.max(0, rect.h - t - b) };
}

/** `rect` grown by `by` on every side (a negative `by` shrinks it, never below zero size). */
export function inflateRect(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: Math.max(0, rect.w + 2 * by), h: Math.max(0, rect.h + 2 * by) };
}

/** Whether `inner` lies within `outer`, up to {@link NEAR_PX}. */
export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - NEAR_PX &&
    inner.y >= outer.y - NEAR_PX &&
    inner.x + inner.w <= outer.x + outer.w + NEAR_PX &&
    inner.y + inner.h <= outer.y + outer.h + NEAR_PX
  );
}
