import type { CComputed } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { effectiveLayer, paintKey } from '../src/order/paint-order';
import { byKey, element, keys, mapTree, rgb } from './build';

/* Stage 2, paint order and hoisting (07 §7). */

const painted = (computed: CComputed) => {
  computed.background.color = rgb(0.5, 0.5, 0.5);
};
const positioned = { layer: 'positioned', zIndex: 'auto' } as const;
const box = (x: number, y: number, w = 50, h = 50) => ({ x, y, w, h });

describe('paint keys (CSS 2.1 Appendix E)', () => {
  it('lifts a non-positioned stacking context to the positioned layer', () => {
    expect(effectiveLayer({ stackingContext: true, zIndex: 'auto', layer: 'block', domIndex: 0 })).toBe('positioned');
    expect(effectiveLayer({ stackingContext: false, zIndex: 'auto', layer: 'float', domIndex: 0 })).toBe('float');
  });

  it('orders by layer, then z-index, then tree order', () => {
    const key = (layer: 'negative' | 'block' | 'positive', zIndex: number | 'auto', domIndex: number) =>
      paintKey({ stackingContext: false, zIndex, layer, domIndex });
    expect(key('negative', -2, 9)).toEqual([0, -2, 9]);
    expect(key('block', 'auto', 3)).toEqual([1, 0, 3]);
    expect(key('positive', 4, 1)).toEqual([5, 4, 1]);
  });
});

describe('sorting siblings', () => {
  it('keeps DOM order when siblings do not overlap, whatever their layers', () => {
    const { root } = mapTree(
      element('div:0', box(0, 0, 300, 100), [
        element('div:0>p:0', box(0, 0), [], { tag: 'p', paint: positioned, style: painted }),
        element('div:0>div:1', box(100, 0), [], { style: painted }),
      ]),
    );
    expect(keys(root)).toEqual(['root/p', 'root/div']);
  });

  it('puts an overlapping positioned box above a later in-flow box', () => {
    const { root } = mapTree(
      element('div:0', box(0, 0, 300, 100), [
        element('div:0>p:0', box(0, 0), [], { tag: 'p', paint: positioned, style: painted }),
        element('div:0>div:1', box(25, 0), [], { style: painted }),
      ]),
    );
    expect(keys(root)).toEqual(['root/div', 'root/p']);
  });

  it('puts a negative z-index below overlapping in-flow siblings', () => {
    const { root } = mapTree(
      element('div:0', box(0, 0, 300, 100), [
        element('div:0>div:0', box(0, 0), [], { style: painted }),
        element('div:0>p:1', box(25, 0), [], {
          tag: 'p',
          paint: { layer: 'negative', zIndex: -1, stackingContext: true },
          style: painted,
        }),
      ]),
    );
    expect(keys(root)).toEqual(['root/p', 'root/div']);
  });
});

describe('z-index escapes (07 §7.3)', () => {
  /** A wrapper holding a z-indexed box that overlaps the wrapper's next sibling. */
  const escaping = (wrapperStyle: (computed: CComputed) => void = () => {}, overlap = true) =>
    element('div:0', box(0, 0, 200, 200), [
      element(
        'div:0>section:0',
        box(0, 0, 100, 50),
        [
          element('div:0>section:0>div:0', box(60, 0, 40, 40), [], { style: painted }),
          element('div:0>section:0>p:1', box(0, 30, 50, 50), [], {
            tag: 'p',
            paint: { layer: 'positive', zIndex: 1, stackingContext: true },
            style: painted,
          }),
        ],
        { tag: 'section', style: wrapperStyle },
      ),
      element('div:0>aside:1', overlap ? box(0, 50, 100, 50) : box(120, 50, 50, 50), [], {
        tag: 'aside',
        style: painted,
      }),
    ]);

  it('hoists the box to its stacking context, keeping its key, with LAYOUT_ZINDEX_HOIST', () => {
    const { root, diagnostics } = mapTree(escaping());
    expect(keys(root)).toEqual(['root/section', 'root/aside', 'root/section/p']);
    expect(keys(byKey(root, 'root/section'))).toEqual(['root/section/div']);
    expect(byKey(root, 'root/section/p')).toMatchObject({ xy: { x: 0, y: 30 }, size: { w: 50, h: 50 } });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'LAYOUT_ZINDEX_HOIST', nodeKey: 'root/section/p', severity: 'warn' }),
    );
  });

  it('keeps the clip of an ancestor it leaves with a clip frame', () => {
    const { root } = mapTree(
      escaping((computed) => {
        computed.overflowX = 'hidden';
        computed.overflowY = 'hidden';
      }),
    );
    expect(keys(root)).toEqual(['root/section', 'root/aside', 'root/section/p/clip']);
    const clip = byKey(root, 'root/section/p/clip');
    expect(clip).toMatchObject({ kind: 'frame', name: 'Clip', clipsContent: true, fills: [], size: { w: 100, h: 50 } });
    expect(keys(clip)).toEqual(['root/section/p']);
  });

  it('leaves the tree alone when the escape covers nothing', () => {
    const { root, diagnostics } = mapTree(escaping(() => {}, false));
    expect(keys(root)).toEqual(['root/section', 'root/aside']);
    expect(keys(byKey(root, 'root/section'))).toEqual(['root/section/div', 'root/section/p']);
    expect(diagnostics.map((item) => item.code)).not.toContain('LAYOUT_ZINDEX_HOIST');
  });

  it('keeps portals above the story', () => {
    const portal = element('div:1', box(0, 0, 50, 50), [], { style: painted });
    const { root } = mapTree(
      element('div:0', box(0, 0, 200, 200), [
        element('div:0>p:0', box(0, 0), [], {
          tag: 'p',
          paint: { layer: 'positive', zIndex: 10, stackingContext: true },
          style: painted,
        }),
      ]),
      { portals: [portal] },
    );
    expect(keys(root)).toEqual(['root/p', 'root/div']);
  });
});
