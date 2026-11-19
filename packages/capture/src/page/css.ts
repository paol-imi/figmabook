/* Helpers for reading computed style values (page side). */
import type { Rect } from '@holotype/ir';

/** A computed length in px; `fallback` when the value is not a finite px number (`auto`, `normal`). */
export function px(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `true` when a computed length value is a finite px number. */
export function isPx(value: string): boolean {
  return /^-?[\d.]+(?:e-?\d+)?px$/.test(value.trim());
}

/** Four computed longhands in CSS order: top, right, bottom, left. */
export function sides<T>(read: (side: 'top' | 'right' | 'bottom' | 'left') => T): [T, T, T, T] {
  return [read('top'), read('right'), read('bottom'), read('left')];
}

/** `getBoundingClientRect` as an IR rect, in page space. */
export function rectOf(target: Element | Range): Rect {
  const { x, y, width, height } = target.getBoundingClientRect();
  return { x: x + scrollX, y: y + scrollY, w: width, h: height };
}

/** A `DOMRect` (client space) as an IR rect in page space. */
export function toPageRect(rect: DOMRectReadOnly): Rect {
  return { x: rect.x + scrollX, y: rect.y + scrollY, w: rect.width, h: rect.height };
}

/** The smallest rect holding every rect; `null` for none. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.w);
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
