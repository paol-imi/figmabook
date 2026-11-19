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
