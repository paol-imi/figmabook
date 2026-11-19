/*
 * Whitespace collapse (05 §4.1). Capture follows the rendered result instead of
 * re-implementing CSS: a whitespace character is kept iff the browser renders it. A Range
 * over a collapsed space has zero width; a space where a line soft-wraps also has zero
 * width but two client rects (the end of one line and the start of the next), and it is
 * kept so the text can re-wrap in Figma.
 */

/** The whitespace CSS collapses: space, tab, line feed, carriage return, form feed. NBSP is not. */
export const COLLAPSIBLE_WHITESPACE = /[ \t\n\r\f]/;

/** How a Range over one whitespace character renders. */
export interface WhitespaceMeasure {
  /** Total width of its client rects, CSS px. */
  readonly width: number;
  /** Number of client rects. */
  readonly rects: number;
}

/** Below this a rect counts as zero width (layout units are 1/64 px). */
const MIN_WIDTH = 0.01;

/** `white-space-collapse` values that keep segment breaks (`\n`) as line breaks. */
export function preservesBreaks(whiteSpaceCollapse: string): boolean {
  return (
    whiteSpaceCollapse === 'preserve' ||
    whiteSpaceCollapse === 'preserve-breaks' ||
    whiteSpaceCollapse === 'break-spaces'
  );
}

/** `white-space-collapse` values that keep spaces and tabs as written. */
export function preservesSpaces(whiteSpaceCollapse: string): boolean {
  return whiteSpaceCollapse === 'preserve' || whiteSpaceCollapse === 'break-spaces';
}

/**
 * The `white-space-collapse` longhand, from the style or derived from the `white-space`
 * shorthand for engines that only expose that.
 */
export function whiteSpaceCollapseOf(style: Pick<CSSStyleDeclaration, 'getPropertyValue' | 'whiteSpace'>): string {
  const longhand = style.getPropertyValue('white-space-collapse');
  if (longhand !== '') return longhand;
  switch (style.whiteSpace) {
    case 'pre':
    case 'pre-wrap':
      return 'preserve';
    case 'pre-line':
      return 'preserve-breaks';
    case 'break-spaces':
      return 'break-spaces';
    default:
      return 'collapse';
  }
}

/** Whether a whitespace character renders, from its measured Range (05 §4.1). */
export function isRenderedWhitespace(char: string, measure: WhitespaceMeasure, whiteSpaceCollapse: string): boolean {
  if (char === '\n' && preservesBreaks(whiteSpaceCollapse)) return true;
  if (measure.width > MIN_WIDTH) return true;
  return measure.rects >= 2;
}

/**
 * The character a rendered whitespace character contributes to `characters`: a preserved
 * line break stays `\n`, preserved spaces and tabs stay as written, and a collapsible
 * whitespace character that renders is one space.
 */
export function renderedWhitespace(char: string, whiteSpaceCollapse: string): string {
  if ((char === '\n' || char === '\r') && preservesBreaks(whiteSpaceCollapse)) return '\n';
  if (preservesSpaces(whiteSpaceCollapse) && (char === ' ' || char === '\t')) return char;
  return ' ';
}

/** A whitespace-separated token of a text node: a word (`\S+`, NBSP included) or one whitespace character. */
export interface TextToken {
  readonly start: number;
  readonly end: number;
  readonly whitespace: boolean;
}

/** Splits text into words and single whitespace characters, in order. */
export function tokenize(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let index = 0;
  while (index < text.length) {
    if (COLLAPSIBLE_WHITESPACE.test(text.charAt(index))) {
      tokens.push({ start: index, end: index + 1, whitespace: true });
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < text.length && !COLLAPSIBLE_WHITESPACE.test(text.charAt(end))) end += 1;
    tokens.push({ start: index, end, whitespace: false });
    index = end;
  }
  return tokens;
}
