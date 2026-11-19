/** Latency statistics for the S-07 report. Pure. */

export interface LatencySummary {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
}

/** Nearest-rank percentile of an ascending list; `q` in (0, 1]. */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new RangeError('percentile() of an empty list.');
  if (!(q > 0 && q <= 1)) throw new RangeError(`percentile q must be in (0, 1], got ${q}.`);
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.min(sorted.length, rank) - 1] as number;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Summary of a latency sample in ms, rounded to 0.1 ms. */
export function summarize(values: readonly number[]): LatencySummary {
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`Latencies must be finite and ≥ 0, got ${value}.`);
  }
  if (values.length === 0) return { n: 0, p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    n: sorted.length,
    p50: round1(percentile(sorted, 0.5)),
    p95: round1(percentile(sorted, 0.95)),
    p99: round1(percentile(sorted, 0.99)),
    mean: round1(sum / sorted.length),
    min: round1(sorted[0] as number),
    max: round1(sorted.at(-1) as number),
  };
}

/** Variants per second over a wall-clock duration, to 0.1. */
export function throughput(count: number, wallMs: number): number {
  if (wallMs <= 0) throw new RangeError(`Wall time must be positive, got ${wallMs}.`);
  return round1((count * 1000) / wallMs);
}

/** `a / b` as a ratio to two decimals (`speedup(urlMs, channelMs)`). */
export function ratio(a: number, b: number): number {
  if (b <= 0) throw new RangeError(`Ratio denominator must be positive, got ${b}.`);
  return Math.round((a / b) * 100) / 100;
}
