import type { Rect, SceneNode } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import {
  compareRects,
  fallbackRects,
  type SceneStackLayout,
  SIMULATOR_VERSION,
  simulateScene,
  TOL_SIM,
  toSimNode,
  withinTolerance,
} from '../src';
import { codes, rect, rectsOf, value } from './helpers';

const IRH = '0000000000000000';

function node(nk: string, kind: SceneNode['kind'], box: Rect, extra: Partial<SceneNode> = {}): SceneNode {
  return { nk, kind, name: nk, irh: IRH, size: { w: box.w, h: box.h }, expect: box, visible: true, ...extra };
}

function stack(overrides: Partial<SceneStackLayout>): SceneStackLayout {
  return {
    mode: 'HORIZONTAL',
    padding: { t: 0, r: 0, b: 0, l: 0 },
    itemSpacing: 0,
    wrap: false,
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'MIN',
    primaryAxisSizingMode: 'AUTO',
    counterAxisSizingMode: 'AUTO',
    strokesIncludedInLayout: false,
    itemReverseZIndex: false,
    verified: { simulator: SIMULATOR_VERSION, maxDelta: 0, tolerance: TOL_SIM, responsive: 'single-snapshot' },
    ...overrides,
  };
}

const inFlow = { positioning: 'AUTO', sizingH: 'FIXED', sizingV: 'FIXED' } as const;

/** A captured button: CSS padding 7/15 + 1px border → Scene padding 8/16 (D-16), gap 4. */
const button = node('root', 'component', rect(0, 0, 92, 36), {
  layout: stack({ padding: { t: 8, r: 16, b: 8, l: 16 }, itemSpacing: 4, counterAxisAlignItems: 'CENTER' }),
  strokes: {
    paints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
    align: 'INSIDE',
    weight: { t: 1, r: 1, b: 1, l: 1 },
  },
  fallback: {
    size: { w: 92, h: 36 },
    children: { 'root/icon': rect(16.3, 10, 16, 16), 'root/label': rect(36, 8, 40, 20) },
  },
  children: [
    node('root/icon', 'svg', rect(16, 10, 16, 16), { child: inFlow }),
    node('root/label', 'text', rect(36, 8, 40, 20), { child: { ...inFlow, sizingH: 'HUG', sizingV: 'HUG' } }),
    node('root/badge', 'ellipse', rect(84, -4, 12, 12), {
      xy: { x: 84, y: -4 },
      child: { positioning: 'ABSOLUTE', sizingH: 'FIXED', sizingV: 'FIXED' },
    }),
    node('root/hidden', 'frame', rect(0, 0, 50, 50), { visible: false, child: inFlow }),
  ],
});

describe('toSimNode', () => {
  it('maps Scene IR fields to the simulator input', () => {
    const sim = toSimNode(button, { baselines: new Map([['root/label', 15]]) });
    expect(sim).toMatchObject({
      key: 'root',
      size: { w: 92, h: 36 },
      visible: true,
      stroke: { align: 'INSIDE', weight: { t: 1, r: 1, b: 1, l: 1 } },
      layout: { mode: 'HORIZONTAL', itemSpacing: 4 },
    });
    expect(sim).not.toHaveProperty('sizingH');
    const [icon, label, badge, hidden] = sim.children ?? [];
    expect(icon).toEqual({
      key: 'root/icon',
      size: { w: 16, h: 16 },
      visible: true,
      positioning: 'AUTO',
      sizingH: 'FIXED',
      sizingV: 'FIXED',
    });
    expect(label).toMatchObject({ sizingH: 'HUG', baseline: 15 });
    expect(badge).toMatchObject({ positioning: 'ABSOLUTE', xy: { x: 84, y: -4 } });
    expect(hidden).toMatchObject({ visible: false });
  });

  it('keeps child bounds and flags transforms', () => {
    const sim = toSimNode(
      node('n', 'rectangle', rect(0, 0, 4, 4), {
        relativeTransform: [
          [0, -1, 4],
          [1, 0, 0],
        ],
        child: { ...inFlow, min: { w: 2 }, max: { h: 9 } },
      }),
    );
    expect(sim).toMatchObject({ transformed: true, min: { w: 2 }, max: { h: 9 } });
  });
});

