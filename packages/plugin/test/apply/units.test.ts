import { describe, expect, it, vi } from 'vitest';
import {
  APPLIER_EPOCH,
  ARGS_MAX_LENGTH,
  identityVersion,
  variantArgs,
  writeIdentity,
  writeProvisionalKey,
} from '../../src/apply/identity';
import { paintAssets, toEffect, toPaint, toPaints, toTransform } from '../../src/apply/paints';
import { COMPONENT_SPACING, contentBottom, nextComponentTop, variantGrid } from '../../src/apply/placement';
import { createSlicer } from '../../src/apply/slicer';
import { utf8Decode } from '../../src/apply/utf8';
import { orderedWriters, WRITERS } from '../../src/apply/write/index';
import type { NodeWriter } from '../../src/apply/write/types';
import { createFakeFigma } from '../support/fake';
import { card, node, PNG_SHA, solid } from '../support/scenes';

describe('utf8Decode (no TextDecoder in the main thread)', () => {
  const decoder = new TextDecoder();
  it.each([
    ['ascii', 'Hello, Figma'],
    ['two and three bytes', 'café · 日本語'],
    ['astral', 'icons 🎨🧩'],
    ['empty', ''],
  ])('%s round-trips like TextDecoder', (_name, value) => {
    const bytes = new TextEncoder().encode(value);
    expect(utf8Decode(bytes)).toBe(decoder.decode(bytes));
  });

  it('skips a BOM and decodes long input in blocks', () => {
    const long = '<path d="M0 0"/>'.repeat(2000);
    expect(utf8Decode(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(long)]))).toBe(long);
  });

  it.each([
    ['a lone continuation byte', [0x80]],
    ['a truncated sequence', [0xe6, 0x97]],
    ['an overlong form', [0xc0, 0xaf]],
    ['a surrogate', [0xed, 0xa0, 0x80]],
    ['past U+10FFFF', [0xf4, 0x90, 0x80, 0x80]],
    ['an invalid lead', [0xff, 0x41]],
  ])('replaces %s with U+FFFD like TextDecoder', (_name, bytes) => {
    const input = Uint8Array.from(bytes);
    expect(utf8Decode(input)).toBe(decoder.decode(input));
  });
});

describe('createSlicer (09 §12)', () => {
  it('yields only once the budget is spent, then starts a new slice', async () => {
    let now = 0;
    const yieldToEditor = vi.fn(async () => {});
    const slicer = createSlicer({ now: () => now, yieldToEditor, budgetMs: 12 });
    now = 11;
    await slicer.tick();
    expect(yieldToEditor).not.toHaveBeenCalled();
    now = 12;
    await slicer.tick();
    expect(yieldToEditor).toHaveBeenCalledTimes(1);
    now = 20;
    await slicer.tick();
    expect(yieldToEditor).toHaveBeenCalledTimes(1);
  });
});

describe('paints and effects', () => {
  const images = (sha: string) => (sha === PNG_SHA ? 'figma-hash' : null);

  it('converts every paint kind to a new Plugin API object', () => {
    const source = solid(0.1, 0.2, 0.3, 0.5);
    const paint = toPaint(source, images);
    expect(paint).toEqual({ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 }, opacity: 0.5 });
    expect(paint && 'color' in paint ? paint.color : null).not.toBe(source.color);
    expect(
      toPaint(
        {
          type: 'IMAGE',
          asset: { sha: PNG_SHA },
          scaleMode: 'CROP',
          imageTransform: [
            [1, 0, 0],
            [0, 1, 0],
          ],
          scalingFactor: 2,
          opacity: 0.8,
        },
        images,
      ),
    ).toEqual({
      type: 'IMAGE',
      imageHash: 'figma-hash',
      scaleMode: 'CROP',
      imageTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      scalingFactor: 2,
      opacity: 0.8,
    });
    expect(
      toPaint(
        {
          type: 'GRADIENT_RADIAL',
          gradientTransform: [
            [1, 0, 0],
            [0, 1, 0],
          ],
          gradientStops: [
            { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 1, g: 1, b: 1, a: 0 }, bind: { key: 'var:x', confidence: 'chain' } },
          ],
        },
        images,
      ),
    ).toEqual({
      type: 'GRADIENT_RADIAL',
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      gradientStops: [
        { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 1, g: 1, b: 1, a: 0 } },
      ],
    });
  });

  it('leaves out an image paint whose image Figma refused', () => {
    expect(
      toPaints([{ type: 'IMAGE', asset: { sha: 'f'.repeat(64) }, scaleMode: 'FILL' }, solid(0, 0, 0)], images),
    ).toEqual([{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }]);
    expect(paintAssets([solid(0, 0, 0), { type: 'IMAGE', asset: { sha: PNG_SHA }, scaleMode: 'FIT' }])).toEqual([
      PNG_SHA,
    ]);
    expect(paintAssets(undefined)).toEqual([]);
  });

  it('converts shadows and blurs with their required fields', () => {
    expect(
      toEffect({
        type: 'INNER_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.5 },
        offset: { x: 1, y: 2 },
        radius: 3,
        spread: 1,
        showShadowBehindNode: false,
      }),
    ).toEqual({
      type: 'INNER_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.5 },
      offset: { x: 1, y: 2 },
      radius: 3,
      spread: 1,
      visible: true,
      blendMode: 'NORMAL',
      showShadowBehindNode: false,
    });
    expect(toEffect({ type: 'BACKGROUND_BLUR', radius: 8 })).toEqual({
      type: 'BACKGROUND_BLUR',
      blurType: 'NORMAL',
      radius: 8,
      visible: true,
    });
    expect(
      toTransform([
        [2, 0, 5],
        [0, 2, 6],
      ]),
    ).toEqual([
      [2, 0, 5],
      [0, 2, 6],
    ]);
  });
});

