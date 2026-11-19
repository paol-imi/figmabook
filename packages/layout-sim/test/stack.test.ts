import type { Rect, Size } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { type AssumptionId, type SimNode, type SimulateOptions, simulate } from '../src';
import { COLUMN, expectRects, frame, leaf, pad, rect, rectsOf, value } from './helpers';

interface Case {
  readonly name: string;
  readonly root: SimNode;
  readonly options?: SimulateOptions;
  readonly size: Size;
  /** Expected boxes relative to the root; other keys are not checked unless `exact`. */
  readonly rects: Record<string, Rect>;
  /** The keys of `rects` are every key of the result, in this order. */
  readonly exact?: boolean;
  readonly assumptions?: readonly AssumptionId[];
}

const a = leaf('a', 20, 10);
const b = leaf('b', 30, 20);
const c = leaf('c', 10, 30);
const HUG = { primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO' } as const;
const fixed = (w: number, h: number) => ({ size: { w, h } });

const primaryAlignment: Case[] = [
  {
    name: 'hugs a button-like row: padding, children and gaps',
    root: frame('f', { ...HUG, padding: pad(8, 16), itemSpacing: 4, counterAxisAlignItems: 'CENTER' }, [
      leaf('icon', 16, 16),
      leaf('label', 40, 20),
    ]),
    size: { w: 92, h: 36 },
    rects: { f: rect(0, 0, 92, 36), icon: rect(16, 10, 16, 16), label: rect(36, 8, 40, 20) },
    exact: true,
  },
  {
    name: 'MIN packs children at the start of a FIXED frame',
    root: frame('f', { padding: pad(5, 10), itemSpacing: 6 }, [a, b], fixed(200, 50)),
    size: { w: 200, h: 50 },
    rects: { a: rect(10, 5, 20, 10), b: rect(36, 5, 30, 20) },
  },
  {
    name: 'CENTER splits the free space on both sides',
    root: frame('f', { padding: pad(5, 10), itemSpacing: 6, primaryAxisAlignItems: 'CENTER' }, [a, b], fixed(200, 50)),
    size: { w: 200, h: 50 },
    rects: { a: rect(72, 5, 20, 10), b: rect(98, 5, 30, 20) },
  },
  {
    name: 'MAX packs children against the end padding',
    root: frame('f', { padding: pad(5, 10), itemSpacing: 6, primaryAxisAlignItems: 'MAX' }, [a, b], fixed(200, 50)),
    size: { w: 200, h: 50 },
    rects: { a: rect(134, 5, 20, 10), b: rect(160, 5, 30, 20) },
  },
  {
    name: 'a negative itemSpacing overlaps the children',
    root: frame('f', { ...HUG, itemSpacing: -10 }, [a, b]),
    size: { w: 40, h: 20 },
    rects: { a: rect(0, 0, 20, 10), b: rect(10, 0, 30, 20) },
  },
  {
    name: 'a HUG frame never shrinks below its padding, even with a large negative gap',
    root: frame('f', { ...HUG, padding: pad(0, 4), itemSpacing: -60 }, [a, b]),
    size: { w: 8, h: 20 },
    rects: { a: rect(4, 0, 20, 10), b: rect(-36, 0, 30, 20) },
    assumptions: [],
  },
  {
    name: 'CENTER overflows both sides when the children do not fit',
    root: frame('f', { primaryAxisAlignItems: 'CENTER' }, [a, b], fixed(40, 20)),
    size: { w: 40, h: 20 },
    rects: { a: rect(-5, 0, 20, 10), b: rect(15, 0, 30, 20) },
    assumptions: ['overflow-alignment'],
  },
];

const autoGap: Case[] = [
  {
    name: 'SPACE_BETWEEN ignores itemSpacing and keeps the ends flush with the padding',
    root: frame('f', { padding: pad(0, 10), itemSpacing: 99, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [a, b, c], {
      size: { w: 200, h: 30 },
    }),
    size: { w: 200, h: 30 },
    rects: { a: rect(10, 0, 20, 10), b: rect(90, 0, 30, 20), c: rect(180, 0, 10, 30) },
    assumptions: [],
  },
  {
    name: 'SPACE_BETWEEN puts a single child at the start',
    root: frame('f', { padding: pad(0, 10), primaryAxisAlignItems: 'SPACE_BETWEEN' }, [a], fixed(200, 30)),
    size: { w: 200, h: 30 },
    rects: { a: rect(10, 0, 20, 10) },
    assumptions: [],
  },
  {
    name: 'SPACE_BETWEEN stops the gap at 0 when the children overflow',
    root: frame('f', { itemSpacing: 8, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [a, b], fixed(40, 20)),
    size: { w: 40, h: 20 },
    rects: { a: rect(0, 0, 20, 10), b: rect(20, 0, 30, 20) },
    assumptions: [],
  },
  {
    name: 'SPACE_BETWEEN in a HUG frame has no free space: gaps are 0',
    root: frame('f', { ...HUG, itemSpacing: 10, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [a, b]),
    size: { w: 50, h: 20 },
    rects: { a: rect(0, 0, 20, 10), b: rect(20, 0, 30, 20) },
    assumptions: ['auto-gap-hug'],
  },
  {
    name: 'SPACE_EVENLY splits the free space equally between edges and gaps (S-10)',
    root: frame('f', { itemSpacing: 7, primaryAxisAlignItems: 'SPACE_EVENLY' }, [a, b], fixed(200, 20)),
    size: { w: 200, h: 20 },
    rects: { a: rect(50, 0, 20, 10), b: rect(120, 0, 30, 20) },
    assumptions: ['auto-gap-evenly-around'],
  },
  {
    name: 'SPACE_AROUND gives each edge half a gap (S-10)',
    root: frame('f', { primaryAxisAlignItems: 'SPACE_AROUND' }, [a, b], fixed(200, 20)),
    size: { w: 200, h: 20 },
    rects: { a: rect(37.5, 0, 20, 10), b: rect(132.5, 0, 30, 20) },
    assumptions: ['auto-gap-evenly-around'],
  },
  {
    name: 'SPACE_EVENLY with a single child follows the auto-gap single-child rule (S-10)',
    root: frame('f', { padding: pad(0, 10), primaryAxisAlignItems: 'SPACE_EVENLY' }, [a], fixed(200, 20)),
    size: { w: 200, h: 20 },
    rects: { a: rect(10, 0, 20, 10) },
    assumptions: ['auto-gap-evenly-around'],
  },
];

const counterAlignment: Case[] = [
  {
    name: 'a VERTICAL stack hugs: widest child across, children and gaps down',
    root: frame('f', { ...COLUMN, ...HUG, padding: pad(2, 3), itemSpacing: 5 }, [a, b]),
    size: { w: 36, h: 39 },
    rects: { a: rect(3, 2, 20, 10), b: rect(3, 17, 30, 20) },
  },
  {
    name: 'counter CENTER centres each child in the inner width',
    root: frame('f', { ...COLUMN, counterAxisAlignItems: 'CENTER' }, [a, b], fixed(100, 200)),
    size: { w: 100, h: 200 },
    rects: { a: rect(40, 0, 20, 10), b: rect(35, 10, 30, 20) },
  },
  {
    name: 'counter MAX aligns each child to the end padding',
    root: frame('f', { ...COLUMN, padding: pad(0, 4), counterAxisAlignItems: 'MAX' }, [a, b], fixed(100, 200)),
    size: { w: 100, h: 200 },
    rects: { a: rect(76, 0, 20, 10), b: rect(66, 10, 30, 20) },
  },
  {
    name: 'counter CENTER overflows both sides of a narrow frame',
    root: frame('f', { ...COLUMN, counterAxisAlignItems: 'CENTER' }, [a], fixed(10, 10)),
    size: { w: 10, h: 10 },
    rects: { a: rect(-5, 0, 20, 10) },
    assumptions: ['overflow-alignment'],
  },
  {
    name: 'BASELINE lines up first baselines; the deepest one touches the top padding (S-04)',
    root: frame('f', { ...HUG, padding: pad(2), itemSpacing: 4, counterAxisAlignItems: 'BASELINE' }, [
      leaf('t1', 40, 20, { baseline: 16 }),
      leaf('t2', 30, 10, { baseline: 8 }),
      leaf('icon', 16, 16),
    ]),
    size: { w: 2 + 40 + 4 + 30 + 4 + 16 + 2, h: 2 + 20 + 2 },
    rects: { t1: rect(2, 2, 40, 20), t2: rect(46, 10, 30, 10), icon: rect(80, 2, 16, 16) },
    assumptions: ['baseline-alignment', 'baseline-synthesized'],
  },
  {
    name: 'BASELINE: a HUG row spans the deepest baseline plus the deepest descent (S-04)',
    root: frame('f', { ...HUG, counterAxisAlignItems: 'BASELINE' }, [
      leaf('big', 10, 30, { baseline: 20 }),
      leaf('small', 10, 30, { baseline: 5 }),
    ]),
    size: { w: 20, h: 45 },
    rects: { big: rect(0, 0, 10, 30), small: rect(10, 15, 10, 30) },
    assumptions: ['baseline-alignment'],
  },
  {
    name: 'BASELINE: a counter-FILL child stretches from the top and is not aligned (S-04)',
    root: frame(
      'f',
      { counterAxisAlignItems: 'BASELINE' },
      [leaf('t', 40, 20, { baseline: 16 }), leaf('bar', 4, 1, { sizingV: 'FILL' })],
      fixed(100, 40),
    ),
    size: { w: 100, h: 40 },
    rects: { t: rect(0, 0, 40, 20), bar: rect(40, 0, 4, 40) },
    assumptions: ['baseline-alignment', 'baseline-fill'],
  },
];

const sizing: Case[] = [
  {
    name: 'a single FILL child takes the free space after fixed children and gaps',
    root: frame('f', { padding: pad(0, 10), itemSpacing: 10 }, [a, leaf('f1', 5, 10, { sizingH: 'FILL' })], {
      size: { w: 200, h: 10 },
    }),
    size: { w: 200, h: 10 },
    rects: { f1: rect(40, 0, 150, 10) },
    assumptions: [],
  },
  {
    name: 'FILL children share equally, whatever their current size',
    root: frame(
      'f',
      {},
      [a, leaf('f1', 5, 10, { sizingH: 'FILL' }), leaf('f2', 70, 10, { sizingH: 'FILL' })],
      fixed(200, 10),
    ),
    size: { w: 200, h: 10 },
    rects: { f1: rect(20, 0, 90, 10), f2: rect(110, 0, 90, 10) },
    assumptions: ['fill-equal-share'],
  },
  {
    name: 'a FILL max freezes that child and gives the rest to the others',
    root: frame(
      'f',
      {},
      [a, leaf('f1', 5, 10, { sizingH: 'FILL', max: { w: 30 } }), leaf('f2', 5, 10, { sizingH: 'FILL' })],
      fixed(200, 10),
    ),
    size: { w: 200, h: 10 },
    rects: { f1: rect(20, 0, 30, 10), f2: rect(50, 0, 150, 10) },
    assumptions: ['fill-equal-share', 'fill-min-max'],
  },
  {
    name: 'a FILL min freezes that child and shrinks the others',
    root: frame(
      'f',
      {},
      [a, leaf('f1', 5, 10, { sizingH: 'FILL', min: { w: 70 } }), leaf('f2', 5, 10, { sizingH: 'FILL' })],
      fixed(100, 10),
    ),
    size: { w: 100, h: 10 },
    rects: { f1: rect(20, 0, 70, 10), f2: rect(90, 0, 10, 10) },
    assumptions: ['fill-equal-share', 'fill-min-max'],
  },
  {
    name: 'FILL gets 0 when the fixed children already overflow',
    root: frame('f', {}, [leaf('wide', 50, 10), leaf('f1', 5, 10, { sizingH: 'FILL' })], fixed(40, 10)),
    size: { w: 40, h: 10 },
    rects: { f1: rect(50, 0, 0, 10) },
    assumptions: ['fill-no-space'],
  },
  {
    name: 'counter FILL stretches to the inner height',
    root: frame('f', { padding: pad(5) }, [leaf('f1', 20, 10, { sizingV: 'FILL' })], fixed(100, 60)),
    size: { w: 100, h: 60 },
    rects: { f1: rect(5, 5, 20, 50) },
    assumptions: [],
  },
  {
    name: 'counter FILL with a max is aligned by counterAxisAlignItems',
    root: frame(
      'f',
      { padding: pad(5), counterAxisAlignItems: 'CENTER' },
      [leaf('f1', 20, 10, { sizingV: 'FILL', max: { h: 30 } })],
      fixed(100, 60),
    ),
    size: { w: 100, h: 60 },
    rects: { f1: rect(5, 15, 20, 30) },
  },
  {
    name: 'min grows a HUG frame; the children keep their alignment inside',
    root: frame('f', { ...HUG, primaryAxisAlignItems: 'CENTER' }, [a, b], { min: { w: 100 } }),
    size: { w: 100, h: 20 },
    rects: { a: rect(25, 0, 20, 10), b: rect(45, 0, 30, 20) },
  },
  {
    name: 'max caps a HUG frame; MIN-aligned children overflow the end',
    root: frame('f', HUG, [a, b], { max: { w: 30 } }),
    size: { w: 30, h: 20 },
    rects: { b: rect(20, 0, 30, 20) },
    assumptions: [],
  },
  {
    name: 'min/max also bound FIXED children',
    root: frame('f', HUG, [leaf('a', 20, 10, { max: { w: 12 } }), leaf('b', 4, 4, { min: { w: 6, h: 8 } })]),
    size: { w: 18, h: 10 },
    rects: { a: rect(0, 0, 12, 10), b: rect(12, 0, 6, 8) },
  },
  {
    name: 'a FIXED frame smaller than its padding grows to the padding',
    root: frame('f', { padding: pad(8) }, [], fixed(10, 10)),
    size: { w: 16, h: 16 },
    rects: { f: rect(0, 0, 16, 16) },
    exact: true,
  },
  {
    name: 'the padding floor wins over a smaller max',
    root: frame('f', { ...HUG, padding: pad(8) }, [], { max: { w: 10 } }),
    size: { w: 16, h: 16 },
    rects: {},
    assumptions: ['min-max-before-floor'],
  },
  {
    name: 'an empty HUG frame is its padding',
    root: frame('f', { ...HUG, padding: pad(1, 2, 3, 4) }, []),
    size: { w: 6, h: 4 },
    rects: {},
  },
];

const flow: Case[] = [
  {
    name: 'hidden children take no space and get no rect',
    root: frame('f', { ...HUG, itemSpacing: 10 }, [a, leaf('b', 30, 20, { visible: false }), c]),
    size: { w: 40, h: 30 },
    rects: { f: rect(0, 0, 40, 30), a: rect(0, 0, 20, 10), c: rect(30, 0, 10, 30) },
    exact: true,
  },
  {
    name: 'ABSOLUTE children sit at their xy and do not change the HUG size',
    root: frame('f', { ...HUG, padding: pad(5) }, [
      leaf('badge', 100, 100, { positioning: 'ABSOLUTE', xy: { x: -3, y: -4 } }),
      a,
    ]),
    size: { w: 30, h: 20 },
    rects: { f: rect(0, 0, 30, 20), badge: rect(-3, -4, 100, 100), a: rect(5, 5, 20, 10) },
    exact: true,
  },
  {
    name: 'an ABSOLUTE rotated child is fine: it is out of the flow',
    root: frame('f', HUG, [a, leaf('r', 5, 5, { positioning: 'ABSOLUTE', xy: { x: 1, y: 1 }, transformed: true })]),
    size: { w: 20, h: 10 },
    rects: { r: rect(1, 1, 5, 5) },
  },
  {
    name: 'children of a frame without auto layout sit at their xy',
    root: {
      key: 'g',
      size: { w: 50, h: 40 },
      children: [
        leaf('a', 10, 10, { xy: { x: 5, y: 6 } }),
        frame('inner', { ...HUG, padding: pad(2) }, [leaf('dot', 4, 4)], { xy: { x: 20, y: 20 } }),
      ],
    },
    size: { w: 50, h: 40 },
    rects: {
      g: rect(0, 0, 50, 40),
      a: rect(5, 6, 10, 10),
      inner: rect(20, 20, 8, 8),
      dot: rect(22, 22, 4, 4),
    },
    exact: true,
  },
];

const strokes: Case[] = [
  {
    name: 'strokes excluded from layout take no space',
    root: frame('f', { ...HUG, padding: pad(4) }, [a], {
      stroke: { align: 'INSIDE', weight: { t: 2, r: 2, b: 2, l: 2 } },
    }),
    size: { w: 28, h: 18 },
    rects: { a: rect(4, 4, 20, 10) },
    assumptions: [],
  },
  {
    name: 'a uniform INSIDE stroke included in layout adds to the padding',
    root: frame('f', { ...HUG, padding: pad(4), strokesIncludedInLayout: true }, [a], {
      stroke: { align: 'INSIDE', weight: { t: 2, r: 2, b: 2, l: 2 } },
    }),
    size: { w: 32, h: 22 },
    rects: { a: rect(6, 6, 20, 10) },
    assumptions: [],
  },
  {
    name: 'per-side INSIDE weights each add to their side (S-05)',
    root: frame('f', { ...HUG, padding: pad(4), strokesIncludedInLayout: true }, [a], {
      stroke: { align: 'INSIDE', weight: { t: 1, r: 2, b: 3, l: 4 } },
    }),
    size: { w: 34, h: 22 },
    rects: { a: rect(8, 5, 20, 10) },
    assumptions: ['stroke-included-per-side'],
  },
  {
    name: 'CENTER strokes add nothing even when included (S-05)',
    root: frame('f', { ...HUG, padding: pad(4), strokesIncludedInLayout: true }, [a], {
      stroke: { align: 'CENTER', weight: { t: 2, r: 2, b: 2, l: 2 } },
    }),
    size: { w: 28, h: 18 },
    rects: { a: rect(4, 4, 20, 10) },
    assumptions: ['stroke-included-center-outside'],
  },
  {
    name: 'an included stroke raises the padding floor of a FIXED frame',
    root: frame('f', { padding: pad(4), strokesIncludedInLayout: true }, [], {
      size: { w: 5, h: 5 },
      stroke: { align: 'INSIDE', weight: { t: 3, r: 3, b: 3, l: 3 } },
    }),
    size: { w: 14, h: 14 },
    rects: {},
  },
  {
    name: "a child's stroke never changes the parent's layout",
    root: frame('f', { ...HUG, strokesIncludedInLayout: true }, [
      leaf('a', 20, 10, { stroke: { align: 'OUTSIDE', weight: { t: 5, r: 5, b: 5, l: 5 } } }),
      b,
    ]),
    size: { w: 50, h: 20 },
    rects: { a: rect(0, 0, 20, 10), b: rect(20, 0, 30, 20) },
    assumptions: [],
  },
];

const nested: Case[] = [
  {
    name: 'a card column with a FILL title and a HUG button row',
    root: frame(
      'card',
      { ...COLUMN, counterAxisSizingMode: 'FIXED', primaryAxisSizingMode: 'AUTO', padding: pad(10), itemSpacing: 8 },
      [
        leaf('title', 1, 20, { sizingH: 'FILL' }),
        frame('button', { ...HUG, padding: pad(6, 12), itemSpacing: 4, counterAxisAlignItems: 'CENTER' }, [
          leaf('icon', 16, 16),
          leaf('label', 40, 20),
        ]),
      ],
      { size: { w: 200, h: 0 } },
    ),
    size: { w: 200, h: 80 },
    rects: {
      card: rect(0, 0, 200, 80),
      title: rect(10, 10, 180, 20),
      button: rect(10, 38, 84, 32),
      icon: rect(22, 46, 16, 16),
      label: rect(42, 44, 40, 20),
    },
    exact: true,
  },
  {
    name: 'a FILL stack lays its own children out in its final width',
    root: frame(
      'bar',
      {},
      [
        leaf('logo', 100, 40),
        frame('actions', { primaryAxisAlignItems: 'MAX' }, [leaf('menu', 20, 10)], {
          sizingH: 'FILL',
          size: { w: 0, h: 40 },
        }),
      ],
      fixed(300, 40),
    ),
    size: { w: 300, h: 40 },
    rects: { actions: rect(100, 0, 200, 40), menu: rect(280, 0, 20, 10) },
  },
  {
    name: 'a HUG child is re-measured from its children, not its stale size',
    root: frame('outer', { ...HUG, itemSpacing: 2 }, [
      frame('inner', { ...COLUMN, ...HUG, itemSpacing: 1 }, [a, b], { size: { w: 999, h: 999 } }),
      c,
    ]),
    size: { w: 42, h: 31 },
    rects: { inner: rect(0, 0, 30, 31), a: rect(0, 0, 20, 10), b: rect(0, 11, 30, 20), c: rect(32, 0, 10, 30) },
  },
  {
    name: 'a FILL root takes the outer size',
    root: frame('f', { counterAxisAlignItems: 'CENTER' }, [a], { sizingH: 'FILL', size: { w: 1, h: 30 } }),
    options: { outer: { w: 120 } },
    size: { w: 120, h: 30 },
    rects: { f: rect(0, 0, 120, 30), a: rect(0, 10, 20, 10) },
  },
];

const groups: [string, Case[]][] = [
  ['primary axis', primaryAlignment],
  ['auto gap', autoGap],
  ['counter axis', counterAlignment],
  ['sizing', sizing],
  ['flow', flow],
  ['strokes', strokes],
  ['nested frames', nested],
];

describe.each(groups)('simulate: %s', (_group, cases) => {
  it.each(cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const simulation = value(simulate(entry.root, entry.options));
    expect(simulation.size.w).toBeCloseTo(entry.size.w, 9);
    expect(simulation.size.h).toBeCloseTo(entry.size.h, 9);
    expectRects(simulation, entry.rects);
    if (entry.exact) expect([...simulation.rects.keys()]).toEqual(Object.keys(entry.rects));
    if (entry.assumptions) expect(simulation.assumptions).toEqual(entry.assumptions);
  });
});

describe('simulate: determinism', () => {
  it('gives the same rects, in the same order, on every run', () => {
    const root = nested[0]?.root as SimNode;
    const first = JSON.stringify([...value(simulate(root)).rects]);
    const second = JSON.stringify([...value(simulate(root)).rects]);
    expect(second).toBe(first);
  });

  it('does not mutate its input', () => {
    const root = nested[1]?.root as SimNode;
    const before = JSON.stringify(root);
    simulate(root);
    expect(JSON.stringify(root)).toBe(before);
  });

  it('lists the root first, then each subtree in layer order', () => {
    const simulation = value(simulate(nested[0]?.root as SimNode));
    expect(Object.keys(rectsOf(simulation))).toEqual(['card', 'title', 'button', 'icon', 'label']);
  });
});
