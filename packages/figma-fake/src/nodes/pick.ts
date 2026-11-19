/**
 * A copy of `value` with only `keys`, like Figma's `getStyledTextSegments`, which returns only the
 * requested fields (typings:10025-10170).
 *
 * TypeScript cannot follow a runtime key filter, so the result is asserted to `Pick<T, K>`.
 * The assertion is sound: every key of `Pick<T, K>` is copied from `value`.
 */
export function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) out[key] = value[key];
  return out as Pick<T, K>;
}
