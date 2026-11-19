import type { CComputed, CNode } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { placesLines } from '../src/text/fit';
import { element, keys, mapTree, rgb, text } from './build';

/* Stage 8, the text-only element rule (07 §11 rule 3). */

const label = { x: 10, y: 10, w: 40, h: 20 };

/** A root holding one `span` (styled by `patch`) around a text block at `textBox`. */
function wrapped(patch: (computed: CComputed) => void = () => {}, source: Partial<CNode['source']> = {}) {
  return element('div:0', { x: 0, y: 0, w: 200, h: 100 }, [
    element('div:0>span:0', label, [text('div:0>span:0>#text:0', label, 'Label')], {
      tag: 'span',
      style: patch,
      source,
    }),
  ]);
}

describe('text-only elements', () => {
  it('replaces a bare wrapper with its TEXT layer, which takes its key, box and source', () => {
    const { root } = mapTree(wrapped());
    expect(root.children).toHaveLength(1);
    expect(root.children?.[0]).toMatchObject({
      kind: 'text',
      nk: 'root/span',
      name: 'Label',
      xy: { x: 10, y: 10 },
      size: { w: 40, h: 20 },
      source: { path: 'div:0>span:0', tag: 'span' },
      text: { autoResize: 'WIDTH_AND_HEIGHT', alignV: 'TOP' },
    });
  });

  it('sizes the text to a wider block: fixed width, height from the lines', () => {
    const block = { x: 0, y: 0, w: 200, h: 20 };
    const { root } = mapTree(
      element('div:0', { x: 0, y: 0, w: 200, h: 100 }, [
        element('div:0>p:0', block, [text('div:0>p:0>#text:0', { x: 0, y: 0, w: 60, h: 20 })], { tag: 'p' }),
      ]),
    );
    expect(root.children?.[0]).toMatchObject({
      kind: 'text',
      nk: 'root/p',
      name: 'Paragraph',
      size: { w: 200, h: 20 },
      text: { autoResize: 'HEIGHT' },
    });
  });

  it('keeps the element when it draws, has padding, or is an anchor', () => {
    const cases = [
      wrapped((computed) => {
        computed.background.color = rgb(1, 0, 0);
      }),
      wrapped((computed) => {
        computed.padding = [0, 2, 0, 0];
      }),
      wrapped(() => {}, { testId: 'badge-label' }),
    ];
    for (const tree of cases) {
      const [span] = mapTree(tree).root.children ?? [];
      expect(span?.kind).toBe('frame');
      expect(keys(span)).toHaveLength(1);
    }
  });

  it('keeps the element when Figma would place the lines elsewhere', () => {
    const lines = text('t', { x: 80, y: 0, w: 40, h: 20 }).text;
    if (lines === undefined) throw new Error('no text');
    expect(placesLines(lines, { x: 0, y: 0, w: 200, h: 20 })).toBe(false);
    expect(placesLines({ ...lines, textAlign: 'center' }, { x: 0, y: 0, w: 200, h: 20 })).toBe(true);
    const left = text('t', { x: 0, y: 0, w: 40, h: 20 }).text;
    if (left === undefined) throw new Error('no text');
    expect(placesLines(left, { x: 0, y: -10, w: 200, h: 40 })).toBe(true);
    expect(placesLines(left, { x: 0, y: -4, w: 200, h: 40 })).toBe(false);
  });
});
