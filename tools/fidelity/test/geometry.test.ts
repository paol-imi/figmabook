import { describe, expect, it } from 'vitest';
import { boxDelta, percentile, scoreGeometry } from '../src';

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('geometry fidelity', () => {
  it('measures the worst edge difference', () => {
    expect(boxDelta(box(0, 0, 100, 40), box(0, 0, 100, 40))).toBe(0);
    expect(boxDelta(box(0, 0, 100, 40), box(0.5, 0, 101, 40))).toBe(1.5);
  });

  it('uses nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile([3, 1, 2], 50)).toBe(2);
    expect(() => percentile([], 50)).toThrow(RangeError);
  });

  it('passes when p95 is within 1px even if one node is off', () => {
    const pairs = Array.from({ length: 20 }, (_, i) => [box(0, i * 10, 50, 10), box(0, i * 10, i === 19 ? 54 : 50.4, 10)] as const);
    expect(scoreGeometry(pairs)).toEqual({ nodes: 20, p95: 0.4, max: 4, pass: true });
  });
});
