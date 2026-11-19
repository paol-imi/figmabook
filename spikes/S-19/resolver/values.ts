/**
 * Value helpers: which component of a box shorthand sets a longhand, and a light normalization
 * that lets an authored literal be compared with Chromium's computed serialization (S-19 uses it
 * to pick the `var()` of a multi-value shorthand and to check that the chosen winner explains the
 * computed value). Unknown forms compare as `undefined`, never as equal.
 */
import { splitTopLevel } from './css-text.ts';
import type { Direction } from './longhands.ts';

type Side = 'top' | 'right' | 'bottom' | 'left';

/** Index into a 1–4 value box list (`padding: a b c d`) for a side. */
function boxIndex(count: number, side: Side): number {
  const order: Record<Side, readonly number[]> = {
    top: [0, 0, 0, 0],
    right: [0, 1, 1, 1],
    bottom: [0, 0, 2, 2],
    left: [0, 1, 1, 3],
  };
  return order[side][count - 1] ?? -1;
}

function pairIndex(count: number, second: boolean): number {
  if (count === 1) return 0;
  if (count === 2) return second ? 1 : 0;
  return -1;
}

const SIDE_OF = /-(top|right|bottom|left)(?:-|$)/;

/**
 * The component of `shorthand`'s value that sets `longhand`, for the box-like shorthands whose
 * grammar is positional (padding, border-width, border-color, gap, border-radius and their logical
 * pairs). `undefined` for other shorthands, where the caller matches values instead.
 */
export function shorthandComponent(
  shorthand: string,
  value: string,
  longhand: string,
  direction: Direction = 'ltr',
): string | undefined {
  if (shorthand === longhand) return value.trim();
  const parts = splitTopLevel(value, ' ');
  const count = parts.length;
  const side = SIDE_OF.exec(longhand)?.[1] as Side | undefined;
  const inlineStart = direction === 'ltr' ? 'left' : 'right';
  let index = -1;
  switch (shorthand) {
    case 'padding':
    case 'border-width':
    case 'border-color':
      if (side !== undefined && count <= 4) index = boxIndex(count, side);
      break;
    case 'padding-inline':
    case 'border-inline-width':
    case 'border-inline-color':
      if (side === 'left' || side === 'right') index = pairIndex(count, side !== inlineStart);
      break;
    case 'padding-block':
    case 'border-block-width':
    case 'border-block-color':
      if (side === 'top' || side === 'bottom') index = pairIndex(count, side === 'bottom');
      break;
    case 'gap':
    case 'grid-gap':
      index = pairIndex(count, longhand === 'column-gap');
      break;
    case 'border-radius': {
      const horizontal = splitTopLevel(value.split('/')[0] ?? '', ' ');
      const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
      const corner = corners.indexOf(longhand.replace(/^border-|-radius$/g, ''));
      const byCount = [
        [0, 0, 0, 0],
        [0, 1, 0, 1],
        [0, 1, 2, 1],
        [0, 1, 2, 3],
      ][horizontal.length - 1];
      const at = byCount?.[corner];
      return at === undefined ? undefined : horizontal[at];
    }
    default:
      return undefined;
  }
  return index < 0 ? undefined : parts[index];
}

/** Chromium's alpha serialization: the shortest decimal (≤ 3 digits) that maps back to the byte. */
function serializeAlpha(byte: number): number {
  for (const scale of [10, 100]) {
    const candidate = Math.round((byte / 255) * scale) / scale;
    if (Math.round(candidate * 255) === byte) return candidate;
  }
  return Math.round((byte / 255) * 1000) / 1000;
}

function hexToRgb(hex: string): string | undefined {
  const digits = hex.slice(1);
  const full =
    digits.length === 3 || digits.length === 4
      ? [...digits].map((d) => d + d).join('')
      : digits.length === 6 || digits.length === 8
        ? digits
        : undefined;
  if (full === undefined || !/^[0-9a-f]+$/i.test(full)) return undefined;
  const channel = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
  const [r, g, b] = [channel(0), channel(2), channel(4)];
  if (full.length === 6) return `rgb(${r}, ${g}, ${b})`;
  const alpha = serializeAlpha(channel(6));
  return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const CONTEXT_KEYWORDS = new Set(['currentcolor', 'inherit', 'initial', 'unset', 'revert', 'auto', 'none']);
const FONT_WEIGHTS: Record<string, string> = { normal: '400', bold: '700' };

/**
 * A comparable form of a CSS value: lower case, collapsed spaces, `#hex` and `transparent` as
 * `rgb()`/`rgba()`, unquoted family names, `0` as `0px`, `px` numbers without trailing zeros.
 * Returns undefined for forms it does not know to be final (anything with `var(`, `calc(`,
 * `color-mix(`, relative units other than `px`).
 */
export function comparableValue(value: string): string | undefined {
  let text = value.trim().replace(/\s+/g, ' ');
  if (text === '' || /\b(?:var|calc|color-mix|env|attr|min|max|clamp|[a-z-]*gradient|url|image-set)\(/i.test(text)) {
    return undefined;
  }
  if (/^#[0-9a-f]+$/i.test(text)) return hexToRgb(text);
  const lower = text.toLowerCase();
  // Context-dependent keywords: their value is not in the text.
  if (CONTEXT_KEYWORDS.has(lower)) return undefined;
  if (lower === 'transparent') return 'rgba(0, 0, 0, 0)';
  if (FONT_WEIGHTS[lower] !== undefined) return FONT_WEIGHTS[lower];
  if (lower === '0') return '0px';
  // A bare identifier may be a named color or a keyword: only equal text compares (sameValue).
  if (/^[a-z-]+$/.test(lower)) return undefined;
  if (/^-?\d*\.?\d+px$/.test(lower)) return `${Number.parseFloat(lower)}px`;
  if (/^-?\d*\.?\d+$/.test(lower)) return String(Number.parseFloat(lower));
  if (/^-?\d*\.?\d+(?:r?em|%|vh|vw|ch|ex)$/.test(lower)) return undefined;
  if (/^[a-z-]+\(/.test(lower) && !/^rgba?\(/.test(lower)) return undefined;
  if (/^rgba?\(/.test(lower)) {
    const nums = lower.match(/-?\d*\.?\d+/g) ?? [];
    const [r, g, b, a] = nums.map(Number.parseFloat);
    if (a === undefined || a === 1) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  // Families: Chromium serializes quoted names without quotes when they are valid identifiers.
  if (text.includes(',') || /^["']/.test(text)) {
    text = splitTopLevel(text, ',')
      .map((family) => family.replace(/^["'](.*)["']$/, '$1'))
      .join(', ');
  }
  return text.toLowerCase();
}

/** True when equal as text or after normalization; false when both are comparable and differ; else undefined. */
export function sameValue(authored: string, computed: string): boolean | undefined {
  const collapse = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (collapse(authored) === collapse(computed)) return true;
  const a = comparableValue(authored);
  const b = comparableValue(computed);
  if (a === undefined || b === undefined) return undefined;
  return a === b;
}
