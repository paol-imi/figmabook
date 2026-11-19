import { MIXED } from './mixed';

/** A JSON value, as stored in snapshots and the operation log. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** How `figma.mixed` appears in snapshots and the operation log. */
export const MIXED_JSON = '<figma.mixed>';

/**
 * Converts a Plugin API value to canonical JSON: object keys sorted, `undefined` members
 * dropped, `figma.mixed` spelled {@link MIXED_JSON}, bytes summarised by their length.
 * Two runs over the same document give the same bytes (BUILD §3.1 rule 4).
 */
export function toJson(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (value === MIXED) return MIXED_JSON;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'symbol':
      return String(value.description ?? 'symbol');
    case 'bigint':
      return value.toString();
    case 'function':
      return '<function>';
    default:
      break;
  }
  if (value instanceof Uint8Array) return { byteLength: value.byteLength };
  if (Array.isArray(value)) return value.map(toJson);
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    const member: unknown = Reflect.get(value, key);
    if (member !== undefined) out[key] = toJson(member);
  }
  return out;
}

/** Deep structural equality of two JSON-compatible values. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(toJson(a)) === JSON.stringify(toJson(b));
}
