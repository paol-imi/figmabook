import { describe, expect, it } from 'vitest';
import { fallbackFamily, fontRequest, postScriptStyles, styleCandidates, weightFallbackOrder } from '../src/text/font';
import { LINE_SEPARATOR, lockLines } from '../src/text/locked-lines';
import { loadCapture } from './support';

describe('font requests (07 §8.6)', () => {
  it('starts with the PostScript-derived names, as in the 06 §10 Button example', () => {
    expect(styleCandidates(600, false, 'Inter-SemiBold').slice(0, 3)).toEqual(['Semi Bold', 'SemiBold', 'DemiBold']);
  });

  it('derives style names from PostScript names', () => {
    expect(postScriptStyles('Inter-SemiBoldItalic')).toEqual(['Semi Bold Italic', 'SemiBoldItalic', 'SemiBold Italic']);
    expect(postScriptStyles('Inter-Regular')).toEqual(['Regular', 'Regular', 'Regular']);
    expect(postScriptStyles('Inter')).toEqual([]);
    expect(postScriptStyles(undefined)).toEqual([]);
  });

  it('orders fallback weights as CSS font matching does', () => {
    expect(weightFallbackOrder(400)).toEqual([400, 500, 300, 200, 100, 600, 700, 800, 900]);
    expect(weightFallbackOrder(500)).toEqual([500, 400, 300, 200, 100, 600, 700, 800, 900]);
    expect(weightFallbackOrder(300)).toEqual([300, 200, 100, 400, 500, 600, 700, 800, 900]);
    expect(weightFallbackOrder(700)).toEqual([700, 800, 900, 600, 500, 400, 300, 200, 100]);
    expect(weightFallbackOrder(650)).toEqual([700, 800, 900, 600, 500, 400, 300, 200, 100]);
  });

  it('lists italic names, with plain "Italic" for 400, and no duplicates', () => {
    const candidates = styleCandidates(400, true);
    expect(candidates.slice(0, 5)).toEqual([
      'Regular Italic',
      'Normal Italic',
      'Book Italic',
      'Roman Italic',
      'Italic',
    ]);
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates).toContain('Oblique');
  });

  it('picks a metric-similar fallback by generic family', () => {
    expect(fallbackFamily('"JetBrains Mono", monospace')).toBe('Roboto Mono');
    expect(fallbackFamily('Georgia, serif')).toBe('Noto Serif');
    expect(fallbackFamily('Inter, system-ui, sans-serif')).toBe('Inter');
  });

  it('uses the platform font with the most glyphs, or the first CSS family when none was reported', () => {
    const style = loadCapture('button').textStyles.ts1;
    if (!style) throw new Error('fixture style missing');
    const twoFonts = {
      ...style,
      used: [
        { family: 'Noto Sans', postScriptName: 'NotoSans-Regular', isCustom: false, glyphCount: 2 },
        { family: 'Inter', postScriptName: 'Inter-SemiBold', isCustom: true, glyphCount: 6 },
      ],
      stretch: '75%',
      variation: { wght: 600 },
    };
    expect(fontRequest(twoFonts)).toMatchObject({
      family: 'Inter',
      postScriptName: 'Inter-SemiBold',
      isCustom: true,
      stretch: '75%',
      variation: { wght: 600 },
    });
    expect(fontRequest({ ...style, used: [], cssFamily: "'Fira Code', monospace" })).toMatchObject({
      family: 'Fira Code',
      isCustom: false,
      fallbackFamily: 'Roboto Mono',
    });
  });
});

describe('locked lines (07 §8.5)', () => {
  const lines = (...offsets: number[]) =>
    offsets.slice(0, -1).map((start, i) => ({ startChar: start, endChar: offsets[i + 1] ?? start }));

  it('replaces the space at a break, keeping every offset', () => {
    const out = lockLines('one two', [{ start: 0, end: 7 }], lines(0, 4, 7));
    expect(out.characters).toBe(`one${LINE_SEPARATOR}two`);
    expect(out.ranges).toEqual([{ start: 0, end: 7 }]);
    expect(out.lines).toEqual(lines(0, 4, 7));
  });

  it('inserts a separator inside a word and shifts later offsets', () => {
    const out = lockLines(
      'abcdef',
      [
        { start: 0, end: 3 },
        { start: 3, end: 6 },
      ],
      lines(0, 3, 6),
    );
    expect(out.characters).toBe(`abc${LINE_SEPARATOR}def`);
    // The separator belongs to the line and range before the break.
    expect(out.ranges).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 7 },
    ]);
    expect(out.lines).toEqual(lines(0, 4, 7));
  });

  it('shows a soft hyphen at a break and leaves paragraph breaks alone', () => {
    expect(lockLines('ab­cd', [{ start: 0, end: 5 }], lines(0, 3, 5)).characters).toBe(`ab-${LINE_SEPARATOR}cd`);
    const paragraph = lockLines('ab\ncd', [{ start: 0, end: 5 }], lines(0, 3, 5));
    expect(paragraph.characters).toBe('ab\ncd');
    expect(paragraph.ranges).toEqual([{ start: 0, end: 5 }]);
  });
});
