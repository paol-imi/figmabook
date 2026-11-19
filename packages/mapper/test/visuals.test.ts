import type { CComputed, Color } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { toTargetRgb } from '../src/color';
import { hasOwnPaint, isTransformed } from '../src/css';
import { cornerRadius } from '../src/visuals/radius';
import { borderStroke } from '../src/visuals/stroke';
import { loadCapture } from './support';

const base = (): CComputed => {
  const computed = loadCapture('paints').root.computed;
  if (!computed) throw new Error('fixture root has no computed style');
  return structuredClone(computed);
};
const color = (r: number, g: number, b: number, a = 1, space: Color['space'] = 'srgb'): Color => ({
  r,
  g,
  b,
  a,
  space,
});
const codes = (notes: readonly Diagnostic[]) => notes.map((note) => note.code);

describe('borders → strokes (07 §10.3)', () => {
  it('maps a uniform border to an INSIDE stroke with per-side weights', () => {
    const computed = base();
    const red = color(1, 0, 0);
    computed.border = { width: [1, 2, 3, 4], style: ['solid', 'solid', 'solid', 'solid'], color: [red, red, red, red] };
    const notes: Diagnostic[] = [];
    expect(borderStroke(computed, 'srgb', notes)).toEqual({
      paints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
      align: 'INSIDE',
      weight: { t: 1, r: 2, b: 3, l: 4 },
    });
    expect(notes).toEqual([]);
  });

  it('has no stroke when no side draws', () => {
    const computed = base();
    computed.border = {
      width: [1, 1, 0, 2],
      style: ['none', 'hidden', 'solid', 'solid'],
      color: [color(0, 0, 0), color(0, 0, 0), color(0, 0, 0), color(0, 0, 0, 0)],
    };
    expect(borderStroke(computed, 'srgb', [])).toBeUndefined();
  });

  it('uses the color covering the most border width when sides differ', () => {
    const computed = base();
    computed.border = {
      width: [1, 1, 4, 1],
      style: ['solid', 'solid', 'solid', 'solid'],
      color: [color(1, 0, 0), color(1, 0, 0), color(0, 0, 1), color(0, 1, 0)],
    };
    const notes: Diagnostic[] = [];
    expect(borderStroke(computed, 'srgb', notes)?.paints).toEqual([
      { type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 },
    ]);
    expect(codes(notes)).toEqual(['PAINT_BORDER_DOMINANT']);
  });
});

describe('corner radii (07 §10.3)', () => {
  it('applies the CSS overlap reduction', () => {
    const computed = base();
    computed.radius = { h: [30, 30, 10, 10], v: [30, 30, 10, 10] };
    // f = min(1, 40/60, 40/20, 20/40, 20/40) = 0.5
    expect(cornerRadius(computed, { x: 0, y: 0, w: 40, h: 20 }, [])).toEqual({ tl: 15, tr: 15, br: 5, bl: 5 });
  });

  it('omits radii that are all zero', () => {
    expect(cornerRadius(base(), { x: 0, y: 0, w: 10, h: 10 }, [])).toBeUndefined();
  });
});

describe('colors (07 §9)', () => {
  it('passes sRGB through and leaves P3 alone for a P3 file', () => {
    expect(toTargetRgb(color(0.2, 0.4, 0.6), 'auto')).toEqual({ rgb: { r: 0.2, g: 0.4, b: 0.6 }, gamutMapped: false });
    expect(toTargetRgb(color(0, 1, 0, 1, 'display-p3'), 'display-p3').gamutMapped).toBe(false);
  });

  it('converts in-gamut Display P3 to sRGB without clipping', () => {
    // sRGB red expressed in Display P3.
    const { rgb, gamutMapped } = toTargetRgb(color(0.917488, 0.200287, 0.138561, 1, 'display-p3'), 'srgb');
    expect(gamutMapped).toBe(false);
    expect(rgb.r).toBeCloseTo(1, 3);
    expect(rgb.g).toBeCloseTo(0, 3);
    expect(rgb.b).toBeCloseTo(0, 3);
    expect(toTargetRgb(color(1, 1, 1, 1, 'display-p3'), 'srgb').rgb.r).toBeCloseTo(1, 5);
  });

  it('clips out-of-gamut P3 colors and says so', () => {
    const { rgb, gamutMapped } = toTargetRgb(color(0, 1, 0, 1, 'display-p3'), 'srgb');
    expect(gamutMapped).toBe(true);
    expect(rgb).toEqual({ r: 0, g: 1, b: 0 });
  });
});

describe('paint facts', () => {
  it('counts shadows on a zero-size box as paint, but not a background', () => {
    const node = structuredClone(loadCapture('paints').root);
    node.borderBox = { x: 0, y: 0, w: 0, h: 0 };
    expect(hasOwnPaint(node)).toBe(false);
    if (node.computed)
      node.computed.boxShadow = [{ inset: false, x: 0, y: 1, blur: 2, spread: 0, color: color(0, 0, 0) }];
    expect(hasOwnPaint(node)).toBe(true);
  });

  it('treats an identity or pure translation as untransformed', () => {
    expect(isTransformed(undefined)).toBe(false);
    expect(
      isTransformed([
        [1, 0, 12],
        [0, 1, 4],
      ]),
    ).toBe(false);
    expect(
      isTransformed([
        [0, -1, 0],
        [1, 0, 0],
      ]),
    ).toBe(true);
  });
});
