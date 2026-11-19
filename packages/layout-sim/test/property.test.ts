import type { Rect, Size } from '@holotype/ir';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type SimNode, type StackSpec, simulate } from '../src';
import { leaf, ROW, value } from './helpers';

/*
 * L2 properties (12 §1.1, B-47): `simulate(spec(rects)) == rects` for generated stack
 * geometry, monotonicity under FIXED sizes, FILL conservation, and robustness on any tree.
 */

type Align = 'MIN' | 'CENTER' | 'MAX';

interface Arrangement {
  readonly mode: 'HORIZONTAL' | 'VERTICAL';
  readonly size: Size;
  readonly rects: readonly Rect[];
  /** True when the container has no slack: it could also be HUG on both axes. */
  readonly hug: boolean;
}

const half = (max: number) => fc.integer({ min: 0, max: max * 2 }).map((value) => value / 2);

/** Child boxes laid out like a stack: uniform gap, one counter alignment, optional slack. */
const arrangement: fc.Arbitrary<Arrangement> = fc
  .record({
    mode: fc.constantFrom('HORIZONTAL' as const, 'VERTICAL' as const),
    sizes: fc.array(fc.record({ main: half(120), cross: half(120) }), { minLength: 1, maxLength: 6 }),
    gap: fc.integer({ min: -10, max: 40 }),
    padding: fc.tuple(half(30), half(30), half(30), half(30)),
    mainAlign: fc.constantFrom<Align>('MIN', 'CENTER', 'MAX'),
    crossAlign: fc.constantFrom<Align>('MIN', 'CENTER', 'MAX'),
    slack: fc.tuple(half(50), half(50)),
    hug: fc.boolean(),
  })
  .filter(({ sizes, gap }) => sizes.reduce((sum, size) => sum + size.main, 0) + gap * (sizes.length - 1) >= 0)
  .map(({ mode, sizes, gap, padding, mainAlign, crossAlign, slack, hug }) => {
    const [mainStart, mainEnd, crossStart, crossEnd] = padding;
    const [mainSlack, crossSlack] = hug ? [0, 0] : slack;
    const used = sizes.reduce((sum, size) => sum + size.main, 0) + gap * (sizes.length - 1);
    const maxCross = Math.max(...sizes.map((size) => size.cross));
    const mainSize = mainStart + used + mainEnd + mainSlack;
    const crossSize = crossStart + maxCross + crossEnd + crossSlack;
    const innerCross = maxCross + crossSlack;
    let cursor = mainStart + share(mainAlign, mainSlack);
    const rects = sizes.map(({ main, cross }) => {
      const along = cursor;
      cursor += main + gap;
      const across = crossStart + share(crossAlign, innerCross - cross);
      return mode === 'HORIZONTAL'
        ? { x: along, y: across, w: main, h: cross }
        : { x: across, y: along, w: cross, h: main };
    });
    const size = mode === 'HORIZONTAL' ? { w: mainSize, h: crossSize } : { w: crossSize, h: mainSize };
    return { mode, size, rects, hug };
  });

function share(align: Align, free: number): number {
  return align === 'MIN' ? 0 : align === 'CENTER' ? free / 2 : free;
}

/** Test-side inference of a stack spec from boxes (the mapper's job, reduced to the uniform-gap case). */
function specFromRects({ mode, size, rects }: Arrangement, sizing: 'FIXED' | 'AUTO'): StackSpec {
  const horizontal = mode === 'HORIZONTAL';
  const along = (r: Rect) => (horizontal ? { start: r.x, end: r.x + r.w } : { start: r.y, end: r.y + r.h });
  const across = (r: Rect) => (horizontal ? { start: r.y, end: r.y + r.h } : { start: r.x, end: r.x + r.w });
  const mainSize = horizontal ? size.w : size.h;
  const crossSize = horizontal ? size.h : size.w;
  const first = rects[0] as Rect;
  const last = rects[rects.length - 1] as Rect;
  const itemSpacing = rects.length > 1 ? along(rects[1] as Rect).start - along(first).end : 0;
  const mainPad = [along(first).start, mainSize - along(last).end] as const;

  const starts = rects.map((r) => across(r).start);
  const ends = rects.map((r) => across(r).end);
  const centers = rects.map((r) => (across(r).start + across(r).end) / 2);
  const same = (values: number[]) => values.every((v) => Math.abs(v - (values[0] as number)) < 1e-9);
  const maxCross = Math.max(...rects.map((r) => across(r).end - across(r).start));
  // Choose the cross padding so the inner box is exactly the largest child: valid for FIXED and HUG.
  let crossAlign: Align = 'MIN';
  let crossPad: readonly [number, number];
  if (same(starts)) {
    const start = starts[0] as number;
    crossPad = [start, crossSize - start - maxCross];
  } else if (same(centers)) {
    crossAlign = 'CENTER';
    const center = centers[0] as number;
    crossPad = [center - maxCross / 2, crossSize - center - maxCross / 2];
  } else {
    crossAlign = 'MAX';
    const end = ends[0] as number;
    crossPad = [end - maxCross, crossSize - end];
  }
  const padding = horizontal
    ? { l: mainPad[0], r: mainPad[1], t: crossPad[0], b: crossPad[1] }
    : { t: mainPad[0], b: mainPad[1], l: crossPad[0], r: crossPad[1] };
  return {
    ...ROW,
    mode,
    padding,
    itemSpacing,
    counterAxisAlignItems: crossAlign,
    primaryAxisSizingMode: sizing,
    counterAxisSizingMode: sizing,
  };
}

