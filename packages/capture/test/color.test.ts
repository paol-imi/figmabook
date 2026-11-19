import { describe, expect, it } from 'vitest';
import { parseCssColor, resolveCssColor } from '../src/page/color';

describe('parseCssColor (05 §7.1)', () => {
  it('parses Chromium computed sRGB colors', () => {
    expect(parseCssColor('rgb(59, 130, 246)')).toEqual({
      r: 59 / 255,
      g: 130 / 255,
      b: 246 / 255,
      a: 1,
      space: 'srgb',
    });
    expect(parseCssColor('rgba(15, 23, 42, 0.08)')).toEqual({
      r: 15 / 255,
      g: 23 / 255,
      b: 42 / 255,
      a: 0.08,
      space: 'srgb',
    });
    expect(parseCssColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0, space: 'srgb' });
  });

  it('parses the space-separated and percentage forms', () => {
    expect(parseCssColor('rgb(255 0 0 / 50%)')).toEqual({ r: 1, g: 0, b: 0, a: 0.5, space: 'srgb' });
    expect(parseCssColor('rgb(100% 50% 0%)')).toEqual({ r: 1, g: 0.5, b: 0, a: 1, space: 'srgb' });
  });

  it('parses hex colors and transparent', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1, space: 'srgb' });
    expect(parseCssColor('#3B82F6')).toEqual({ r: 59 / 255, g: 130 / 255, b: 246 / 255, a: 1, space: 'srgb' });
    expect(parseCssColor('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 128 / 255, space: 'srgb' });
    expect(parseCssColor('#f008')?.a).toBeCloseTo(0x88 / 255);
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0, space: 'srgb' });
  });

  it('keeps the CSS text of color(srgb …) as `original`', () => {
    expect(parseCssColor('color(srgb 0.5 0.25 1 / 0.5)')).toEqual({
      r: 0.5,
      g: 0.25,
      b: 1,
      a: 0.5,
      space: 'srgb',
      original: 'color(srgb 0.5 0.25 1 / 0.5)',
    });
  });

  it('clamps out-of-range channels to 0..1', () => {
    expect(parseCssColor('color(srgb 1.2 -0.1 0.5)')).toMatchObject({ r: 1, g: 0, b: 0.5 });
    expect(parseCssColor('rgb(300, 0, 0)')?.r).toBe(1);
  });

  it('returns null for wide-gamut and unknown syntaxes, and for malformed input', () => {
    for (const text of [
      'oklch(0.65 0.2 145)',
      'color(display-p3 1 0 0)',
      'lab(50% 40 59)',
      'currentcolor',
      'rgb(1, 2)',
      'rgb(a, b, c)',
      '#12345',
      '#ggg',
      '',
    ]) {
      expect(parseCssColor(text), text).toBeNull();
    }
  });
});

describe('resolveCssColor', () => {
  it('uses the exact parse when it can and the read-back otherwise', () => {
    const calls: string[] = [];
    const readback = (text: string) => {
      calls.push(text);
      return { r: 0.1, g: 0.7, b: 0.2, a: 1, space: 'srgb' as const, original: text };
    };
    expect(resolveCssColor('rgb(0, 0, 0)', readback)).toEqual({
      color: { r: 0, g: 0, b: 0, a: 1, space: 'srgb' },
      readback: false,
    });
    expect(calls).toEqual([]);
    expect(resolveCssColor('oklch(0.65 0.2 145)', readback)).toEqual({
      color: { r: 0.1, g: 0.7, b: 0.2, a: 1, space: 'srgb', original: 'oklch(0.65 0.2 145)' },
      readback: true,
    });
  });

  it('falls back to transparent black when even the read-back fails', () => {
    expect(resolveCssColor('nonsense(1)', () => null)).toEqual({
      color: { r: 0, g: 0, b: 0, a: 0, space: 'srgb', original: 'nonsense(1)' },
      readback: true,
    });
  });
});