describe('identity (10 §2)', () => {
  it('writes v as "<irMajor>.<applierEpoch>"', () => {
    expect(identityVersion(0)).toBe(`0.${APPLIER_EPOCH}`);
  });

  it('writes nk and irh on descendants; sid, vk, v, story and args on a variant root', () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    const [variant] = card.variants;
    if (variant === undefined) throw new Error('fixture');
    writeIdentity(frame, variant.root, { sid: card.sid, variant, v: '0.1' });
    expect(frame.getSharedPluginDataKeys('holotype').sort()).toEqual(['args', 'irh', 'nk', 'sid', 'story', 'v', 'vk']);
    expect(frame.getSharedPluginData('holotype', 'vk')).toBe(variant.vk);
    const child = figma.createRectangle();
    const [title] = variant.root.children ?? [];
    if (title === undefined) throw new Error('fixture');
    writeIdentity(child, title);
    expect(child.getSharedPluginDataKeys('holotype').sort()).toEqual(['irh', 'nk']);
  });

  it('does not rewrite a key that already holds the value (10 §2.2)', () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    writeProvisionalKey(frame, 'root/a');
    const before = figma.ops().length;
    writeProvisionalKey(frame, 'root/a');
    writeIdentity(frame, node('root/a', 'frame', 'A', { x: 0, y: 0, w: 1, h: 1 }));
    expect(
      figma
        .ops()
        .slice(before)
        .map((op) => op.property),
    ).toEqual(['holotype/irh']);
  });

  it('truncates args to 8 kB with an ellipsis', () => {
    const [variant] = card.variants;
    if (variant === undefined) throw new Error('fixture');
    const long = { ...variant, provenance: { ...variant.provenance, args: { text: 'x'.repeat(10_000) } } };
    const args = variantArgs(long);
    expect(args).toHaveLength(ARGS_MAX_LENGTH);
    expect(args.endsWith('…')).toBe(true);
    expect(JSON.parse(variantArgs(variant))).toEqual({
      args: { Elevation: 'Flat' },
      globals: {},
      state: null,
      viewport: { w: 1280, h: 800 },
    });
  });
});

describe('placement', () => {
  it('lays variants out on their grid tracks with the set gap', () => {
    const grid = variantGrid(card, { x: 0, y: 100 });
    expect(grid.boxes).toEqual([
      { x: 0, y: 100, w: 240, h: 160 },
      { x: 264, y: 100, w: 240, h: 160 },
    ]);
    expect(grid.bottom).toBe(260);
  });

  it('starts below existing page content', () => {
    const figma = createFakeFigma();
    expect(contentBottom(figma.currentPage)).toBeNull();
    expect(nextComponentTop(figma.currentPage)).toBe(0);
    const frame = figma.createFrame();
    frame.y = 40;
    expect(nextComponentTop(figma.currentPage)).toBe(140 + COMPONENT_SPACING);
  });
});

describe('writer registry (BUILD §2.3)', () => {
  it('runs writers in 09 §6 step order: size, position, content, visuals', () => {
    expect(orderedWriters().map((writer) => [writer.step, writer.name])).toEqual([
      [4, 'size'],
      [5, 'position'],
      [7, 'text'],
      [8, 'paint'],
      [8, 'corners'],
      [8, 'effects'],
      [8, 'compositing'],
    ]);
    expect(WRITERS).toHaveLength(7);
  });

  it('sorts by step and keeps registry order within a step', () => {
    const writer = (name: string, step: number): NodeWriter => ({ name, step, write: () => {} });
    expect(orderedWriters([writer('b', 8), writer('a', 3), writer('c', 8), writer('d', 6)]).map((w) => w.name)).toEqual(
      ['a', 'd', 'b', 'c'],
    );
  });
});
