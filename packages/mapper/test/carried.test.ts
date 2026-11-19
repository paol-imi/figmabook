import type { CaptureDoc, CShadow, CTextStyle } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { sortDiagnostics } from '../src/capture-diagnostics';
import { cssModuleLocal, semanticClass } from '../src/naming/classes';
import { textShadowEffects } from '../src/text/shadow';
import { captureOf, element, mapTree, rgb, text } from './build';

/* Facts carried from the capture: diagnostics, CSS-module names and text shadows. */

const unsupported = (nodeKey: string | undefined): Diagnostic => ({
  code: 'CAP_CSS_UNSUPPORTED',
  severity: 'warn',
  message: 'A CSS property has no Figma equivalent (`data.property`); it was ignored.',
  property: 'background-color',
  ...(nodeKey === undefined ? {} : { nodeKey }),
  sid: 'built',
  variantKey: 'ffffffffffffffff',
});

describe('capture diagnostics', () => {
  const tree = () =>
    element('div:0', { x: 0, y: 0, w: 100, h: 40 }, [
      element(
        'div:0>span:0',
        { x: 0, y: 0, w: 40, h: 20 },
        [text('div:0>span:0>#text:0', { x: 0, y: 0, w: 40, h: 20 })],
        {
          tag: 'span',
        },
      ),
      // Paints nothing and has no children: normalization drops it.
      element('div:0>i:1', { x: 50, y: 0, w: 10, h: 10 }, [], { tag: 'i' }),
    ]);

  it('carries node facts with the nk of the layer each node became, dropped nodes on their parent', () => {
    const { diagnostics, root } = mapTree(tree(), {
      diagnostics: [unsupported('div:0>span:0>#text:0'), unsupported('div:0>i:1'), unsupported(undefined)],
    });
    expect(root.children?.map((child) => child.nk)).toEqual(['root/span']);
    expect(diagnostics.map((item) => [item.nodeKey, item.variantKey])).toEqual([
      [undefined, expect.any(String)],
      ['root', expect.any(String)],
      ['root/span', expect.any(String)],
    ]);
    expect(diagnostics.every((item) => item.variantKey !== 'ffffffffffffffff')).toBe(true);
  });

  it('sorts by code, node key and message (06 §5)', () => {
    const items = [
      { ...unsupported('b'), code: 'PAINT_DASH_APPROX' as const },
      unsupported('b'),
      unsupported('a'),
      unsupported(undefined),
    ];
    expect(sortDiagnostics(items).map((item) => [item.code, item.nodeKey])).toEqual([
      ['CAP_CSS_UNSUPPORTED', undefined],
      ['CAP_CSS_UNSUPPORTED', 'a'],
      ['CAP_CSS_UNSUPPORTED', 'b'],
      ['PAINT_DASH_APPROX', 'b'],
    ]);
  });
});

describe('CSS-module class names', () => {
  it('reads the local name of a Vite CSS-module class', () => {
    expect(cssModuleLocal('_item_1ypxr_9')).toBe('item');
    expect(cssModuleLocal('_mixedInline_12n1q_69')).toBe('mixedInline');
    expect(cssModuleLocal('card__header')).toBe('card__header');
    expect(semanticClass(['_badge_ovrqm_1'], () => true)).toBe('badge');
  });
});

describe('text shadows (07 §8.2)', () => {
  const base = (): CaptureDoc => captureOf(element('div:0', { x: 0, y: 0, w: 10, h: 10 }));
  const withShadows = (a: CShadow[] | undefined, b: CShadow[] | undefined) => {
    const capture = base();
    const body = capture.textStyles.body as CTextStyle;
    capture.textStyles = { a: { ...body, shadow: a }, b: { ...body, shadow: b } } as Record<string, CTextStyle>;
    return capture;
  };
  const glow: CShadow = { inset: false, x: 1, y: 1, blur: 2, spread: 0, color: rgb(1, 0, 0, 0.5) };
  const lines = (runs: [number, number, string][]) => {
    const block = text('t', { x: 0, y: 0, w: 10, h: 10 }, 'abcdefghij').text;
    if (block === undefined) throw new Error('no text');
    return { ...block, runs: runs.map(([start, end, styleId]) => ({ start, end, styleId })) };
  };

  it('puts a shadow shared by every range on the node, spread 0', () => {
    const notes: Diagnostic[] = [];
    const effects = textShadowEffects(
      lines([
        [0, 5, 'a'],
        [5, 10, 'b'],
      ]),
      withShadows([glow], [glow]),
      'srgb',
      notes,
    );
    expect(effects).toEqual([
      { type: 'DROP_SHADOW', color: { r: 1, g: 0, b: 0, a: 0.5 }, offset: { x: 1, y: 1 }, radius: 2, spread: 0 },
    ]);
    expect(notes).toEqual([]);
  });

  it('uses the shadow of most characters when ranges differ', () => {
    const notes: Diagnostic[] = [];
    const capture = withShadows([glow], undefined);
    expect(
      textShadowEffects(
        lines([
          [0, 3, 'a'],
          [3, 10, 'b'],
        ]),
        capture,
        'srgb',
        notes,
      ),
    ).toBeUndefined();
    expect(
      textShadowEffects(
        lines([
          [0, 7, 'a'],
          [7, 10, 'b'],
        ]),
        capture,
        'srgb',
        notes,
      ),
    ).toHaveLength(1);
    expect(notes.map((note) => note.code)).toEqual(['TEXT_SHADOW_RANGE_APPROX', 'TEXT_SHADOW_RANGE_APPROX']);
  });
});
