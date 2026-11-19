import { describe, expect, it } from 'vitest';
import { type SimIssueCode, type SimNode, type SimulateOptions, simulate } from '../src';
import { COLUMN, codes, frame, leaf, pad, value } from './helpers';

const HUG = { primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO' } as const;
const a = leaf('a', 20, 10);

interface IssueCase {
  readonly name: string;
  readonly root: SimNode;
  readonly options?: SimulateOptions;
  readonly codes: readonly SimIssueCode[];
  /** Key of the first issue. */
  readonly key: string;
}

const cases: IssueCase[] = [
  {
    name: 'wrap is not simulated yet (B-111)',
    root: frame('f', { wrap: true }, [a]),
    codes: ['unsupported-wrap'],
    key: 'f',
  },
  {
    name: 'grid is not simulated yet; its children are not checked',
    root: { key: 'g', size: { w: 10, h: 10 }, layout: { mode: 'GRID' }, children: [leaf('cell', 1, 1)] },
    codes: ['unsupported-grid'],
    key: 'g',
  },
  {
    name: 'a rotated in-flow child',
    root: frame('f', {}, [leaf('r', 5, 5, { transformed: true })]),
    codes: ['unsupported-transform'],
    key: 'r',
  },
  {
    name: 'BASELINE on a VERTICAL stack',
    root: frame('f', { ...COLUMN, counterAxisAlignItems: 'BASELINE' }, [a]),
    codes: ['baseline-vertical'],
    key: 'f',
  },
  {
    name: 'a FILL child in a frame that hugs the primary axis',
    root: frame('f', HUG, [leaf('x', 5, 5, { sizingH: 'FILL' })]),
    codes: ['fill-in-hug-parent'],
    key: 'x',
  },
  {
    name: 'a FILL child in a frame that hugs the counter axis',
    root: frame('f', { counterAxisSizingMode: 'AUTO' }, [leaf('x', 5, 5, { sizingV: 'FILL' })]),
    codes: ['fill-in-hug-parent'],
    key: 'x',
  },
  {
    name: 'a hidden FILL child does not stop the parent from hugging',
    root: frame('f', HUG, [a, leaf('x', 5, 5, { sizingH: 'FILL', visible: false })]),
    codes: [],
    key: '',
  },
  {
    name: 'a FILL root without an outer size',
    root: frame('f', {}, [a], { sizingV: 'FILL' }),
    codes: ['fill-without-stack-parent'],
    key: 'f',
  },
  {
    name: 'a FILL root with an outer size on the other axis only',
    root: frame('f', {}, [a], { sizingV: 'FILL' }),
    options: { outer: { w: 100 } },
    codes: ['fill-without-stack-parent'],
    key: 'f',
  },
  {
    name: 'an ABSOLUTE FILL child',
    root: frame('f', {}, [leaf('x', 5, 5, { positioning: 'ABSOLUTE', xy: { x: 0, y: 0 }, sizingH: 'FILL' })]),
    codes: ['fill-without-stack-parent'],
    key: 'x',
  },
  {
    name: 'a FILL child of a frame without auto layout',
    root: { key: 'g', size: { w: 10, h: 10 }, children: [leaf('x', 5, 5, { xy: { x: 0, y: 0 }, sizingV: 'FILL' })] },
    codes: ['fill-without-stack-parent'],
    key: 'x',
  },
  {
    name: 'HUG sizing on a FIXED axis',
    root: frame('f', {}, [frame('x', {}, [], { sizingH: 'HUG' })], { size: { w: 50, h: 50 } }),
    codes: ['sizing-mode-conflict'],
    key: 'x',
  },
  {
    name: 'FILL sizing on an AUTO axis',
    root: frame('f', {}, [frame('x', { counterAxisSizingMode: 'AUTO' }, [], { sizingV: 'FILL' })], {
      size: { w: 50, h: 50 },
    }),
    codes: ['sizing-mode-conflict'],
    key: 'x',
  },
  {
    name: 'an ABSOLUTE child without xy',
    root: frame('f', {}, [leaf('x', 5, 5, { positioning: 'ABSOLUTE' })]),
    codes: ['missing-xy'],
    key: 'x',
  },
  {
    name: 'a child of a frame without auto layout and without xy',
    root: { key: 'g', size: { w: 10, h: 10 }, children: [leaf('x', 5, 5)] },
    codes: ['missing-xy'],
    key: 'x',
  },
  {
    name: 'two nodes with one key, even if one is hidden',
    root: frame('f', {}, [a, leaf('a', 1, 1, { visible: false })]),
    codes: ['duplicate-key'],
    key: 'a',
  },
  {
    name: 'a negative size',
    root: frame('f', {}, [leaf('x', -1, 5)]),
    codes: ['invalid-number'],
    key: 'x',
  },
  {
    name: 'a NaN padding and an infinite gap are one issue on the frame',
    root: frame('f', { padding: pad(Number.NaN, 0), itemSpacing: Number.POSITIVE_INFINITY }, [a]),
    codes: ['invalid-number'],
    key: 'f',
  },
  {
    name: 'a negative stroke weight and a negative min',
    root: frame('f', {}, [a], { stroke: { align: 'INSIDE', weight: { t: -1, r: 0, b: 0, l: 0 } }, min: { w: -2 } }),
    codes: ['invalid-number'],
    key: 'f',
  },
  {
    name: 'min greater than max',
    root: frame('f', {}, [leaf('x', 5, 5, { min: { h: 10 }, max: { h: 4 } })]),
    codes: ['invalid-bounds'],
    key: 'x',
  },
  {
    name: 'a hidden subtree is not checked beyond its keys',
    root: frame('f', {}, [a, frame('hidden', { wrap: true }, [leaf('bad', Number.NaN, 1)], { visible: false })]),
    codes: [],
    key: '',
  },
  {
    name: 'every issue is reported, in tree order',
    root: frame('f', { wrap: true }, [leaf('x', -1, 5), leaf('y', 5, 5, { positioning: 'ABSOLUTE' })]),
    codes: ['unsupported-wrap', 'invalid-number', 'missing-xy'],
    key: 'f',
  },
];

describe('simulate: unsimulatable input', () => {
  it.each(cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const result = simulate(entry.root, entry.options);
    if (entry.codes.length === 0) {
      expect(value(result).rects.size).toBeGreaterThan(0);
      return;
    }
    expect(codes(result)).toEqual(entry.codes);
    if (!result.ok) {
      expect(result.error[0]?.key).toBe(entry.key);
      for (const found of result.error) expect(found.message).toMatch(/\S/);
    }
  });

  it('explains a sizing conflict with the property to change', () => {
    const result = simulate(frame('f', {}, [frame('x', {}, [], { sizingH: 'HUG' })], { size: { w: 9, h: 9 } }));
    expect(result.ok ? '' : result.error[0]?.message).toBe(
      'Horizontal sizing is HUG but primaryAxisSizingMode is FIXED; HUG goes with AUTO, FIXED and FILL with FIXED.',
    );
  });
});
