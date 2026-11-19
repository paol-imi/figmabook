import { describe, expect, it } from 'vitest';
import { createFakeFigma } from '../src';
import { RED } from './helpers';

describe('fills and strokes (typings:8706-8821)', () => {
  it('normalises paints with visible, opacity, blendMode and boundVariables', () => {
    const node = createFakeFigma().createRectangle();
    node.fills = [RED, { type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 0.5, visible: false }];
    expect(node.fills).toEqual([
      {
        type: 'SOLID',
        visible: true,
        opacity: 1,
        blendMode: 'NORMAL',
        color: { r: 1, g: 0, b: 0 },
        boundVariables: {},
      },
      {
        type: 'SOLID',
        visible: false,
        opacity: 0.5,
        blendMode: 'NORMAL',
        color: { r: 0, g: 0, b: 1 },
        boundVariables: {},
      },
    ]);
  });

  it('rejects colours with alpha, unknown keys and out-of-range channels', () => {
    const node = createFakeFigma().createRectangle();
    const withAlpha = { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } } as unknown as Paint;
    expect(() => {
      node.fills = [withAlpha];
    }).toThrow(/Unrecognized key\(s\) in object: 'a'/);
    expect(() => {
      node.fills = [{ ...RED, extra: 1 } as unknown as Paint];
    }).toThrow(/'extra'/);
    expect(() => {
      node.fills = [{ type: 'SOLID', color: { r: 2, g: 0, b: 0 } }];
    }).toThrow(/between 0 and 1/);
    expect(() => {
      node.fills = [{ type: 'NOPE' } as unknown as Paint];
    }).toThrow(/paint type/);
    expect(() => {
      node.fills = RED as unknown as Paint[];
    }).toThrow(/array/);
  });

  it('accepts gradients and image paints, and refuses pattern paints on the sync setter', () => {
    const node = createFakeFigma().createRectangle();
    node.fills = [
      {
        type: 'GRADIENT_LINEAR',
        gradientTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        gradientStops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
        ],
      },
      { type: 'IMAGE', scaleMode: 'FILL', imageHash: 'abc' },
    ];
    expect(node.fills).toHaveLength(2);
    expect(() => {
      node.fills = [
        {
          type: 'PATTERN',
          sourceNodeId: '1:2',
          tileType: 'RECTANGULAR',
          scalingFactor: 1,
          spacing: { x: 0, y: 0 },
          horizontalAlignment: 'START',
        },
      ];
    }).toThrow(/setFillsAsync/);
  });

  it('setFillsAsync and setStrokesAsync set paints', async () => {
    const node = createFakeFigma().createRectangle();
    await node.setFillsAsync([RED]);
    await node.setStrokesAsync([RED]);
    expect(node.fills).toEqual(node.strokes);
  });

  it('strokeWeight is figma.mixed when sides differ, and sets all sides (typings:8725-8737)', () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    frame.strokeWeight = 2;
    expect([frame.strokeTopWeight, frame.strokeLeftWeight]).toEqual([2, 2]);
    frame.strokeTopWeight = 4;
    expect(frame.strokeWeight).toBe(figma.mixed);
    expect(() => {
      frame.strokeWeight = -1;
    }).toThrow(/>= 0/);
    expect(() => {
      frame.strokeLeftWeight = -1;
    }).toThrow(/>= 0/);
  });

  it('dashPattern, strokeAlign, strokeJoin and strokeCap validate their values', () => {
    const node = createFakeFigma().createVector();
    node.dashPattern = [4, 2];
    node.strokeAlign = 'OUTSIDE';
    node.strokeJoin = 'ROUND';
    node.strokeCap = 'ROUND';
    expect([node.dashPattern, node.strokeAlign, node.strokeJoin, node.strokeCap]).toEqual([
      [4, 2],
      'OUTSIDE',
      'ROUND',
      'ROUND',
    ]);
    expect(() => {
      node.dashPattern = [-1];
    }).toThrow(/>= 0/);
    expect(() => {
      node.strokeAlign = 'MIDDLE' as 'CENTER';
    }).toThrow(/strokeAlign/);
  });

  it('style ids read as empty and are read-only under dynamic-page (typings:8718, 8806)', () => {
    const node = createFakeFigma().createRectangle();
    expect(node.fillStyleId).toBe('');
    expect(() => {
      node.fillStyleId = 'S:1';
    }).toThrow(/setFillStyleIdAsync/);
    expect(() => {
      node.strokeStyleId = 'S:1';
    }).toThrow(/setStrokeStyleIdAsync/);
    expect(() => {
      node.effectStyleId = 'S:1';
    }).toThrow(/setEffectStyleIdAsync/);
  });

  it('frames expose backgrounds as the deprecated alias of fills (typings:7670-7693)', () => {
    const frame = createFakeFigma().createFrame();
    frame.backgrounds = [RED];
    expect(frame.fills).toEqual(frame.backgrounds);
  });
});

