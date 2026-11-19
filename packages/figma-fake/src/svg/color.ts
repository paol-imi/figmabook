import { unsupported } from '../errors';

/** CSS colours used by SVG paint attributes (https://www.w3.org/TR/css-color-3/#html4, plus a few common names). */
const NAMED: Readonly<Record<string, readonly [number, number, number]>> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  lime: [0, 255, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  aqua: [0, 255, 255],
  magenta: [255, 0, 255],
  fuchsia: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  purple: [128, 0, 128],
  teal: [0, 128, 128],
  navy: [0, 0, 128],
  orange: [255, 165, 0],
};

/** A parsed colour: channels and alpha in [0, 1]. */
export type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function channel(text: string): number {
  const value = text.trim();
  return clamp(value.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value) / 255);
}

/**
 * Parses an SVG colour: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`, a CSS colour
 * name, `currentColor` (black: there is no inherited `color` in an imported file) or
 * `transparent`. Returns `null` for `none`. Other syntaxes (hsl, system colours) are hardening.
 */
export function parseColor(value: string): Rgba | null {
  const text = value.trim();
  const lower = text.toLowerCase();
  if (lower === 'none') return null;
  if (lower === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (lower === 'currentcolor') return { r: 0, g: 0, b: 0, a: 1 };
  const named = NAMED[lower];
  if (named) return { r: named[0] / 255, g: named[1] / 255, b: named[2] / 255, a: 1 };
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const digits = hex.length <= 4 ? [...hex].map((c) => c + c) : (hex.match(/../g) ?? []);
    const [r, g, b, a] = digits.map((pair) => Number.parseInt(pair, 16) / 255);
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a ?? 1 };
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(text)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean);
    const [r = '0', g = '0', b = '0', a] = parts;
    const alpha = a === undefined ? 1 : a.endsWith('%') ? Number.parseFloat(a) / 100 : Number.parseFloat(a);
    return { r: channel(r), g: channel(g), b: channel(b), a: clamp(alpha) };
  }
  return unsupported(`createNodeFromSvg colour "${value}"`, 'hardening');
}
