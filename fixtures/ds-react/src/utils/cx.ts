/** A class name, or a falsy value to skip (CSS-module lookups may be `undefined`). */
export type ClassValue = string | false | null | undefined;

/** Joins the truthy class names with single spaces, in order. */
export function cx(...classes: readonly ClassValue[]): string {
  return classes.filter((c): c is string => typeof c === 'string' && c.length > 0).join(' ');
}
