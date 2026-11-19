/*
 * Builds `characters`, runs and measured pieces from the measured tokens of a text block
 * (05 §4.1). Pure, so the whitespace rules are unit-tested without a browser.
 *
 * Collapse follows the rendered result: a whitespace character is kept iff its Range renders
 * (width, two rects at a soft wrap, or a preserved line break). A space that ends a line in
 * its own text node (`text,{' '}<mark>`) hangs with zero width and one rect, like a collapsed
 * one; it is recognized afterwards: when the next word starts a new line and nothing else
 * separates the two words, the first such space is kept at the end of the line.
 */
import type { CText, Rect } from '@holotype/ir';
import { type MeasuredPiece, startsNewLine } from './lines';
import { isRenderedWhitespace, renderedWhitespace } from './whitespace';

/** U+2028 LINE SEPARATOR: a `<br>` inside a text block (06 §2.2). */
export const LINE_SEPARATOR = '\u2028';

/** The style of a token: its page-local text style id and used line height. */
export interface TokenStyle {
  readonly styleId: string;
  readonly lineHeight: number;
}

/** One measured token, in block order. */
export type MeasuredToken =
  | { readonly kind: 'word'; readonly text: string; readonly rects: readonly Rect[]; readonly style: TokenStyle }
  | {
      readonly kind: 'space';
      readonly char: string;
      readonly rects: readonly Rect[];
      readonly style: TokenStyle;
      /** `white-space-collapse` of the text node. */
      readonly collapse: string;
    }
  | { readonly kind: 'break'; readonly rects: readonly Rect[]; readonly style: TokenStyle };

export interface AssembledText {
  readonly characters: string;
  readonly runs: CText['runs'];
  readonly pieces: readonly MeasuredPiece[];
}

const MIN_INK_WIDTH = 0.01;

/** Applies the whitespace rules and builds characters, runs (one per style change) and pieces. */
export function assembleText(tokens: readonly MeasuredToken[]): AssembledText {
  let characters = '';
  const runs: CText['runs'] = [];
  const pieces: MeasuredPiece[] = [];
  /** Rect of the last word, for the soft-wrap check. */
  let lastWordRect: Rect | undefined;
  /** The last thing emitted was whitespace or a break: nothing more is needed before a word. */
  let separated = true;
  /** A zero-width space that may turn out to be a soft-wrap point. */
  let pending: Extract<MeasuredToken, { kind: 'space' }> | undefined;

  const emit = (chars: string, style: TokenStyle, rects: readonly Rect[], breakAfter = false) => {
    const start = characters.length;
    characters += chars;
    const end = characters.length;
    const last = runs.at(-1);
    if (last !== undefined && last.styleId === style.styleId && last.end === start) last.end = end;
    else runs.push({ start, end, styleId: style.styleId });
    pieces.push({ start, end, rects, lineHeight: style.lineHeight, ...(breakAfter ? { breakAfter } : {}) });
  };

  for (const token of tokens) {
    if (token.kind === 'break') {
      pending = undefined;
      emit(LINE_SEPARATOR, token.style, token.rects, true);
      separated = true;
      continue;
    }
    if (token.kind === 'space') {
      const width = token.rects.reduce((sum, rect) => sum + rect.w, 0);
      if (isRenderedWhitespace(token.char, { width, rects: token.rects.length }, token.collapse)) {
        const rendered = renderedWhitespace(token.char, token.collapse);
        pending = undefined;
        emit(rendered, token.style, token.rects, rendered === '\n');
        separated = true;
      } else if (!separated && pending === undefined) {
        pending = token;
      }
      continue;
    }
    const rect = token.rects[0];
    if (rect === undefined) continue;
    if (pending !== undefined && lastWordRect !== undefined && startsNewLine(lastWordRect, rect)) {
      emit(' ', pending.style, pending.rects);
    }
    pending = undefined;
    emit(token.text, token.style, token.rects);
    lastWordRect = token.rects.findLast((candidate) => candidate.w > MIN_INK_WIDTH) ?? rect;
    separated = false;
  }
  return { characters, runs, pieces };
}