function rebuild(arr: Arrangement, sizing: 'FIXED' | 'AUTO'): SimNode {
  return {
    key: 'root',
    size: arr.size,
    layout: specFromRects(arr, sizing),
    children: arr.rects.map((r, index) => leaf(`c${index}`, r.w, r.h)),
  };
}

function expectSame(actual: Rect | Size | undefined, expected: Rect | Size): void {
  expect(actual).toBeDefined();
  for (const [field, want] of Object.entries(expected)) {
    expect((actual as unknown as Record<string, number>)[field]).toBeCloseTo(want as number, 9);
  }
}

describe('property: simulate(spec(rects)) == rects', () => {
  it('reproduces generated stack geometry in a FIXED frame', () => {
    fc.assert(
      fc.property(arrangement, (arr) => {
        const simulation = value(simulate(rebuild(arr, 'FIXED')));
        expectSame(simulation.size, arr.size);
        for (const [index, r] of arr.rects.entries()) expectSame(simulation.rects.get(`c${index}`), r);
      }),
      { numRuns: 400 },
    );
  });

  it('reproduces slack-free geometry with a HUG frame', () => {
    fc.assert(
      fc.property(
        arrangement.filter((arr) => arr.hug),
        (arr) => {
          const simulation = value(simulate(rebuild(arr, 'AUTO')));
          expectSame(simulation.size, arr.size);
          for (const [index, r] of arr.rects.entries()) expectSame(simulation.rects.get(`c${index}`), r);
        },
      ),
      { numRuns: 200 },
    );
  });
});

