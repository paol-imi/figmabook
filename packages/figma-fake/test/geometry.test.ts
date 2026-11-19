import { describe, expect, it } from 'vitest';
import { createFakeFigma, MIN_SIZE } from '../src';
import { stack } from './helpers';

describe('position and transform (typings:7296-7414)', () => {
  it('x and y are the translation of relativeTransform', () => {
    const node = createFakeFigma().createRectangle();
    node.x = 10;
    node.y = 20;
    expect(node.relativeTransform).toEqual([
      [1, 0, 10],
      [0, 1, 20],
    ]);
    node.relativeTransform = [
      [1, 0, 5],
      [0, 1, 6],
    ];
    expect([node.x, node.y]).toEqual([5, 6]);
  });

  it('rotation is atan2(-m10, m00) in degrees and keeps the translation', () => {
    const node = createFakeFigma().createRectangle();
    node.x = 3;
    node.rotation = 90;
    expect(node.rotation).toBeCloseTo(90);
    const [[a, b, x], [c, d]] = node.relativeTransform;
    expect([a, b, c, d].map((v) => Math.round(v))).toEqual([0, 1, -1, 0]);
    expect(x).toBe(3);
  });

  it('rejects malformed transforms', () => {
    const node = createFakeFigma().createRectangle();
    expect(() => {
      node.relativeTransform = [[1, 0, 0]] as unknown as Transform;
    }).toThrow(/2x3/);
  });

  it('absoluteTransform and absoluteBoundingBox compose container transforms', () => {
    const figma = createFakeFigma();
    const outer = figma.createFrame();
    outer.x = 100;
    outer.y = 50;
    const inner = figma.createRectangle();
    outer.appendChild(inner);
    inner.x = 10;
    inner.y = 5;
    inner.resize(20, 30);
    expect(inner.absoluteTransform).toEqual([
      [1, 0, 110],
      [0, 1, 55],
    ]);
    expect(inner.absoluteBoundingBox).toEqual({ x: 110, y: 55, width: 20, height: 30 });
  });

  it('auto-layout children ignore x/y writes (typings:7300-7311)', () => {
    const figma = createFakeFigma();
    const { child } = stack(figma);
    child.x = 40;
    expect(child.x).toBe(0);
    child.relativeTransform = [
      [1, 0, 9],
      [0, 1, 9],
    ];
    expect([child.x, child.y]).toEqual([0, 0]);
  });

  it('absolute children of auto layout keep their position', () => {
    const figma = createFakeFigma();
    const { child } = stack(figma);
    child.layoutPositioning = 'ABSOLUTE';
    child.x = 40;
    expect(child.x).toBe(40);
  });
});

describe('resize (typings:7501-7530)', () => {
  it('sets width and height; below 0.01 throws', () => {
    const node = createFakeFigma().createFrame();
    node.resize(MIN_SIZE, 300);
    expect([node.width, node.height]).toEqual([0.01, 300]);
    expect(() => node.resize(0, 10)).toThrow(/>= 0.01/);
    expect(() => node.resizeWithoutConstraints(10, 0.001)).toThrow(/>= 0.01/);
    expect([node.width, node.height]).toEqual([0.01, 300]);
  });

  it('resize applies children constraints; resizeWithoutConstraints does not', () => {
    const figma = createFakeFigma();
    const parent = figma.createFrame();
    parent.resize(100, 100);
    const pinned = figma.createRectangle();
    const stretched = figma.createRectangle();
    const centered = figma.createRectangle();
    const scaled = figma.createRectangle();
    for (const child of [pinned, stretched, centered, scaled]) {
      parent.appendChild(child);
      child.resize(10, 10);
      child.x = 10;
      child.y = 10;
    }
    pinned.constraints = { horizontal: 'MAX', vertical: 'MIN' };
    stretched.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' };
    centered.constraints = { horizontal: 'CENTER', vertical: 'CENTER' };
    scaled.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
    parent.resize(200, 150);
    expect([pinned.x, pinned.y]).toEqual([110, 10]);
    expect([stretched.width, stretched.height]).toEqual([110, 60]);
    expect([centered.x, centered.y]).toEqual([60, 35]);
    expect([scaled.x, scaled.width, scaled.y, scaled.height]).toEqual([20, 20, 15, 15]);
    parent.resizeWithoutConstraints(100, 100);
    expect([pinned.x, stretched.width]).toEqual([110, 110]);
  });

  it('sections never propagate constraints (typings:12344-12353)', () => {
    const figma = createFakeFigma();
    const section = figma.createSection();
    const child = figma.createFrame();
    section.appendChild(child);
    child.constraints = { horizontal: 'MAX', vertical: 'MAX' };
    section.resize(500, 500);
    expect([child.x, child.y]).toEqual([0, 0]);
    expect([section.width, section.height]).toEqual([500, 500]);
  });
});

describe('constraints (typings:7283-7292)', () => {
  it('are frozen objects; mutation throws, invalid values are rejected', () => {
    const node = createFakeFigma().createRectangle();
    expect(node.constraints).toEqual({ horizontal: 'MIN', vertical: 'MIN' });
    expect(() => {
      (node.constraints as { horizontal: ConstraintType }).horizontal = 'MAX';
    }).toThrow(TypeError);
    expect(() => {
      node.constraints = { horizontal: 'LEFT', vertical: 'MIN' } as unknown as Constraints;
    }).toThrow(/constraint/);
  });
});

describe('min and max size (typings:7321-7336)', () => {
  it('apply only to auto-layout frames and their children; null removes', () => {
    const figma = createFakeFigma();
    const { parent, child } = stack(figma);
    parent.minWidth = 50;
    child.maxWidth = 80;
    child.maxWidth = null;
    expect([parent.minWidth, child.maxWidth]).toEqual([50, null]);
    const loose = figma.createFrame();
    expect(() => {
      loose.minWidth = 10;
    }).toThrow(/auto-layout/);
    expect(() => {
      parent.minHeight = -1;
    }).toThrow(/>= 0/);
  });
});
