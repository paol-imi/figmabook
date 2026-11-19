import { fontStyleOf, fontWeightOf } from './fonts';
import type { CharStyle, TextModel } from './text-model';

/**
 * Deterministic text metrics (BUILD §8.1 "Text metrics: deterministic advances per font and
 * character class"). The fake has no font files, so it approximates Figma's text engine:
 *
 * - **Advances** come from a per-class table in em (narrow, lowercase, uppercase, wide, digits,
 *   spaces, CJK), scaled by the font family, weight and style, plus letter spacing.
 * - **Line breaking** is greedy at spaces and after hyphens; a word longer than the line breaks
 *   between characters. `\n` starts a paragraph; U+2028 breaks the line inside a paragraph (the
 *   mapper's locked-lines mode, 09 §11.1).
 * - **Line height** is the largest line height on the line: PIXELS as given, PERCENT of the font
 *   size, AUTO from the family's ascender + descender ("Auto" line height,
 *   https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties).
 *
 * The numbers are plausible, not Figma's: tests that need the browser's exact line breaks use the
 * oracle (see {@link TextOracle}) instead (BUILD §8.1).
 */

/** Auto line height as a multiple of the font size: hhea ascender + descender of the family. */
const AUTO_LINE_HEIGHT: Readonly<Record<string, number>> = {
  Inter: 1.2109375,
  Roboto: 1.171875,
};
const DEFAULT_AUTO_LINE_HEIGHT = 1.2;

/** hhea ascender as a fraction of the em, for baseline alignment. */
const ASCENDER: Readonly<Record<string, number>> = { Inter: 0.96875, Roboto: 0.927734375 };
const DEFAULT_ASCENDER = 0.8;

/** Advance scale of a family relative to the class table (Inter is the reference). */
const FAMILY_SCALE: Readonly<Record<string, number>> = { Inter: 1, Roboto: 0.95 };

const NARROW = new Set("ijl|!.,:;'`");
const SEMI_NARROW = new Set('ftr()[]{}I-/');
const WIDE = new Set('mwMW@%');

/** The em advance of one character (after text case). */
function emAdvance(ch: string): number {
  if (ch === ' ' || ch === ' ') return 0.26;
  if (NARROW.has(ch)) return 0.25;
  if (SEMI_NARROW.has(ch)) return 0.35;
  if (WIDE.has(ch)) return 0.86;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  if (ch >= 'a' && ch <= 'z') return 0.54;
  if (ch >= '0' && ch <= '9') return 0.6;
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x80) return 0.5;
  if (code >= 0x2e80) return 1;
  return 0.56;
}

/** Bolder and upright styles are wider: +2.5 % per 100 weight units above 400, −2 % for italics. */
function styleScale(style: CharStyle): number {
  const weight = 1 + ((fontWeightOf(style.fontName) - 400) / 100) * 0.025;
  const italic = fontStyleOf(style.fontName) === 'ITALIC' ? 0.98 : 1;
  return (FAMILY_SCALE[style.fontName.family] ?? 1) * weight * italic;
}

function letterSpacingPx(style: CharStyle): number {
  const { letterSpacing } = style;
  return letterSpacing.unit === 'PIXELS' ? letterSpacing.value : (letterSpacing.value / 100) * style.fontSize;
}

/** The line height of one character's style, in px. */
export function lineHeightPx(style: CharStyle): number {
  const { lineHeight } = style;
  if (lineHeight.unit === 'PIXELS') return lineHeight.value;
  if (lineHeight.unit === 'PERCENT') return (lineHeight.value / 100) * style.fontSize;
  return (AUTO_LINE_HEIGHT[style.fontName.family] ?? DEFAULT_AUTO_LINE_HEIGHT) * style.fontSize;
}

/**
 * Distance from the top of the text to its first baseline: the glyph box is centred in the
 * line box (half-leading, as in CSS), and the baseline sits one ascender below the glyph top.
 */
export function firstBaseline(text: TextModel): number {
  const style = text.styleAt(0);
  const family = style.fontName.family;
  const auto = AUTO_LINE_HEIGHT[family] ?? DEFAULT_AUTO_LINE_HEIGHT;
  const ascent = (ASCENDER[family] ?? DEFAULT_ASCENDER) * style.fontSize;
  return (lineHeightPx(style) - auto * style.fontSize) / 2 + ascent;
}

/** Applies `textCase` to one character; `TITLE` capitalises the first letter of each word. */
function cased(ch: string, previous: string, textCase: TextCase): string {
  switch (textCase) {
    case 'UPPER':
    case 'SMALL_CAPS':
    case 'SMALL_CAPS_FORCED':
      return ch.toUpperCase();
    case 'LOWER':
      return ch.toLowerCase();
    case 'TITLE':
      return /\p{L}/u.test(previous) ? ch : ch.toUpperCase();
    default:
      return ch;
  }
}

