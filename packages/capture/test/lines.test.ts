import type { Rect } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { resolveTextAlign } from '../src/page/text/extract';
import { ascentLeading, groupLines, type MeasuredPiece, startsNewLine } from '../src/page/text/lines';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const piece = (start: number, end: number, rects: Rect[], lineHeight = 24, breakAfter = false): MeasuredPiece => ({
  start,
  end,
  rects,
  lineHeight,
  ...(breakAfter ? { breakAfter } : {}),
});

describe('ascentLeading', () => {
  it('floors half the leading to whole px, as Chromium lays lines out', () => {
    // Measured on the pinned Chromium: a 14 px content area in line boxes of 10–21 px.
    expect([10, 12, 15, 16, 16.5, 17, 18.296875, 21, 13.703125].map((lh) => ascentLeading(lh, 14))).toEqual([
      -2, -1, 0, 1, 1, 1, 2, 3, -1,
    ]);
  });
});

describe('startsNewLine', () => {
  it('keeps mixed font sizes of one line together', () => {
    expect(startsNewLine(rect(0, 2, 10, 20), rect(10, 6, 10, 14))).toBe(false);
  });

  it('separates consecutive lines, even with negative leading', () => {
    expect(startsNewLine(rect(0, 2, 10, 20), rect(0, 26, 10, 20))).toBe(true);
    // line-height: 1 on a 1.21 content area: the content areas overlap by about 3 px.
    expect(startsNewLine(rect(0, 0, 10, 19.4), rect(0, 16, 10, 19.4))).toBe(true);
  });
});

describe('groupLines (05 §4.2)', () => {
  it('builds one line box per browser line from content-area rects', () => {
    // "The quick fox": 14 px content area in a 24 px line, two lines.
    const lines = groupLines([
      piece(0, 3, [rect(0, 5, 28, 14)]),
      piece(3, 4, [rect(28, 5, 4, 14)]),
      piece(4, 9, [rect(32, 5, 40, 14)]),
      piece(9, 10, [rect(72, 5, 0, 14), rect(0, 29, 0, 14)]),
      piece(10, 13, [rect(0, 29, 24, 14)]),
    ]);
    expect(lines).toEqual([
      { top: 0, height: 24, left: 0, width: 72, startChar: 0, endChar: 10 },
      { top: 24, height: 24, left: 0, width: 24, startChar: 10, endChar: 13 },
    ]);
  });

  it('unions line boxes of mixed sizes on one line', () => {
    const lines = groupLines([piece(0, 4, [rect(0, 2, 30, 20)], 24), piece(4, 9, [rect(30, 6, 30, 12)], 16)]);
    expect(lines).toEqual([{ top: 0, height: 24, left: 0, width: 60, startChar: 0, endChar: 9 }]);
  });

  it('ends a line at a forced break, even when the next piece overlaps it', () => {
    const lines = groupLines([
      piece(0, 3, [rect(0, 5, 20, 14)]),
      piece(3, 4, [rect(20, 5, 0, 14)], 24, true),
      piece(4, 4, []),
      piece(4, 7, [rect(0, 5, 20, 14)]),
    ]);
    expect(lines.map((line) => [line.startChar, line.endChar])).toEqual([
      [0, 4],
      [4, 7],
    ]);
  });

  it('gives an uninked line its position and no width', () => {
    expect(groupLines([piece(0, 1, [rect(12, 5, 0, 14)], 24, true)])).toEqual([
      { top: 0, height: 24, left: 12, width: 0, startChar: 0, endChar: 1 },
    ]);
  });

  it('returns no lines for no pieces', () => {
    expect(groupLines([])).toEqual([]);
  });
});

describe('resolveTextAlign', () => {
  it('resolves start and end through direction', () => {
    expect(resolveTextAlign('start', 'ltr')).toBe('left');
    expect(resolveTextAlign('start', 'rtl')).toBe('right');
    expect(resolveTextAlign('end', 'ltr')).toBe('right');
    expect(resolveTextAlign('end', 'rtl')).toBe('left');
    expect(resolveTextAlign('-webkit-center', 'ltr')).toBe('center');
    expect(resolveTextAlign('justify', 'ltr')).toBe('justify');
    expect(resolveTextAlign('right', 'rtl')).toBe('right');
    expect(resolveTextAlign('match-parent', 'ltr')).toBe('left');
  });
});