describe('simulateScene', () => {
  it('reproduces the browser boxes of a verified container within TOL_SIM', () => {
    const simulation = value(simulateScene(button));
    expect(rectsOf(simulation)).toEqual({
      root: rect(0, 0, 92, 36),
      'root/icon': rect(16, 10, 16, 16),
      'root/label': rect(36, 8, 40, 20),
      'root/badge': rect(84, -4, 12, 12),
    });
    const comparison = compareRects(simulation.rects, fallbackRects(button) ?? new Map());
    expect(comparison.maxDelta).toBeCloseTo(0.3, 12);
    expect(withinTolerance(comparison)).toBe(true);
  });

  it('rejects a hypothesis that does not match: wrong gap', () => {
    const wrong = { ...button, layout: stack({ ...(button.layout as SceneStackLayout), itemSpacing: 6 }) };
    const comparison = compareRects(value(simulateScene(wrong)).rects, fallbackRects(button) ?? new Map());
    expect(comparison.worst).toMatchObject({ key: 'root', field: 'w', delta: 2 });
    expect(withinTolerance(comparison)).toBe(false);
  });

  it('passes baselines through for BASELINE rows', () => {
    const row = node('row', 'frame', rect(0, 0, 70, 20), {
      layout: stack({ counterAxisAlignItems: 'BASELINE' }),
      children: [
        node('row/big', 'text', rect(0, 0, 40, 20), { child: inFlow }),
        node('row/small', 'text', rect(40, 6, 30, 12), { child: inFlow }),
      ],
    });
    const baselines = new Map([
      ['row/big', 16],
      ['row/small', 10],
    ]);
    const simulation = value(simulateScene(row, { baselines }));
    expect(simulation.rects.get('row/small')).toEqual(rect(40, 6, 30, 12));
    expect(simulation.assumptions).toEqual(['baseline-alignment']);
  });

  it('passes the outer size through for FILL roots', () => {
    const fill = node('fill', 'frame', rect(0, 0, 10, 10), {
      layout: stack({ primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED' }),
      child: { positioning: 'AUTO', sizingH: 'FILL', sizingV: 'FIXED' },
    });
    expect(value(simulateScene(fill, { outer: { w: 300 } })).size).toEqual({ w: 300, h: 10 });
    expect(codes(simulateScene(fill))).toEqual(['fill-without-stack-parent']);
  });

  it('reports unsupported Scene layouts instead of guessing', () => {
    expect(codes(simulateScene({ ...button, layout: stack({ wrap: true, counterAxisSpacing: 4 }) }))).toEqual([
      'unsupported-wrap',
    ]);
    const grid = node('grid', 'frame', rect(0, 0, 10, 10), {
      layout: {
        mode: 'GRID',
        padding: { t: 0, r: 0, b: 0, l: 0 },
        columns: [{ type: 'FIXED', value: 10 }],
        rows: [{ type: 'FIXED', value: 10 }],
        columnGap: 0,
        rowGap: 0,
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'FIXED',
        verified: { simulator: SIMULATOR_VERSION, maxDelta: 0, tolerance: TOL_SIM, responsive: 'single-snapshot' },
      },
    });
    expect(codes(simulateScene(grid))).toEqual(['unsupported-grid']);
  });
});

describe('fallbackRects', () => {
  it('puts the container at the origin, then its children', () => {
    expect(Object.fromEntries(fallbackRects(button) ?? [])).toEqual({
      root: rect(0, 0, 92, 36),
      'root/icon': rect(16.3, 10, 16, 16),
      'root/label': rect(36, 8, 40, 20),
    });
  });

  it('is undefined for a node without a fallback', () => {
    expect(fallbackRects(node('leaf', 'rectangle', rect(0, 0, 1, 1)))).toBeUndefined();
  });
});
