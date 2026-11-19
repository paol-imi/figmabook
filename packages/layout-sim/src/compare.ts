import type { Rect } from '@holotype/ir';

/**
 * D-15 capture-side tolerance, px: auto layout is emitted for a container only if every
 * simulated box is within this of the browser measurement (07 §6.2; figit uses 0.6).
 */
export const TOL_SIM = 0.6;

export type RectField = keyof Rect;

/** The largest single-field difference found. */
export interface RectDelta {
  readonly key: string;
  readonly field: RectField;
  readonly actual: number;
  readonly expected: number;
  readonly delta: number;
}

export interface RectComparison {
  /** Largest |actual − expected| over x, y, w, h of every expected box; `Infinity` if any is missing. */
  readonly maxDelta: number;
  /** Where `maxDelta` was found (the first such field in expected order). Absent when nothing differs. */
  readonly worst?: RectDelta;
  /** Expected keys with no simulated box, in expected order. */
  readonly missing: readonly string[];
}

const FIELDS: readonly RectField[] = ['x', 'y', 'w', 'h'];

/**
 * Compares simulated boxes with expected ones (07 §6.2 `maxAbsDelta`). Only expected keys
 * are compared, so a container's `fallbackRects` can be checked against a deep simulation.
 */
export function compareRects(
  actual: ReadonlyMap<string, Rect>,
  expected: ReadonlyMap<string, Rect> | Readonly<Record<string, Rect>>,
): RectComparison {
  const entries: [string, Rect][] =
    expected instanceof Map ? [...expected.entries()] : Object.entries(expected as Readonly<Record<string, Rect>>);
  const missing: string[] = [];
  let worst: RectDelta | undefined;
  for (const [key, want] of entries) {
    const got = actual.get(key);
    if (got === undefined) {
      missing.push(key);
      continue;
    }
    for (const field of FIELDS) {
      const difference = Math.abs(got[field] - want[field]);
      const delta = Number.isNaN(difference) ? Number.POSITIVE_INFINITY : difference;
      if (delta > (worst?.delta ?? 0)) worst = { key, field, actual: got[field], expected: want[field], delta };
    }
  }
  const maxDelta = missing.length > 0 ? Number.POSITIVE_INFINITY : (worst?.delta ?? 0);
  return { maxDelta, missing, ...(worst === undefined ? {} : { worst }) };
}

/** True when nothing is missing and `maxDelta ≤ tolerance`. */
export function withinTolerance(comparison: RectComparison, tolerance: number = TOL_SIM): boolean {
  return comparison.missing.length === 0 && comparison.maxDelta <= tolerance;
}
