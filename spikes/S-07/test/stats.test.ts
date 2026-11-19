import { describe, expect, it } from 'vitest';
import { percentile, ratio, summarize, throughput } from '../stats.ts';

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0.5)).toBe(5);
    expect(percentile(sorted, 0.95)).toBe(10);
    expect(percentile(sorted, 0.1)).toBe(1);
    expect(percentile([42], 0.99)).toBe(42);
  });

  it('rejects an empty list and a q outside (0, 1]', () => {
    expect(() => percentile([], 0.5)).toThrow(RangeError);
    expect(() => percentile([1], 0)).toThrow(/\(0, 1\]/);
    expect(() => percentile([1], 1.5)).toThrow(RangeError);
  });
});

describe('summarize', () => {
  it('summarizes unsorted latencies, rounded to 0.1 ms', () => {
    expect(summarize([30.04, 10, 20, 40.26])).toEqual({
      n: 4,
      p50: 20,
      p95: 40.3,
      p99: 40.3,
      mean: 25.1,
      min: 10,
      max: 40.3,
    });
  });

  it('gives zeros for an empty sample', () => {
    expect(summarize([])).toEqual({ n: 0, p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0 });
  });

  it('rejects negative and non-finite values', () => {
    expect(() => summarize([1, -1])).toThrow(/finite and ≥ 0/);
    expect(() => summarize([Number.NaN])).toThrow(RangeError);
  });
});

describe('throughput and ratio', () => {
  it('gives variants per second', () => {
    expect(throughput(200, 10_000)).toBe(20);
    expect(throughput(3, 7000)).toBe(0.4);
    expect(() => throughput(1, 0)).toThrow(RangeError);
  });

  it('gives a two-decimal ratio', () => {
    expect(ratio(17.3, 3.8)).toBe(4.55);
    expect(() => ratio(1, 0)).toThrow(/denominator/);
  });
});
