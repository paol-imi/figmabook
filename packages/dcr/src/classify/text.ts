import type { JsonValue } from '@holotype/ir';
import type { ValueKind } from '../diff/field-info';
import { rgbaOf } from '../diff/tokens';
import { asNumber, field, isObject } from '../identify/json';
import type { SetAxis } from '../identify/snapshot-index';
import { canonicalDcr, type VariantValues } from '../schema';

/*
 * The words of titles, headlines and questions (15 §6 "title", §7.4). Every text is built
 * from templates and normalized values, never from free text, so the same change always reads
 * the same. Designer text (layer, component and property names) is inserted as data; the
 * renderers fence or escape it (D-38).
 */

export const ARROW = '→';
export const DOT = '·';

export const capFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
export const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** Words of a Figma name: `Show icon` → `show`, `icon`. */
const words = (name: string): string[] => name.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);

/** The inverse of the Title Case rule (15 §6 notes): `With media` → `with-media`. */
export const kebab = (value: string): string =>
  words(value)
    .map((word) => word.toLowerCase())
    .join('-');

/** An arg name for a Figma property name: `Show icon` → `showIcon`. */
export function camelCase(name: string): string {
  const parts = words(name).map((word) => word.toLowerCase());
  return parts.map((part, i) => (i === 0 ? part : capFirst(part))).join('') || name;
}

/** An export name for a component name: `Product card` → `ProductCard` (15 §6 `suggested`). */
export function pascalCase(name: string): string {
  const joined = words(name)
    .map((word) => capFirst(word))
    .join('');
  return /^[A-Z]/.test(joined) ? joined : `Component${joined}`;
}

/** The Holotype arg name of an axis or property key: `arg:size` → `size`. */
export const argName = (key: string): string => (key.startsWith('arg:') ? key.slice('arg:'.length) : key);

const channel = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value * 255)))
    .toString(16)
    .padStart(2, '0');

/** `#rrggbb`, or `#rrggbbaa` when not opaque. */
export function hexColor(value: JsonValue | undefined): string | undefined {
  const rgba = rgbaOf(value);
  if (!rgba) return undefined;
  const hex = `#${channel(rgba.r)}${channel(rgba.g)}${channel(rgba.b)}`;
  return rgba.a < 1 ? `${hex}${channel(rgba.a)}` : hex;
}

/** A value as designers see it in Figma: `17`, `#2563eb`, `150%`, `Inter Semi Bold`. */
export function figmaValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return 'none';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => figmaValue(item)).join(', ');
  const hex = hexColor(value);
  if (hex) return hex;
  const unit = field(value, 'unit');
  if (typeof unit === 'string') {
    const amount = asNumber(field(value, 'value'));
    if (unit === 'PIXELS' && amount !== undefined) return String(amount);
    if (unit === 'PERCENT' && amount !== undefined) return `${amount}%`;
    return 'auto';
  }
  const family = field(value, 'family');
  if (typeof family === 'string') return `${family} ${String(field(value, 'style') ?? '')}`.trim();
  return canonicalDcr(value);
}

/** A value in CSS terms, with an amount to subtract for a border-included padding (D-16). */
export function cssValue(value: JsonValue | undefined, kind: ValueKind, offset = 0): string {
  if (typeof value === 'number') return String(roundPx(value - offset));
  if (isObject(value) && field(value, 'unit') === 'AUTO') return 'normal';
  if (kind === 'color') return hexColor(value) ?? figmaValue(value);
  return figmaValue(value);
}

/** Rounds to the normalizer's 1e-3 so arithmetic never shows float noise. */
export const roundPx = (value: number): number => {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
};

/** Variant values in axis order: `Variant=Secondary, Size=Md`. */
export function valuesText(values: VariantValues, axes: readonly SetAxis[]): string {
  return orderedAxes(values, axes)
    .map((name) => `${name}=${values[name]}`)
    .join(', ');
}

/** Variant values as args, in axis order: `variant=secondary, size=md`. */
export function argsText(
  values: VariantValues,
  axes: readonly SetAxis[],
  args: Readonly<Record<string, JsonValue>>,
): string {
  return orderedAxes(values, axes)
    .map((name) => {
      const key = axes.find((axis) => axis.name === name)?.key;
      const arg = key === undefined ? camelCase(name) : argName(key);
      const known = args[arg];
      const value =
        typeof known === 'string' || typeof known === 'number' || typeof known === 'boolean'
          ? String(known)
          : kebab(values[name] ?? '');
      return `${arg}=${value}`;
    })
    .join(', ');
}

/** The axis names of `values`: the set's axis order first, then any others by name. */
function orderedAxes(values: VariantValues, axes: readonly SetAxis[]): string[] {
  const known = axes.map((axis) => axis.name).filter((name) => Object.hasOwn(values, name));
  const others = Object.keys(values)
    .filter((name) => !known.includes(name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [...known, ...others];
}

/** `1 change`, `2 changes`. */
export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
