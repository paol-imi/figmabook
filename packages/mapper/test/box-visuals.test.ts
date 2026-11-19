import type { CBackgroundLayer, CComputed, Color, CReplaced, CShadow } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { background } from '../src/visuals/background';
import { cropTransform, resolveImageSize, resolvePosition } from '../src/visuals/image-geometry';
import { borderTrapezoids } from '../src/visuals/stroke';
import { byKey, element, keys, mapTree, rgb, style, text } from './build';

/* Stage 7 visuals added by B-48 (07 §10.1, §10.3, §10.4). */

const BOX = { x: 0, y: 0, w: 120, h: 60 };
const codes = (items: readonly Diagnostic[]) => items.map((item) => item.code);
const shadow = (patch: Partial<CShadow> = {}): CShadow => ({
  inset: false,
  x: 0,
  y: 2,
  blur: 4,
  spread: 0,
  color: rgb(0, 0, 0, 0.25),
  ...patch,
});

/** A root box styled by `patch`, with optional children. */
const boxed = (
  patch: (computed: CComputed) => void,
  children = [text('div:0>#text:0', { x: 8, y: 8, w: 40, h: 20 })],
) => mapTree(element('div:0', BOX, children, { style: patch }));

const solidBorder = (computed: CComputed, colors: readonly Color[], width = 2) => {
  computed.border = {
    width: [width, width, width, width],
    style: ['solid', 'solid', 'solid', 'solid'],
    color: [colors[0] ?? rgb(0, 0, 0), colors[1] ?? rgb(0, 0, 0), colors[2] ?? rgb(0, 0, 0), colors[3] ?? rgb(0, 0, 0)],
  };
};

describe('per-side borders (07 §10.3, D-16)', () => {
  it('decomposes differing side colors on a square box into mitred vectors under the content', () => {
    const red = rgb(1, 0, 0);
    const blue = rgb(0, 0, 1);
    const { root, diagnostics } = boxed((computed) => solidBorder(computed, [red, blue, red, rgb(0, 0, 0, 0)]));
    expect(root.strokes).toBeUndefined();
    expect(keys(root)).toEqual(['root/border-t', 'root/border-r', 'root/border-b', 'root/text']);
    expect(byKey(root, 'root/border-r')).toMatchObject({
      kind: 'vector',
      name: 'Border right',
      xy: { x: 118, y: 0 },
      size: { w: 2, h: 60 },
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }],
      vector: { paths: [{ windingRule: 'NONZERO', data: 'M 2 0 L 2 60 L 0 58 L 0 2 Z' }] },
    });
    expect(codes(diagnostics)).toContain('PAINT_BORDER_DECOMPOSED');
  });

  it('mitres each side by its neighbours’ widths', () => {
    const computed = style((c) => {
      solidBorder(c, [rgb(1, 0, 0), rgb(0, 1, 0), rgb(0, 0, 1), rgb(1, 1, 0)]);
      c.border.width = [1, 4, 2, 3];
    });
    const shapes = borderTrapezoids(computed, { x: 10, y: 20, w: 50, h: 30 });
    expect(shapes.map((shape) => [shape.side, shape.box, shape.path])).toEqual([
      ['t', { x: 10, y: 20, w: 50, h: 1 }, 'M 0 0 L 50 0 L 46 1 L 3 1 Z'],
      ['r', { x: 56, y: 20, w: 4, h: 30 }, 'M 4 0 L 4 30 L 0 28 L 0 1 Z'],
      ['b', { x: 10, y: 48, w: 50, h: 2 }, 'M 50 2 L 0 2 L 3 0 L 46 0 Z'],
      ['l', { x: 10, y: 20, w: 3, h: 30 }, 'M 0 30 L 0 0 L 3 1 L 3 28 Z'],
    ]);
  });

  it('keeps one stroke in the dominant color on a rounded box', () => {
    const { root, diagnostics } = boxed((computed) => {
      solidBorder(computed, [rgb(1, 0, 0), rgb(1, 0, 0), rgb(0, 0, 1), rgb(1, 0, 0)]);
      computed.radius = { h: [4, 4, 4, 4], v: [4, 4, 4, 4] };
    });
    expect(root.strokes?.paints).toEqual([{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }]);
    expect(codes(diagnostics)).toContain('PAINT_BORDER_DOMINANT');
  });
});

