import type { Rect } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { assembleText, LINE_SEPARATOR, type MeasuredToken, type TokenStyle } from '../src/page/text/assemble';
import {
  isRenderedWhitespace,
  preservesBreaks,
  preservesSpaces,
  renderedWhitespace,
  tokenize,
  whiteSpaceCollapseOf,
} from '../src/page/text/whitespace';

const plain: TokenStyle = { styleId: 's0', lineHeight: 20 };
const bold: TokenStyle = { styleId: 's1', lineHeight: 20 };

/** A content-area rect on line `line` (20 px pitch, 14 px content). */
const at = (x: number, w: number, line = 0): Rect => ({ x, y: 3 + line * 20, w, h: 14 });

const word = (text: string, rect: Rect, style = plain): MeasuredToken => ({ kind: 'word', text, rects: [rect], style });
const space = (
  rects: Rect[],
  options: { char?: string; collapse?: string; style?: TokenStyle } = {},
): MeasuredToken => ({
  kind: 'space',
  char: options.char ?? ' ',
  rects,
  style: options.style ?? plain,
  collapse: options.collapse ?? 'collapse',
});

describe('whitespace rules (05 §4.1)', () => {
  it('keeps a whitespace character iff it renders', () => {
    expect(isRenderedWhitespace(' ', { width: 4.45, rects: 1 }, 'collapse')).toBe(true);
    // Collapsed: a zero-width rect.
    expect(isRenderedWhitespace(' ', { width: 0, rects: 1 }, 'collapse')).toBe(false);
    expect(isRenderedWhitespace('\n', { width: 0.005, rects: 1 }, 'collapse')).toBe(false);
    // A soft wrap: zero width, one rect on each line.
    expect(isRenderedWhitespace(' ', { width: 0, rects: 2 }, 'collapse')).toBe(true);
    // A preserved segment break.
    expect(isRenderedWhitespace('\n', { width: 0, rects: 1 }, 'preserve')).toBe(true);
    expect(isRenderedWhitespace('\n', { width: 0, rects: 1 }, 'preserve-breaks')).toBe(true);
  });

  it('turns rendered collapsible whitespace into one space and keeps preserved characters', () => {
    expect(renderedWhitespace('\n', 'collapse')).toBe(' ');
    expect(renderedWhitespace('\t', 'collapse')).toBe(' ');
    expect(renderedWhitespace('\n', 'preserve-breaks')).toBe('\n');
    expect(renderedWhitespace('\t', 'preserve-breaks')).toBe(' ');
    expect(renderedWhitespace('\t', 'preserve')).toBe('\t');
    expect(renderedWhitespace('\r', 'break-spaces')).toBe('\n');
  });

  it('classifies white-space-collapse values', () => {
    expect([preservesBreaks('collapse'), preservesSpaces('collapse')]).toEqual([false, false]);
    expect([preservesBreaks('preserve'), preservesSpaces('preserve')]).toEqual([true, true]);
    expect([preservesBreaks('preserve-breaks'), preservesSpaces('preserve-breaks')]).toEqual([true, false]);
    expect([preservesBreaks('break-spaces'), preservesSpaces('break-spaces')]).toEqual([true, true]);
  });

  it('reads the longhand, or derives it from the white-space shorthand', () => {
    const style = (longhand: string, whiteSpace: string) => ({ getPropertyValue: () => longhand, whiteSpace });
    expect(whiteSpaceCollapseOf(style('preserve-breaks', 'pre-line'))).toBe('preserve-breaks');
    expect(whiteSpaceCollapseOf(style('', 'pre'))).toBe('preserve');
    expect(whiteSpaceCollapseOf(style('', 'pre-wrap'))).toBe('preserve');
    expect(whiteSpaceCollapseOf(style('', 'pre-line'))).toBe('preserve-breaks');
    expect(whiteSpaceCollapseOf(style('', 'break-spaces'))).toBe('break-spaces');
    expect(whiteSpaceCollapseOf(style('', 'nowrap'))).toBe('collapse');
  });

  it('tokenizes into words and single whitespace characters; NBSP belongs to words', () => {
    expect(tokenize(' ab  c\u00a0d\n')).toEqual([
      { start: 0, end: 1, whitespace: true },
      { start: 1, end: 3, whitespace: false },
      { start: 3, end: 4, whitespace: true },
      { start: 4, end: 5, whitespace: true },
      { start: 5, end: 8, whitespace: false },
      { start: 8, end: 9, whitespace: true },
    ]);
    expect(tokenize('')).toEqual([]);
  });
});

