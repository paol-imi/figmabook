import type { Rect } from '@holotype/ir';

/** Largest absolute edge difference between two boxes, in px (README §4 geometry metric). */
export function boxDelta(expected: Rect, actual: Rect): number {
  return Math.max(
    Math.abs(expected.x - actual.x),
    Math.abs(expected.y - actual.y),
    Math.abs(expected.x + expected.w - (actual.x + actual.w)),
    Math.abs(expected.y + expected.h - (actual.y + actual.h)),
  );
}

/** Nearest-rank percentile, `p` in [0, 100]. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('percentile of an empty list');
  if (p < 0 || p > 100) throw new RangeError(`percentile must be in [0, 100], got ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

export interface GeometryScore {
  readonly nodes: number;
  readonly p95: number;
  readonly max: number;
  /** Whether p95 meets the v1 target of ≤1px. */
  readonly pass: boolean;
}

/** Scores captured vs Figma boxes for every node of a variant. */
export function scoreGeometry(pairs: readonly (readonly [expected: Rect, actual: Rect])[]): GeometryScore {
  const deltas = pairs.map(([expected, actual]) => boxDelta(expected, actual));
  const p95 = percentile(deltas, 95);
  return { nodes: deltas.length, p95, max: Math.max(...deltas), pass: p95 <= 1 };
}