const hugRow = (spec: Partial<StackSpec>, children: SimNode[]): SimNode => ({
  key: 'root',
  size: { w: 0, h: 0 },
  layout: { ...ROW, primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', ...spec },
  children,
});

describe('property: monotonicity under FIXED sizes', () => {
  const sizes = fc.array(fc.tuple(half(80), half(80)), { minLength: 1, maxLength: 6 });
  const setup = fc.record({
    sizes,
    gap: fc.integer({ min: 0, max: 20 }),
    pick: fc.nat(),
    grow: fc.tuple(half(40), half(40)),
    mode: fc.constantFrom('HORIZONTAL' as const, 'VERTICAL' as const),
    crossAlign: fc.constantFrom<Align>('MIN', 'CENTER', 'MAX'),
  });

  it('growing a FIXED child grows a HUG frame and pushes only later siblings', () => {
    fc.assert(
      fc.property(setup, ({ sizes, gap, pick, grow, mode, crossAlign }) => {
        const index = pick % sizes.length;
        const children = sizes.map(([w, h], i) => leaf(`c${i}`, w, h));
        const grown = children.map((child, i) =>
          i === index ? leaf(child.key, child.size.w + grow[0], child.size.h + grow[1]) : child,
        );
        const spec = { mode, itemSpacing: gap, counterAxisAlignItems: crossAlign };
        const before = value(simulate(hugRow(spec, children)));
        const after = value(simulate(hugRow(spec, grown)));
        expect(after.size.w).toBeGreaterThanOrEqual(before.size.w);
        expect(after.size.h).toBeGreaterThanOrEqual(before.size.h);
        const mainOf = (r: Rect | undefined) => (mode === 'HORIZONTAL' ? r?.x : r?.y) ?? Number.NaN;
        const delta = mode === 'HORIZONTAL' ? grow[0] : grow[1];
        children.forEach((child, i) => {
          const moved = mainOf(after.rects.get(child.key)) - mainOf(before.rects.get(child.key));
          expect(moved).toBeCloseTo(i > index ? delta : 0, 9);
        });
      }),
      { numRuns: 300 },
    );
  });

  it('growing a FIXED sibling never grows a FILL child', () => {
    fc.assert(
      fc.property(
        fc.record({ width: half(400), fixed: half(150), grow: half(50), gap: fc.integer({ min: -5, max: 20 }) }),
        ({ width, fixed, grow, gap }) => {
          const frame = (fixedWidth: number): SimNode => ({
            key: 'root',
            size: { w: width, h: 10 },
            layout: { ...ROW, itemSpacing: gap },
            children: [leaf('fixed', fixedWidth, 10), leaf('fill', 0, 10, { sizingH: 'FILL' })],
          });
          const before = value(simulate(frame(fixed))).rects.get('fill')?.w ?? Number.NaN;
          const after = value(simulate(frame(fixed + grow))).rects.get('fill')?.w ?? Number.NaN;
          expect(after).toBeLessThanOrEqual(before + 1e-9);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('property: FILL conservation', () => {
  it('unbounded FILL children close the free space exactly', () => {
    fc.assert(
      fc.property(
        fc.record({
          fixed: fc.array(half(40), { maxLength: 4 }),
          fills: fc.integer({ min: 1, max: 4 }),
          gap: fc.integer({ min: 0, max: 10 }),
          padding: fc.tuple(half(20), half(20)),
        }),
        ({ fixed, fills, gap, padding }) => {
          const children = [
            ...fixed.map((w, i) => leaf(`f${i}`, w, 10)),
            ...Array.from({ length: fills }, (_, i) => leaf(`g${i}`, 1, 10, { sizingH: 'FILL' })),
          ];
          const used = fixed.reduce((sum, w) => sum + w, 0) + gap * (children.length - 1);
          const width = padding[0] + used + padding[1] + 100;
          const simulation = value(
            simulate({
              key: 'root',
              size: { w: width, h: 10 },
              layout: { ...ROW, itemSpacing: gap, padding: { t: 0, b: 0, l: padding[0], r: padding[1] } },
              children,
            }),
          );
          const last = simulation.rects.get(`g${fills - 1}`) as Rect;
          expect(last.x + last.w).toBeCloseTo(width - padding[1], 9);
          const shares = Array.from({ length: fills }, (_, i) => simulation.rects.get(`g${i}`)?.w);
          for (const w of shares) expect(w).toBeCloseTo(100 / fills, 9);
        },
      ),
      { numRuns: 200 },
    );
  });
});

/** Any numbers, valid or not. */
const anyNumber = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: -5, max: 200 }) },
  { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, 0.5) },
);
const sizing = fc.constantFrom('FIXED' as const, 'HUG' as const, 'FILL' as const);

type RawNode = Omit<SimNode, 'key' | 'children'> & { readonly children?: readonly RawNode[] };

const rawTree = (numbers: fc.Arbitrary<number>) =>
  fc.letrec<{ node: RawNode }>((tie) => ({
    node: fc.record(
      {
        size: fc.record({ w: numbers, h: numbers }),
        sizingH: sizing,
        sizingV: sizing,
        positioning: fc.constantFrom('AUTO' as const, 'ABSOLUTE' as const),
        visible: fc.boolean(),
        xy: fc.record({ x: numbers, y: numbers }),
        min: fc.record({ w: numbers }, { requiredKeys: [] }),
        max: fc.record({ h: numbers }, { requiredKeys: [] }),
        baseline: numbers,
        stroke: fc.record({
          align: fc.constantFrom('INSIDE' as const, 'CENTER' as const, 'OUTSIDE' as const),
          weight: fc.record({ t: numbers, r: numbers, b: numbers, l: numbers }),
        }),
        layout: fc.record({
          mode: fc.constantFrom('HORIZONTAL' as const, 'VERTICAL' as const),
          padding: fc.record({ t: numbers, r: numbers, b: numbers, l: numbers }),
          itemSpacing: numbers,
          primaryAxisAlignItems: fc.constantFrom(
            'MIN' as const,
            'CENTER' as const,
            'MAX' as const,
            'SPACE_BETWEEN' as const,
            'SPACE_EVENLY' as const,
            'SPACE_AROUND' as const,
          ),
          counterAxisAlignItems: fc.constantFrom(
            'MIN' as const,
            'CENTER' as const,
            'MAX' as const,
            'BASELINE' as const,
          ),
          primaryAxisSizingMode: fc.constantFrom('FIXED' as const, 'AUTO' as const),
          counterAxisSizingMode: fc.constantFrom('FIXED' as const, 'AUTO' as const),
          strokesIncludedInLayout: fc.boolean(),
        }),
        children: fc.array(tie('node'), { maxLength: 3 }),
      },
      { requiredKeys: ['size'] },
    ),
  })).node;

function withKeys(node: RawNode, key: string): SimNode {
  return { ...node, key, children: (node.children ?? []).map((child, i) => withKeys(child, `${key}/${i}`)) };
}

/**
 * Makes a raw tree valid the way the mapper would emit it: sizing agrees with the stack's
 * modes, FILL only in the flow of a stack that does not hug that axis, xy where needed,
 * BASELINE only on rows, min ≤ max.
 */
function repair(node: RawNode, key: string, parent?: { spec?: StackSpec }): SimNode {
  const spec = node.layout?.mode === 'GRID' ? undefined : node.layout;
  const parentSpec = parent?.spec;
  const positioning = parentSpec === undefined ? 'AUTO' : (node.positioning ?? 'AUTO');
  const inFlow = parentSpec !== undefined && positioning === 'AUTO';
  const axisSizing = (axis: 'h' | 'v', wanted: 'FIXED' | 'HUG' | 'FILL' | undefined) => {
    let sizing = wanted ?? 'FIXED';
    const parentHugs =
      parentSpec !== undefined &&
      ((axis === 'h') === (parentSpec.mode === 'HORIZONTAL')
        ? parentSpec.primaryAxisSizingMode
        : parentSpec.counterAxisSizingMode) === 'AUTO';
    if (sizing === 'FILL' && (!inFlow || parentHugs)) sizing = 'FIXED';
    if (sizing === 'HUG' && spec === undefined) sizing = 'FIXED';
    return sizing;
  };
  const sizingH = parent === undefined ? 'FIXED' : axisSizing('h', node.sizingH);
  const sizingV = parent === undefined ? 'FIXED' : axisSizing('v', node.sizingV);
  const modeOf = (axis: 'h' | 'v') => ((axis === 'h' ? sizingH : sizingV) === 'HUG' ? 'AUTO' : 'FIXED');
  const layout: StackSpec | undefined =
    spec === undefined
      ? undefined
      : {
          ...spec,
          counterAxisAlignItems:
            spec.counterAxisAlignItems === 'BASELINE' && spec.mode === 'VERTICAL' ? 'MIN' : spec.counterAxisAlignItems,
          primaryAxisSizingMode: modeOf(spec.mode === 'HORIZONTAL' ? 'h' : 'v'),
          counterAxisSizingMode: modeOf(spec.mode === 'HORIZONTAL' ? 'v' : 'h'),
        };
  const lo = node.min?.w;
  const children = (node.children ?? []).map((child, i) =>
    repair(child, `${key}/${i}`, layout === undefined ? {} : { spec: layout }),
  );
  return {
    key,
    size: node.size,
    sizingH,
    sizingV,
    positioning,
    ...(node.visible === undefined || parent === undefined ? {} : { visible: node.visible }),
    xy: node.xy ?? { x: 0, y: 0 },
    ...(lo === undefined ? {} : { min: { w: lo } }),
    ...(node.max?.h === undefined ? {} : { max: { h: node.max.h } }),
    ...(node.baseline === undefined ? {} : { baseline: node.baseline }),
    ...(node.stroke === undefined ? {} : { stroke: node.stroke }),
    ...(layout === undefined ? {} : { layout }),
    children,
  };
}

function countVisible(node: SimNode): number {
  return 1 + (node.children ?? []).filter((c) => c.visible !== false).reduce((sum, c) => sum + countVisible(c), 0);
}

describe('property: robustness', () => {
  it('never throws on any tree; a failure always carries issues', () => {
    fc.assert(
      fc.property(rawTree(anyNumber), fc.option(anyNumber, { nil: undefined }), (node, outer) => {
        const result = simulate(withKeys(node, 'r'), outer === undefined ? {} : { outer: { w: outer, h: outer } });
        if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
      }),
      { numRuns: 500 },
    );
  });

  it('simulates every valid tree: finite, non-negative boxes for every visible node, deterministically', () => {
    fc.assert(
      fc.property(rawTree(half(100)), (node) => {
        const root = repair(node, 'r');
        const result = simulate(root);
        expect(result.ok ? [] : result.error).toEqual([]);
        const simulation = value(result);
        expect(simulation.rects.size).toBe(countVisible(root));
        for (const box of simulation.rects.values()) {
          for (const field of [box.x, box.y, box.w, box.h]) expect(Number.isFinite(field)).toBe(true);
          expect(Math.min(box.w, box.h)).toBeGreaterThanOrEqual(0);
        }
        expect(JSON.stringify([...value(simulate(root)).rects])).toBe(JSON.stringify([...simulation.rects]));
      }),
      { numRuns: 500 },
    );
  });
});
