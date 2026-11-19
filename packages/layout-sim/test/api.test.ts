import { describe, expect, it } from 'vitest';
import {
  compareRects,
  DEFAULT_FRAME_KEY,
  measureHug,
  type SceneGridLayout,
  SIMULATOR_VERSION,
  type StackSpec,
  simulateAutoLayout,
  simulateGrid,
  TOL_SIM,
  withinTolerance,
} from '../src';
import { codes, leaf, pad, ROW, rect, rectsOf, value } from './helpers';

const button: StackSpec = { ...ROW, padding: pad(8, 16), itemSpacing: 4, counterAxisAlignItems: 'CENTER' };
const icon = leaf('icon', 16, 16);
const label = leaf('label', 40, 20);

describe('simulateAutoLayout', () => {
  it('lays out one frame around its children, keyed by the default frame key', () => {
    const simulation = value(simulateAutoLayout(button, [icon, label], { size: { w: 120, h: 40 } }));
    expect(rectsOf(simulation)).toEqual({
      [DEFAULT_FRAME_KEY]: rect(0, 0, 120, 40),
      icon: rect(16, 12, 16, 16),
      label: rect(36, 10, 40, 20),
    });
  });

  it('uses the frame key, bounds and stroke', () => {
    const simulation = value(
      simulateAutoLayout({ ...button, primaryAxisSizingMode: 'AUTO', strokesIncludedInLayout: true }, [icon], {
        key: 'btn',
        size: { w: 0, h: 40 },
        min: { w: 60 },
        stroke: { align: 'INSIDE', weight: { t: 1, r: 1, b: 1, l: 1 } },
      }),
    );
    expect(simulation.size).toEqual({ w: 60, h: 40 });
    expect(simulation.rects.get('btn')).toEqual(rect(0, 0, 60, 40));
    expect(simulation.rects.get('icon')).toEqual(rect(17, 12, 16, 16));
  });

  it('defaults the frame size to 0 × 0, so a FIXED frame takes its padding', () => {
    expect(value(simulateAutoLayout(button, [])).size).toEqual({ w: 32, h: 16 });
  });

  it('passes options through to simulate', () => {
    const simulation = value(simulateAutoLayout(ROW, [icon], { size: { w: 1, h: 16 } }, { outer: { w: 10 } }));
    expect(simulation.size.w).toBe(1);
  });
});

describe('measureHug', () => {
  it('is content plus padding on both axes, whatever the spec sizing modes', () => {
    expect(value(measureHug(button, [icon, label]))).toEqual({ w: 92, h: 36 });
  });

  it('respects the frame min and max', () => {
    expect(value(measureHug(button, [icon, label], { min: { h: 50 }, max: { w: 80 } }))).toEqual({ w: 80, h: 50 });
  });

  it('reports children that cannot hug', () => {
    expect(codes(measureHug(button, [leaf('x', 1, 1, { sizingH: 'FILL' })]))).toEqual(['fill-in-hug-parent']);
  });
});

describe('simulateGrid', () => {
  it('reports grid as not simulated yet (B-112, S-10)', () => {
    const grid: SceneGridLayout = {
      mode: 'GRID',
      padding: pad(0),
      columns: [{ type: 'FLEX', value: 1 }],
      rows: [{ type: 'HUG' }],
      columnGap: 0,
      rowGap: 0,
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      verified: { simulator: SIMULATOR_VERSION, maxDelta: 0, tolerance: TOL_SIM, responsive: 'single-snapshot' },
    };
    const result = simulateGrid(grid, [icon], { key: 'g' });
    expect(codes(result)).toEqual(['unsupported-grid']);
    expect(result.ok ? undefined : result.error[0]?.key).toBe('g');
    expect(codes(simulateGrid(grid, []))).toEqual(['unsupported-grid']);
  });
});

describe('compareRects', () => {
  const actual = new Map([
    ['a', rect(0, 0, 10, 10)],
    ['b', rect(10.2, 0, 9.5, 10)],
  ]);

  it('is 0 for identical rects', () => {
    expect(compareRects(actual, new Map(actual))).toEqual({ maxDelta: 0, missing: [] });
  });

  it('finds the largest single-field delta and where it is', () => {
    const comparison = compareRects(actual, { a: rect(0, 0, 10, 10), b: rect(10, 0, 10, 10) });
    expect(comparison.maxDelta).toBeCloseTo(0.5, 12);
    expect(comparison.worst).toMatchObject({ key: 'b', field: 'w', actual: 9.5, expected: 10 });
    expect(withinTolerance(comparison)).toBe(true);
    expect(withinTolerance(comparison, 0.4)).toBe(false);
  });

  it('compares only expected keys', () => {
    expect(compareRects(actual, { a: rect(0, 0, 10, 10) }).maxDelta).toBe(0);
  });

  it('treats a missing box as an infinite delta', () => {
    const comparison = compareRects(actual, { c: rect(0, 0, 1, 1) });
    expect(comparison).toEqual({ maxDelta: Number.POSITIVE_INFINITY, missing: ['c'] });
    expect(withinTolerance(comparison, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('treats NaN as an infinite delta', () => {
    expect(compareRects(actual, { a: rect(Number.NaN, 0, 10, 10) }).maxDelta).toBe(Number.POSITIVE_INFINITY);
  });

  it('uses the D-15 tolerance by default', () => {
    expect(TOL_SIM).toBe(0.6);
    const edge = compareRects(new Map([['a', rect(0.6, 0, 1, 1)]]), { a: rect(0, 0, 1, 1) });
    expect(withinTolerance(edge)).toBe(true);
  });
});

describe('SIMULATOR_VERSION', () => {
  it('is a semver string for SceneLayout.verified.simulator', () => {
    expect(SIMULATOR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