describe('assembleText: whitespace collapse', () => {
  it('drops leading, trailing and repeated collapsed whitespace', () => {
    // "\n   Hello   world\n" in a normal block.
    const assembled = assembleText([
      space([at(0, 0)], { char: '\n' }),
      space([at(0, 0)]),
      word('Hello', at(0, 36)),
      space([at(36, 4.45)]),
      space([at(40.45, 0)]),
      space([at(40.45, 0)]),
      word('world', at(40.45, 40)),
      space([at(80.45, 0)], { char: '\n' }),
    ]);
    expect(assembled.characters).toBe('Hello world');
    expect(assembled.runs).toEqual([{ start: 0, end: 11, styleId: 's0' }]);
  });

  it('collapses a space at an inline element boundary', () => {
    // "world <b> bold</b>": the space inside <b> collapses against the one before it.
    const assembled = assembleText([
      word('world', at(0, 40)),
      space([at(40, 4.45)]),
      space([at(44.45, 0)], { style: bold }),
      word('bold', at(44.45, 34), bold),
    ]);
    expect(assembled.characters).toBe('world bold');
    expect(assembled.runs).toEqual([
      { start: 0, end: 6, styleId: 's0' },
      { start: 6, end: 10, styleId: 's1' },
    ]);
  });

  it('keeps a soft-wrap space that has one rect on each line', () => {
    const assembled = assembleText([
      word('long', at(0, 30)),
      space([at(30, 0), at(0, 0, 1)]),
      word('wrap', at(0, 30, 1)),
    ]);
    expect(assembled.characters).toBe('long wrap');
    expect(assembled.pieces.map((piece) => [piece.start, piece.end])).toEqual([
      [0, 4],
      [4, 5],
      [5, 9],
    ]);
  });

  it('keeps a hanging space in its own text node when the next word wraps', () => {
    // `color,{' '}<mark>highlighted</mark>` with the line breaking after the comma.
    const assembled = assembleText([
      word('color,', at(200, 40)),
      space([at(240, 0)]),
      word('highlighted', at(0, 70, 1), bold),
    ]);
    expect(assembled.characters).toBe('color, highlighted');
  });

  it('does not invent a space where a word breaks without one', () => {
    // overflow-wrap: anywhere splits a word across lines, measured per character.
    const assembled = assembleText([word('a', at(0, 8)), word('b', at(0, 8, 1))]);
    expect(assembled.characters).toBe('ab');
  });

  it('turns <br> into U+2028 and drops the collapsed space after it', () => {
    const assembled = assembleText([
      word('one', at(0, 25)),
      { kind: 'break', rects: [at(25, 0)], style: plain },
      space([at(0, 0, 1)]),
      word('two', at(0, 25, 1)),
    ]);
    expect(assembled.characters).toBe(`one${LINE_SEPARATOR}two`);
    expect(LINE_SEPARATOR.charCodeAt(0)).toBe(0x2028);
    expect(assembled.pieces[1]).toMatchObject({ start: 3, end: 4, breakAfter: true });
  });

  it('keeps preserved spaces and line breaks under white-space: pre', () => {
    const assembled = assembleText([
      word('a', at(0, 8)),
      space([at(8, 4.45)], { collapse: 'preserve' }),
      space([at(12.45, 4.45)], { collapse: 'preserve' }),
      word('b', at(16.9, 8)),
      space([at(24.9, 0)], { char: '\n', collapse: 'preserve' }),
      word('c', at(0, 8, 1)),
    ]);
    expect(assembled.characters).toBe('a  b\nc');
    expect(assembled.pieces.find((piece) => piece.start === 4)?.breakAfter).toBe(true);
  });

  it('skips words that do not render', () => {
    const assembled = assembleText([
      { kind: 'word', text: 'hidden', rects: [], style: plain },
      word('shown', at(0, 40)),
    ]);
    expect(assembled.characters).toBe('shown');
  });
});