/** The advance of the character at `index`, in px. */
function advance(text: TextModel, index: number): number {
  const style = text.styleAt(index);
  const ch = cased(text.characters[index] ?? '', text.characters[index - 1] ?? ' ', style.textCase);
  return emAdvance(ch) * style.fontSize * styleScale(style) + letterSpacingPx(style);
}

interface Line {
  /** Width without trailing spaces. */
  readonly width: number;
  readonly height: number;
}

/** What the measurement needs besides the characters. */
export interface MeasureOptions {
  /** The wrap width, or `null` for auto-width text (no wrapping). */
  readonly wrapWidth: number | null;
  /** Added between paragraphs (`paragraphSpacing`, typings:10175-10180). */
  readonly paragraphSpacing: number;
  /** `maxLines` when `textTruncation` is ENDING, else `null` (typings:11040-11050). */
  readonly maxLines: number | null;
  /** A line count to use instead of line breaking (oracle mode). */
  readonly lineCount?: number | undefined;
}

export interface TextMeasure {
  readonly width: number;
  readonly height: number;
  readonly lineCount: number;
  /** The largest line height in the text, in px. */
  readonly lineHeight: number;
}

/** Breaks one paragraph `[start, end)` into lines. */
function breakParagraph(text: TextModel, start: number, end: number, wrapWidth: number | null): Line[] {
  const lines: Line[] = [];
  let lineStart = start;
  let width = 0;
  let trailing = 0;
  let height = 0;
  const flush = (at: number) => {
    lines.push({ width: width - trailing, height: Math.max(height, lineHeightPx(text.styleAt(lineStart))) });
    lineStart = at;
    width = 0;
    trailing = 0;
    height = 0;
  };
  let i = start;
  while (i < end) {
    // A word: up to and including its trailing spaces, or one break opportunity after a hyphen.
    let j = i;
    let wordWidth = 0;
    let wordHeight = 0;
    while (j < end && text.characters[j] !== ' ') {
      wordWidth += advance(text, j);
      wordHeight = Math.max(wordHeight, lineHeightPx(text.styleAt(j)));
      j += 1;
      if (text.characters[j - 1] === '-') break;
    }
    let spaces = 0;
    while (j < end && text.characters[j] === ' ') {
      spaces += advance(text, j);
      wordHeight = Math.max(wordHeight, lineHeightPx(text.styleAt(j)));
      j += 1;
    }
    // Earlier trailing spaces become inner spaces once the word joins the line.
    const fits = wrapWidth === null || width === 0 || width + wordWidth <= wrapWidth + 1e-6;
    if (!fits) flush(i);
    if (wrapWidth !== null && width === 0 && wordWidth > wrapWidth + 1e-6) {
      // A word wider than the line breaks between characters.
      for (let k = i; k < j; k++) {
        const w = advance(text, k);
        const isSpace = text.characters[k] === ' ';
        if (!isSpace && width - trailing > 0 && width + w > wrapWidth + 1e-6) flush(k);
        width += w;
        trailing = isSpace ? trailing + w : 0;
        height = Math.max(height, lineHeightPx(text.styleAt(k)));
      }
    } else {
      width += wordWidth + spaces;
      trailing = spaces;
      height = Math.max(height, wordHeight);
    }
    i = j;
  }
  flush(end);
  return lines;
}

/**
 * Measures a text node's content. Width is the widest line without trailing spaces; height is
 * the sum of the line heights plus paragraph spacing. An empty text has one line of its base style.
 */
export function measureText(text: TextModel, options: MeasureOptions): TextMeasure {
  const { characters } = text;
  const lines: Line[] = [];
  let paragraphs = 0;
  let start = 0;
  for (let i = 0; i <= characters.length; i++) {
    const ch = characters[i];
    if (i < characters.length && ch !== '\n' && ch !== ' ') continue;
    lines.push(...breakParagraph(text, start, i, options.wrapWidth));
    if (ch === '\n') paragraphs += 1;
    start = i + 1;
  }
  const lineHeight = Math.max(...lines.map((line) => line.height));
  const width = Math.max(0, ...lines.map((line) => line.width));
  let shown = lines;
  if (options.maxLines !== null && shown.length > options.maxLines) shown = shown.slice(0, options.maxLines);
  let height = shown.reduce((sum, line) => sum + line.height, 0) + paragraphs * options.paragraphSpacing;
  let lineCount = shown.length;
  if (options.lineCount !== undefined) {
    lineCount = options.lineCount;
    height = lineCount * lineHeight;
  }
  return { width, height, lineCount, lineHeight };
}

/**
 * Oracle mode (BUILD §8.1): returns the line count a text node should have (the Scene IR
 * `text.lines.length`), or `undefined` to fall back to the approximation. With an oracle the
 * fake sizes text as `lines × lineHeight`, so the plugin's line-parity check (09 §11.1) can be
 * tested in isolation from the approximate line breaking.
 */
export type TextOracle = (node: TextNode) => number | undefined;
