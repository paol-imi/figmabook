import { CAP_NONFINITE_VALUE, createDiagnostic, HolotypeError } from '@holotype/shared';

/** How a number is rounded before serialization (06 §5). */
export type NumKind = 'px' | 'ratio' | 'matrix' | 'angle';

export type JsonPath = readonly (string | number)[];

/** Picks the rounding for a number from its location, normally derived from the schema. */
export type NumKindResolver = (path: JsonPath) => NumKind;

export interface CanonicalOptions {
  /** Rounding for numbers: one kind for the whole document, or per path. Default `px`. */
  readonly numKind?: NumKind | NumKindResolver;
}

const SCALE: Readonly<Record<NumKind, number>> = {
  px: 1e3, // lengths: 1/1000 px
  ratio: 1e6, // 0..1 colors, opacity, stop positions
  matrix: 1e6,
  angle: 1e3, // degrees, Capture IR only
};

/** Rounds a finite number per its kind and normalizes `-0` to `0`. */
export function normalizeNumber(value: number, kind: NumKind = 'px'): number {
  const scaled = value * SCALE[kind];
  // Beyond float precision rounding is a no-op (and the product may overflow).
  const rounded = Number.isFinite(scaled) ? Math.round(scaled) / SCALE[kind] : value;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Serializes a JSON-compatible value canonically (06 §5): object keys sorted by UTF-16
 * code unit, `undefined` properties omitted, numbers rounded per kind, strings NFC, no
 * whitespace. The same value always yields the same string, which makes it hashable.
 *
 * Throws a `HolotypeError` (`CAP_NONFINITE_VALUE`) for NaN or ±Infinity, and a `TypeError`
 * for anything that is not plain JSON data (undefined array items, functions, bigints,
 * class instances, cycles).
 */
export function canonicalJSON(value: unknown, options: CanonicalOptions = {}): string {
  const { numKind = 'px' } = options;
  const resolve: NumKindResolver = typeof numKind === 'function' ? numKind : () => numKind;
  return write(value, [], resolve, new Set());
}

function write(value: unknown, path: (string | number)[], resolve: NumKindResolver, ancestors: Set<object>): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value.normalize('NFC'));
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new HolotypeError(createDiagnostic(CAP_NONFINITE_VALUE, { value: String(value), pointer: pointer(path) }));
      }
      return JSON.stringify(normalizeNumber(value, resolve(path)));
    case 'object': {
      if (value === null) return 'null';
      if (ancestors.has(value)) throw new TypeError(`canonicalJSON: circular reference at ${pointer(path)}`);
      ancestors.add(value);
      const out = Array.isArray(value) ? writeArray(value, path, resolve, ancestors) : writeObject(value, path, resolve, ancestors);
      ancestors.delete(value);
      return out;
    }
    default:
      throw new TypeError(`canonicalJSON: ${typeof value} is not JSON data (at ${pointer(path)})`);
  }
}

function writeArray(items: readonly unknown[], path: (string | number)[], resolve: NumKindResolver, ancestors: Set<object>): string {
  const parts: string[] = [];
  for (let i = 0; i < items.length; i++) {
    path.push(i);
    if (items[i] === undefined) throw new TypeError(`canonicalJSON: undefined array item at ${pointer(path)}`);
    parts.push(write(items[i], path, resolve, ancestors));
    path.pop();
  }
  return `[${parts.join(',')}]`;
}

function writeObject(object: object, path: (string | number)[], resolve: NumKindResolver, ancestors: Set<object>): string {
  const proto: unknown = Object.getPrototypeOf(object);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`canonicalJSON: only plain objects are JSON data (at ${pointer(path)})`);
  }
  const entries = new Map<string, unknown>();
  for (const [rawKey, item] of Object.entries(object)) {
    if (item === undefined) continue;
    const key = rawKey.normalize('NFC');
    if (entries.has(key)) throw new TypeError(`canonicalJSON: keys collide after NFC normalization at ${pointer(path)}`);
    entries.set(key, item);
  }
  const parts: string[] = [];
  for (const key of [...entries.keys()].sort()) {
    path.push(key);
    parts.push(`${JSON.stringify(key)}:${write(entries.get(key), path, resolve, ancestors)}`);
    path.pop();
  }
  return `{${parts.join(',')}}`;
}

/** JSON pointer (RFC 6901) as a URI fragment, e.g. `#/variants/0/irh`. */
function pointer(path: JsonPath): string {
  return `#${path.map((segment) => `/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('')}`;
}
