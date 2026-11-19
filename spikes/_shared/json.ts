/** JSON values: everything a spike returns must survive `postMessage` and `JSON.stringify`. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

/** Message of any thrown value, without stack traces (they can carry local paths). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** Rounds to 1/1000, the canonical precision of 06 §8, so results are stable across runs. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
