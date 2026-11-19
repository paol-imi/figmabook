import type { Mat2x3, Rect } from '@holotype/ir';

/*
 * Image placement for IMAGE paints (07 §10.1): CSS sizes and positions resolved to the image
 * rect inside a box, and the CROP `imageTransform` that draws that rect. All rects here are
 * relative to the painted node's border box.
 */

export interface Size {
  readonly w: number;
  readonly h: number;
}

/** A computed length: `Npx` or `N%` of `basis`; `undefined` for anything else (calc, keywords). */
function length(token: string, basis: number): number | undefined {
  const match = /^(-?\d*\.?\d+(?:e-?\d+)?)(px|%)$/.exec(token);
  if (!match) return token === '0' ? 0 : undefined;
  const value = Number(match[1]);
  return match[2] === '%' ? (value / 100) * basis : value;
}

/**
 * A computed `background-size` (not `cover`/`contain`) → the drawn image size. `auto` keeps
 * the natural size, or the natural ratio when the other side is given.
 */
export function resolveImageSize(value: string, natural: Size, area: Size): Size | undefined {
  const [first = 'auto', second = 'auto'] = value.trim().split(/\s+/);
  const w = first === 'auto' ? undefined : length(first, area.w);
  const h = second === 'auto' ? undefined : length(second, area.h);
  if ((first !== 'auto' && w === undefined) || (second !== 'auto' && h === undefined)) return undefined;
  if (natural.w <= 0 || natural.h <= 0) return undefined;
  if (w !== undefined && h !== undefined) return { w, h };
  if (w !== undefined) return { w, h: (w * natural.h) / natural.w };
  if (h !== undefined) return { w: (h * natural.w) / natural.h, h };
  return natural;
}

const X_KEYWORDS: Readonly<Record<string, number>> = { left: 0, center: 50, right: 100 };
const Y_KEYWORDS: Readonly<Record<string, number>> = { top: 0, center: 50, bottom: 100 };

/** One axis of a position: a keyword, a length, or `edge offset` (`right 10px`). */
function axisOffset(tokens: readonly string[], keywords: Readonly<Record<string, number>>, free: number) {
  const [first, second] = tokens;
  if (first === undefined) return undefined;
  const keyword = keywords[first];
  if (second === undefined) return keyword === undefined ? length(first, free) : (keyword / 100) * free;
  // `right 10px`: an offset from the far edge.
  const offset = length(second, free);
  if (keyword === undefined || offset === undefined) return undefined;
  return keyword === 100 ? free - offset : keyword === 0 ? offset : undefined;
}

/**
 * A computed `background-position` / `object-position` → the image's offset in its area.
 * `free` is the area size minus the image size (percentages align the image's own point).
 */
export function resolvePosition(value: string, free: Size): { x: number; y: number } | undefined {
  const tokens = value.trim().split(/\s+/);
  const [a, b, c, d] = tokens;
  if (tokens.length === 2 && a !== undefined && b !== undefined) {
    const x = axisOffset([a], X_KEYWORDS, free.w);
    const y = axisOffset([b], Y_KEYWORDS, free.h);
    return x === undefined || y === undefined ? undefined : { x, y };
  }
  if (tokens.length === 4 && a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
    const x = axisOffset([a, b], X_KEYWORDS, free.w);
    const y = axisOffset([c, d], Y_KEYWORDS, free.h);
    return x === undefined || y === undefined ? undefined : { x, y };
  }
  return undefined;
}

/**
 * The CROP transform that draws `image` (the image rect in the box) into a box of `box`
 * size: `[[bw/iw, 0, -ix/iw], [0, bh/ih, -iy/ih]]` (07 §10.1).
 */
export function cropTransform(image: Rect, box: Size): Mat2x3 {
  return [
    [box.w / image.w, 0, -image.x / image.w],
    [0, box.h / image.h, -image.y / image.h],
  ];
}
