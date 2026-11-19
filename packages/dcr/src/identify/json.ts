import type { JsonValue } from '@holotype/ir';
import { canonicalDcr } from '../schema';

/*
 * Small JSON helpers shared by the extractor. Inputs arrive with any object key order (the
 * shuffle test permutes them), so every walk over an object goes through `sortedKeys`, and
 * strings compare by UTF-16 code unit, never by locale (15 §4.9).
 */

export type JsonObject = { [key: string]: JsonValue };

/** Code-unit order for strings. */
export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The keys of an object in code-unit order. */
export const sortedKeys = (value: object): string[] => Object.keys(value).sort(compareStrings);

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A property of a JSON object, or `undefined` when the value is not an object. */
export const field = (value: unknown, key: string): JsonValue | undefined =>
  isObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;

export const asNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
export const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** Whether two JSON values are equal (canonical form, so key order never matters). */
export const sameJson = (a: unknown, b: unknown): boolean => canonicalDcr(a ?? null) === canonicalDcr(b ?? null);

/** Parses a plugin-data JSON string; `undefined` for a missing or malformed value. */
export function parseJson(text: string | undefined): JsonValue | undefined {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/** Unique strings in code-unit order. */
export const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort(compareStrings);