describe('backgrounds (07 §10.1)', () => {
  it('moves a padding-box background into an inner rectangle with the inner radius', () => {
    const { root } = boxed((computed) => {
      computed.background = { color: rgb(0, 1, 0), layers: [], clip: ['padding-box'] };
      solidBorder(computed, [rgb(0, 0, 0)], 3);
      computed.radius = { h: [8, 8, 8, 8], v: [8, 8, 8, 8] };
    });
    expect(root.fills).toEqual([]);
    expect(byKey(root, 'root/bg')).toMatchObject({
      kind: 'rectangle',
      name: 'Background',
      xy: { x: 3, y: 3 },
      size: { w: 114, h: 54 },
      radius: { tl: 5, tr: 5, br: 5, bl: 5 },
      fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0 }, opacity: 1 }],
    });
    expect(keys(root)[0]).toBe('root/bg');
  });

  const asset = { sha: 'a'.repeat(64) };
  const layer = (patch: Partial<CBackgroundLayer>): CBackgroundLayer => ({
    image: { kind: 'url', asset, natural: { w: 40, h: 20 } },
    size: 'auto',
    position: '0% 0%',
    repeat: 'repeat',
    origin: 'padding-box',
    clip: 'border-box',
    attachment: 'scroll',
    ...patch,
  });
  const fills = (layers: CBackgroundLayer[], notes: Diagnostic[] = []) =>
    background(
      style((c) => (c.background.layers = layers)),
      BOX,
      'srgb',
      notes,
    ).fills;

  it('maps cover, contain, tiles and placed images, bottom layer first', () => {
    expect(
      fills([layer({ size: 'cover' }), layer({ size: 'contain' })]).map(
        (paint) => paint.type === 'IMAGE' && paint.scaleMode,
      ),
    ).toEqual(['FIT', 'FILL']);
    expect(fills([layer({ size: '80px 40px' })])).toEqual([
      { type: 'IMAGE', asset, scaleMode: 'TILE', scalingFactor: 2 },
    ]);
    expect(fills([layer({ repeat: 'no-repeat', size: '60px auto', position: '100% 50%' })])).toEqual([
      { type: 'IMAGE', asset, scaleMode: 'CROP', imageTransform: cropTransform({ x: 60, y: 15, w: 60, h: 30 }, BOX) },
    ]);
  });

  it('reports gradients and placements it cannot draw', () => {
    const notes: Diagnostic[] = [];
    const gradient: CBackgroundLayer['image'] = {
      kind: 'linear',
      css: 'linear-gradient(red, blue)',
      angleDeg: 180,
      stops: [],
      repeating: false,
    };
    expect(fills([layer({ image: gradient }), layer({ repeat: 'no-repeat', size: 'calc(10px + 5%)' })], notes)).toEqual(
      [{ type: 'IMAGE', asset, scaleMode: 'FILL' }],
    );
    expect(notes.map((note) => note.property)).toEqual(['background-size', 'background-image']);
  });

  it('resolves CSS image sizes and positions', () => {
    expect(resolveImageSize('auto', { w: 40, h: 20 }, { w: 100, h: 100 })).toEqual({ w: 40, h: 20 });
    expect(resolveImageSize('auto 50%', { w: 40, h: 20 }, { w: 100, h: 100 })).toEqual({ w: 100, h: 50 });
    expect(resolvePosition('right 10px bottom 0px', { w: 60, h: 30 })).toEqual({ x: 50, y: 30 });
    expect(resolvePosition('center top', { w: 60, h: 30 })).toEqual({ x: 30, y: 0 });
    expect(resolvePosition('calc(10% + 2px) 0%', { w: 60, h: 30 })).toBeUndefined();
  });

  it('places object-fit: none images with a CROP from object-position', () => {
    const replaced: CReplaced = {
      kind: 'img',
      asset,
      natural: { w: 40, h: 20 },
      objectFit: 'none',
      objectPosition: '50% 50%',
    };
    const { root } = mapTree(element('div:0', BOX, [], { extra: { type: 'replaced', replaced } }));
    expect(root.fills).toEqual([
      { type: 'IMAGE', asset, scaleMode: 'CROP', imageTransform: cropTransform({ x: 40, y: 20, w: 40, h: 20 }, BOX) },
    ]);
  });

  it('keeps an image a leaf: no decomposed sides, inner background or backing rectangle', () => {
    const replaced: CReplaced = {
      kind: 'img',
      asset,
      natural: { w: 40, h: 20 },
      objectFit: 'cover',
      objectPosition: '50% 50%',
    };
    const { root } = mapTree(
      element('div:0', { x: 0, y: 0, w: 300, h: 200 }, [
        element('div:0>img:0', BOX, [], {
          tag: 'img',
          extra: { type: 'replaced', replaced },
          style: (computed) => {
            solidBorder(computed, [rgb(1, 0, 0), rgb(0, 0, 1), rgb(1, 0, 0), rgb(0, 0, 1)]);
            computed.background = { color: rgb(0, 1, 0), layers: [], clip: ['content-box'] };
            computed.boxShadow = [shadow({ spread: 4 })];
          },
        }),
      ]),
    );
    const image = byKey(root, 'root/img');
    expect(image.children).toBeUndefined();
    expect(image.strokes?.align).toBe('INSIDE');
    expect(image.fills?.map((paint) => paint.type)).toEqual(['SOLID', 'IMAGE']);
    expect(image.effects).toMatchObject([{ type: 'DROP_SHADOW', spread: 4 }]);
  });
});

