import { describe, expect, it } from 'vitest';
import { createFakeFigma, type FakeFigma } from '../src';
import { at, fakeWithFonts } from './helpers';

/** A stack with `sizes.length` fixed children of the given sizes. */
function row(figma: FakeFigma, sizes: Array<[number, number]>, mode: 'HORIZONTAL' | 'VERTICAL' = 'HORIZONTAL') {
  const parent = figma.createFrame();
  parent.layoutMode = mode;
  const children = sizes.map(([w, h]) => {
    const child = figma.createFrame();
    parent.appendChild(child);
    child.resize(w, h);
    return child;
  });
  return { parent, children };
}

function box(node: SceneNode): [number, number, number, number] {
  return [node.x, node.y, node.width, node.height];
}

describe('stack layout via layout-sim (BUILD §8.1 "Stack layout", 09 §18)', () => {
  it('places children with padding and spacing, and a HUG frame takes their size', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [
      [40, 20],
      [60, 30],
    ]);
    parent.paddingLeft = 8;
    parent.paddingRight = 4;
    parent.paddingTop = 2;
    parent.paddingBottom = 6;
    parent.itemSpacing = 10;
    parent.layoutSizingHorizontal = 'HUG';
    parent.layoutSizingVertical = 'HUG';
    expect(children.map(box)).toEqual([
      [8, 2, 40, 20],
      [58, 2, 60, 30],
    ]);
    expect([parent.width, parent.height]).toEqual([8 + 40 + 10 + 60 + 4, 2 + 30 + 6]);
  });

  it('layout results are derived state: they are not logged as writes', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [[40, 20]]);
    parent.layoutSizingHorizontal = 'HUG';
    const before = figma.ops().length;
    at(children, 0).resize(50, 20);
    expect(parent.width).toBe(50);
    expect(figma.ops().slice(before)).toEqual([
      { method: 'resize', nodeId: at(children, 0).id, property: null, value: { width: 50, height: 20 } },
    ]);
  });

  it('a HUG frame follows its children: resizing, adding, hiding and removing a child', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [[30, 10]], 'VERTICAL');
    parent.layoutSizingVertical = 'HUG';
    parent.itemSpacing = 5;
    const [first] = children;
    if (!first) throw new Error('child missing');
    expect(parent.height).toBe(10);
    first.resize(30, 25);
    expect(parent.height).toBe(25);
    const second = figma.createRectangle();
    parent.appendChild(second);
    expect([second.y, parent.height]).toEqual([30, 25 + 5 + 100]);
    second.visible = false;
    expect(parent.height).toBe(25);
    second.visible = true;
    second.remove();
    expect(parent.height).toBe(25);
  });

  it('FILL children share the free space; a FIXED frame keeps its size', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [
      [20, 10],
      [10, 10],
      [10, 10],
    ]);
    parent.resize(200, 50);
    parent.itemSpacing = 10;
    const [fixed, a, b] = children;
    if (!fixed || !a || !b) throw new Error('children missing');
    a.layoutSizingHorizontal = 'FILL';
    b.layoutSizingHorizontal = 'FILL';
    b.layoutSizingVertical = 'FILL';
    // 200 − 20 fixed − 2 × 10 spacing = 160, shared equally (layout-sim `fill-equal-share`).
    expect([parent.width, parent.height]).toEqual([200, 50]);
    expect(box(a)).toEqual([30, 0, 80, 10]);
    expect(box(b)).toEqual([120, 0, 80, 50]);
  });

  it('a child that fills makes its HUG parent FIXED on that axis (layout-sim `fill-breaks-hug`)', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [[20, 10]]);
    parent.layoutSizingHorizontal = 'HUG';
    expect(parent.primaryAxisSizingMode).toBe('AUTO');
    at(children, 0).layoutSizingHorizontal = 'FILL';
    expect(parent.primaryAxisSizingMode).toBe('FIXED');
    expect(parent.layoutSizingHorizontal).toBe('FIXED');
    expect(at(children, 0).width).toBe(parent.width);
  });

  it('making a frame HUG an axis its children fill turns those children FIXED', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [[20, 10]]);
    parent.resize(120, 40);
    const [child] = children;
    if (!child) throw new Error('child missing');
    child.layoutSizingHorizontal = 'FILL';
    expect(child.width).toBe(120);
    parent.layoutSizingHorizontal = 'HUG';
    expect([child.layoutSizingHorizontal, parent.layoutSizingHorizontal]).toEqual(['FIXED', 'HUG']);
    expect([child.width, parent.width]).toEqual([120, 120]);
    child.layoutSizingHorizontal = 'FILL';
    parent.primaryAxisSizingMode = 'AUTO';
    expect(child.layoutSizingHorizontal).toBe('FIXED');
  });

  it('alignment on both axes, including SPACE_BETWEEN', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [
      [20, 10],
      [20, 30],
    ]);
    parent.resize(100, 50);
    parent.primaryAxisAlignItems = 'SPACE_BETWEEN';
    parent.counterAxisAlignItems = 'CENTER';
    expect(children.map((c) => [c.x, c.y])).toEqual([
      [0, 20],
      [80, 10],
    ]);
    parent.primaryAxisAlignItems = 'MAX';
    parent.counterAxisAlignItems = 'MAX';
    expect(children.map((c) => [c.x, c.y])).toEqual([
      [60, 40],
      [80, 20],
    ]);
  });

  it('ABSOLUTE children keep their position and take no space; x/y of laid-out children is ignored', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [
      [20, 10],
      [30, 10],
    ]);
    parent.layoutSizingHorizontal = 'HUG';
    const [a, b] = children;
    if (!a || !b) throw new Error('children missing');
    a.x = 99;
    expect(a.x).toBe(0);
    a.layoutPositioning = 'ABSOLUTE';
    a.x = 7;
    a.y = 9;
    expect([a.x, a.y, b.x, parent.width]).toEqual([7, 9, 0, 30]);
  });

  it('nested HUG stacks propagate sizes up to the outermost auto-layout frame', () => {
    const figma = createFakeFigma();
    const outer = figma.createFrame();
    outer.layoutMode = 'VERTICAL';
    outer.layoutSizingHorizontal = 'HUG';
    outer.layoutSizingVertical = 'HUG';
    outer.paddingTop = 4;
    const inner = figma.createFrame();
    outer.appendChild(inner);
    inner.layoutMode = 'HORIZONTAL';
    inner.layoutSizingHorizontal = 'HUG';
    inner.layoutSizingVertical = 'HUG';
    const leaf = figma.createRectangle();
    inner.appendChild(leaf);
    leaf.resize(33, 11);
    expect([inner.width, inner.height]).toEqual([33, 11]);
    expect([outer.width, outer.height, inner.y]).toEqual([33, 15, 4]);
  });

  it('min and max bound children and frames', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [[20, 10]]);
    parent.layoutSizingHorizontal = 'HUG';
    parent.minWidth = 50;
    expect(parent.width).toBe(50);
    const [child] = children;
    if (!child) throw new Error('child missing');
    child.maxWidth = 15;
    expect(child.width).toBe(15);
  });

  it('a FILL non-stack frame applies its own children constraints when the layout resizes it', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [[20, 20]]);
    parent.resize(100, 20);
    const [panel] = children;
    if (!panel) throw new Error('child missing');
    const pin = figma.createRectangle();
    panel.appendChild(pin);
    pin.resize(5, 5);
    pin.x = 15;
    pin.constraints = { horizontal: 'MAX', vertical: 'MIN' };
    panel.layoutSizingHorizontal = 'FILL';
    expect(panel.width).toBe(100);
    expect(pin.x).toBe(95);
  });

  it('a rotated child takes its bounding box in the flow and keeps its size', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [
      [20, 10],
      [10, 10],
    ]);
    parent.layoutSizingHorizontal = 'HUG';
    const [rotated, next] = children;
    if (!rotated || !next) throw new Error('children missing');
    rotated.rotation = 90;
    expect([rotated.width, rotated.height]).toEqual([20, 10]);
    const bounds = rotated.absoluteBoundingBox;
    expect([bounds?.x, bounds?.y, bounds?.width, bounds?.height].map((v) => Math.round(v ?? NaN))).toEqual([
      0, 0, 10, 20,
    ]);
    expect(next.x).toBeCloseTo(10);
    expect(parent.width).toBeCloseTo(20);
  });

  it('wrap and GRID frames keep their children where they are (B-111, B-112)', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [
      [20, 10],
      [20, 10],
    ]);
    const second = at(children, 1);
    expect(second.x).toBe(20);
    parent.layoutWrap = 'WRAP';
    second.resize(40, 10);
    expect(second.x).toBe(20);
    parent.layoutMode = 'GRID';
    at(children, 0).resize(70, 10);
    expect(second.x).toBe(20);
  });

  it('inside a wrap frame, text still sizes itself and stacks still lay out', async () => {
    const figma = await fakeWithFonts();
    const wrap = figma.createFrame();
    wrap.layoutMode = 'HORIZONTAL';
    wrap.layoutWrap = 'WRAP';
    const text = figma.createText();
    wrap.appendChild(text);
    text.characters = 'Sized';
    expect(text.width).toBeGreaterThan(0);
    const inner = figma.createFrame();
    wrap.appendChild(inner);
    inner.layoutMode = 'VERTICAL';
    inner.layoutSizingVertical = 'HUG';
    const leaf = figma.createRectangle();
    inner.appendChild(leaf);
    leaf.resize(10, 33);
    expect(inner.height).toBe(33);
  });

  it('switching layoutMode re-lays out the children; NONE keeps them where they are', () => {
    const figma = createFakeFigma();
    const { parent, children } = row(figma, [
      [20, 10],
      [20, 10],
    ]);
    expect(children.map((c) => [c.x, c.y])).toEqual([
      [0, 0],
      [20, 0],
    ]);
    parent.layoutMode = 'VERTICAL';
    expect(children.map((c) => [c.x, c.y])).toEqual([
      [0, 0],
      [0, 10],
    ]);
    parent.layoutMode = 'NONE';
    at(children, 0).resize(50, 50);
    expect([at(children, 1).x, at(children, 1).y]).toEqual([0, 10]);
  });

  it('text inside a stack sizes the stack, and wraps when it fills', async () => {
    const figma = await fakeWithFonts();
    const stack = figma.createFrame();
    stack.layoutMode = 'VERTICAL';
    stack.layoutSizingHorizontal = 'HUG';
    stack.layoutSizingVertical = 'HUG';
    const text = figma.createText();
    stack.appendChild(text);
    text.characters = 'Hello world';
    expect([stack.width, stack.height]).toEqual([text.width, text.height]);
    const one = text.height;
    stack.resize(40, stack.height);
    text.layoutSizingHorizontal = 'FILL';
    expect(text.width).toBe(40);
    expect(text.height).toBeCloseTo(2 * one);
    expect(stack.height).toBeCloseTo(one);
    stack.layoutSizingVertical = 'HUG';
    expect(stack.height).toBeCloseTo(2 * one);
  });

  it('BASELINE rows align the first baselines of their text children', async () => {
    const figma = await fakeWithFonts();
    const stack = figma.createFrame();
    stack.layoutMode = 'HORIZONTAL';
    stack.counterAxisAlignItems = 'BASELINE';
    const small = figma.createText();
    const large = figma.createText();
    stack.appendChild(small);
    stack.appendChild(large);
    small.characters = 'a';
    large.characters = 'A';
    large.fontSize = 24;
    expect(small.y).toBeGreaterThan(large.y);
    expect(small.y + 12 * 0.96875).toBeCloseTo(large.y + 24 * 0.96875, 5);
  });
});