describe('corners (typings:8996-9036)', () => {
  it('cornerRadius is figma.mixed when corners differ, and sets all four', () => {
    const figma = createFakeFigma();
    const rect = figma.createRectangle();
    rect.cornerRadius = 8;
    expect([rect.topLeftRadius, rect.bottomRightRadius]).toEqual([8, 8]);
    rect.topLeftRadius = 2;
    expect(rect.cornerRadius).toBe(figma.mixed);
    expect(() => {
      rect.cornerRadius = -2;
    }).toThrow(/>= 0/);
    expect(() => {
      rect.cornerSmoothing = 1.5;
    }).toThrow(/<= 1/);
  });

  it('ellipses and vectors have cornerRadius but no individual corners', () => {
    const figma = createFakeFigma();
    const ellipse = figma.createEllipse();
    ellipse.cornerRadius = 3;
    expect(ellipse.cornerRadius).toBe(3);
    expect('topLeftRadius' in ellipse).toBe(false);
    expect('topLeftRadius' in figma.createVector()).toBe(false);
  });
});

describe('blend (typings:9494-9545, 7597-7660)', () => {
  it('opacity is between 0 and 1; blendMode and maskType are enums', () => {
    const node = createFakeFigma().createRectangle();
    node.opacity = 0.25;
    node.blendMode = 'MULTIPLY';
    node.isMask = true;
    node.maskType = 'LUMINANCE';
    expect([node.opacity, node.blendMode, node.isMask, node.maskType]).toEqual([0.25, 'MULTIPLY', true, 'LUMINANCE']);
    expect(() => {
      node.opacity = 1.1;
    }).toThrow(/<= 1/);
    expect(() => {
      node.blendMode = 'BLEND' as BlendMode;
    }).toThrow(/blend mode/);
  });

  it('effects need their required fields (typings:4351-4432)', () => {
    const node = createFakeFigma().createRectangle();
    expect(() => {
      node.effects = [
        { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 0 }, radius: 2 } as Effect,
      ];
    }).toThrow(/visible/);
    expect(() => {
      node.effects = [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0 },
          offset: { x: 0, y: 0 },
          radius: 2,
          visible: true,
          blendMode: 'NORMAL',
        } as unknown as Effect,
      ];
    }).toThrow(/color\.a/);
    node.effects = [{ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 4, visible: true }];
    expect(node.effects).toHaveLength(1);
  });
});

describe('node type surfaces follow the typings mixins', () => {
  it('text has no children or corners; sections have no blend, layout children or constraints', () => {
    const figma = createFakeFigma();
    const text = figma.createText();
    const section = figma.createSection();
    expect('children' in text).toBe(false);
    expect('cornerRadius' in text).toBe(false);
    expect('layoutMode' in text).toBe(false);
    expect('opacity' in section).toBe(false);
    expect('constraints' in section).toBe(false);
    expect('layoutSizingHorizontal' in section).toBe(false);
    expect('children' in section).toBe(true);
    expect('layoutMode' in figma.createFrame()).toBe(true);
    expect('layoutMode' in figma.createRectangle()).toBe(false);
    expect('variantProperties' in figma.createComponent()).toBe(true);
    expect('variantProperties' in figma.createFrame()).toBe(false);
  });
});