describe('box shadows (07 §10.4)', () => {
  const filled = (computed: CComputed, alpha = 1) => {
    computed.background.color = rgb(1, 1, 1, alpha);
  };

  it('keeps shadows on a filled box, bottom → top, inset as INNER_SHADOW', () => {
    const { root } = boxed((computed) => {
      filled(computed);
      computed.boxShadow = [shadow({ y: 1 }), shadow({ inset: true, blur: 2 })];
    });
    expect(root.effects).toEqual([
      { type: 'INNER_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 2, spread: 0 },
      { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 1 }, radius: 4, spread: 0 },
    ]);
  });

  it('cuts the shadow out under a translucent fill', () => {
    const { root } = boxed((computed) => {
      filled(computed, 0.5);
      computed.boxShadow = [shadow()];
    });
    expect(root.effects?.[0]).toMatchObject({ type: 'DROP_SHADOW', showShadowBehindNode: false });
  });

  it('clips a filled box whose content stays inside so its spread draws', () => {
    const { root } = boxed((computed) => {
      filled(computed);
      computed.boxShadow = [shadow({ spread: 3 })];
    });
    expect(root).toMatchObject({ clipsContent: true, effects: [{ spread: 3 }] });
  });

  it('moves the shadow to a backing rectangle when the content overflows', () => {
    const { root, diagnostics } = boxed(
      (computed) => {
        filled(computed);
        computed.boxShadow = [shadow({ spread: 3 })];
        computed.radius = { h: [6, 6, 6, 6], v: [6, 6, 6, 6] };
      },
      [text('div:0>#text:0', { x: 100, y: 8, w: 60, h: 20 })],
    );
    expect(root.effects).toBeUndefined();
    expect(root.clipsContent).toBe(false);
    expect(keys(root)[0]).toBe('root/shadow');
    expect(byKey(root, 'root/shadow')).toMatchObject({
      kind: 'rectangle',
      name: 'Shadow',
      size: { w: 120, h: 60 },
      radius: { tl: 6, tr: 6, br: 6, bl: 6 },
      fills: [{ type: 'SOLID', opacity: 1 }],
      effects: [{ type: 'DROP_SHADOW', spread: 3 }],
    });
    expect(codes(diagnostics)).toContain('PAINT_SPREAD_BACKING_RECT');
  });

  it('casts a fill-less box’s shadow from a barely visible backing rectangle', () => {
    const { root } = boxed((computed) => {
      computed.boxShadow = [shadow()];
    });
    expect(byKey(root, 'root/shadow')).toMatchObject({
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.01 }],
      effects: [{ type: 'DROP_SHADOW', showShadowBehindNode: false }],
    });
  });

  it('promotes a ring on a fill-less, borderless box to an OUTSIDE stroke', () => {
    const { root, diagnostics } = boxed((computed) => {
      computed.boxShadow = [
        shadow({ y: 0, blur: 0, spread: 1 }),
        shadow({ y: 0, blur: 0, spread: 2, color: rgb(0, 0, 1) }),
      ];
    });
    expect(root.strokes).toEqual({
      paints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }],
      align: 'OUTSIDE',
      weight: { t: 2, r: 2, b: 2, l: 2 },
    });
    expect(byKey(root, 'root/shadow').effects).toMatchObject([{ spread: 1 }]);
    expect(codes(diagnostics)).toContain('PAINT_RING_PROMOTED');
  });
});

describe('outlines (07 §10.3)', () => {
  const outlined = (computed: CComputed, offset = 0) => {
    computed.outline = { width: 2, style: 'solid', color: rgb(0, 0, 1), offset };
  };

  it('draws an outline on a borderless box as its OUTSIDE stroke', () => {
    const { root } = boxed((computed) => outlined(computed));
    expect(root.strokes).toMatchObject({ align: 'OUTSIDE', weight: { t: 2, r: 2, b: 2, l: 2 } });
  });

  it('draws an offset outline as a frame right after the element', () => {
    const { root } = mapTree(
      element('div:0', { x: 0, y: 0, w: 300, h: 200 }, [
        element('div:0>button:0', { x: 20, y: 20, w: 80, h: 30 }, [], {
          tag: 'button',
          style: (computed) => {
            computed.background.color = rgb(1, 0, 0);
            computed.radius = { h: [4, 4, 4, 4], v: [4, 4, 4, 4] };
            outlined(computed, 2);
          },
        }),
      ]),
    );
    expect(keys(root)).toEqual(['root/button', 'root/button/outline']);
    expect(byKey(root, 'root/button/outline')).toMatchObject({
      kind: 'frame',
      name: 'Outline',
      xy: { x: 16, y: 16 },
      size: { w: 88, h: 38 },
      fills: [],
      radius: { tl: 8, tr: 8, br: 8, bl: 8 },
      strokes: { align: 'INSIDE', weight: { t: 2, r: 2, b: 2, l: 2 } },
    });
  });

  it('reports an offset outline on a root that clips', () => {
    const { root, diagnostics } = boxed((computed) => {
      outlined(computed, 1);
      computed.overflowX = 'hidden';
      computed.overflowY = 'hidden';
    });
    expect(keys(root)).toEqual(['root/text']);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'CAP_CSS_UNSUPPORTED', property: 'outline' }));
  });
});
