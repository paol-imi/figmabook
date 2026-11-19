/*
 * Computed-color parsing (05 §7.1), page side. Chromium serializes sRGB colors as `rgb()` /
 * `rgba()`; wider or modern colors (`oklch()`, `color(display-p3 …)`, `lab()`) keep their own
 * syntax. This version converts sRGB syntaxes exactly and reads every other color back
 * through a 1×1 canvas, clipped to sRGB (`PAINT_COLOR_READBACK`). Full gamut mapping with
 * colorjs.io comes with the paint collectors (B-42).
 */
import type { Color } from '@holotype/ir';

const TRANSPARENT: Color = { r: 0, g: 0, b: 0, a: 0, space: 'srgb' };

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** One `rgb()` channel: a number in 0..255 or a percentage. */
function channel(token: string): number | null {
  if (token.endsWith('%')) {
    const pct = Number(token.slice(0, -1));
    return Number.isFinite(pct) ? clamp01(pct / 100) : null;
  }
  const value = Number(token);
  return Number.isFinite(value) ? clamp01(value / 255) : null;
}

/** An alpha value: a number in 0..1 or a percentage. */
function alpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const value = token.endsWith('%') ? Number(token.slice(0, -1)) / 100 : Number(token);
  return Number.isFinite(value) ? clamp01(value) : null;
}

/** A `color(srgb …)` component: a number in 0..1 or a percentage. */
function unit(token: string): number | null {
  const value = token.endsWith('%') ? Number(token.slice(0, -1)) / 100 : Number(token);
  return Number.isFinite(value) ? clamp01(value) : null;
}

/** Splits the inside of `fn(…)` into components and an optional alpha (`a, b, c[, d]` or `a b c [/ d]`). */
function components(inner: string): { values: string[]; alpha: string | undefined } | null {
  const trimmed = inner.trim();
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    return { values: parts.slice(0, 3), alpha: parts[3] };
  }
  const [main = '', slashAlpha] = trimmed.split('/').map((part) => part.trim());
  const values = main.split(/\s+/).filter((part) => part !== '');
  if (values.length !== 3) return null;
  return { values, alpha: slashAlpha };
}

function parseHex(hex: string): Color | null {
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  const expanded =
    hex.length === 3 || hex.length === 4
      ? [...hex].map((digit) => digit + digit).join('')
      : hex.length === 6 || hex.length === 8
        ? hex
        : null;
  if (expanded === null) return null;
  const byte = (index: number) => Number.parseInt(expanded.slice(index * 2, index * 2 + 2), 16) / 255;
  return { r: byte(0), g: byte(1), b: byte(2), a: expanded.length === 8 ? byte(3) : 1, space: 'srgb' };
}

function parseRgb(inner: string): Color | null {
  const parts = components(inner);
  if (parts === null) return null;
  const [r, g, b] = parts.values.map(channel);
  const a = alpha(parts.alpha);
  if (r == null || g == null || b == null || a === null) return null;
  return { r, g, b, a, space: 'srgb' };
}

function parseColorFunction(inner: string, original: string): Color | null {
  const match = /^\s*srgb\s+(.*)$/i.exec(inner);
  if (match === null) return null;
  const parts = components(match[1] ?? '');
  if (parts === null) return null;
  const [r, g, b] = parts.values.map(unit);
  const a = alpha(parts.alpha);
  if (r == null || g == null || b == null || a === null) return null;
  return { r, g, b, a, space: 'srgb', original };
}

/**
 * Parses a CSS color in an sRGB syntax: `transparent`, `#rgb[a]`, `#rrggbb[aa]`, `rgb()` /
 * `rgba()` (legacy and space-separated forms) and `color(srgb …)`. Returns `null` for any
 * other syntax; the caller reads those back through a canvas.
 */
export function parseCssColor(text: string): Color | null {
  const value = text.trim().toLowerCase();
  if (value === 'transparent') return { ...TRANSPARENT };
  if (value.startsWith('#')) return parseHex(value.slice(1));
  const fn = /^([a-z-]+)\((.*)\)$/.exec(value);
  if (fn === null) return null;
  const [, name, inner = ''] = fn;
  if (name === 'rgb' || name === 'rgba') return parseRgb(inner);
  if (name === 'color') return parseColorFunction(inner, text.trim());
  return null;
}

/** Reads a color back through a canvas: anything the browser can paint, clipped to sRGB. */
export type ColorReadback = (cssText: string) => Color | null;

/** A canvas read-back for the current document. One 1×1 canvas is reused. */
export function createCanvasReadback(doc: Document): ColorReadback {
  let context: CanvasRenderingContext2D | null | undefined;
  return (cssText) => {
    context ??= doc.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.clearRect(0, 0, 1, 1);
    // An unparseable fillStyle is ignored; a sentinel tells it apart from a real color.
    const sentinel = '#010203';
    context.fillStyle = sentinel;
    context.fillStyle = cssText;
    if (context.fillStyle === sentinel && cssText.trim().toLowerCase() !== sentinel) return null;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
    return { r: r / 255, g: g / 255, b: b / 255, a: a / 255, space: 'srgb', original: cssText.trim() };
  };
}

/** A resolved color and whether it needed the canvas read-back. */
export interface ResolvedColor {
  readonly color: Color;
  readonly readback: boolean;
}

/**
 * Resolves a computed color: exact for sRGB syntaxes, through `readback` otherwise. A color
 * neither path understands resolves to transparent black with `readback: true`, so the
 * caller reports it instead of failing the capture.
 */
export function resolveCssColor(text: string, readback: ColorReadback): ResolvedColor {
  const parsed = parseCssColor(text);
  if (parsed !== null) return { color: parsed, readback: false };
  return { color: readback(text) ?? { ...TRANSPARENT, original: text.trim() }, readback: true };
}
