/*
 * Line boxes from measured text pieces (05 §4.2): the browser's own line breaking, recorded
 * as truth. Pure, so it is unit-tested without a browser.
 */
import type { Rect } from '@holotype/ir';

/** A measured slice of `characters`: a word, a rendered whitespace character or a `<br>`. */
export interface MeasuredPiece {
  /** Offsets into `characters`, end exclusive. */
  readonly start: number;
  readonly end: number;
  /** Client rects in page space, in order. A space at a soft wrap has two zero-width rects. */
  readonly rects: readonly Rect[];
  /** The piece's used line height (`lineHeightPx`), for the half-leading of its line box. */
  readonly lineHeight: number;
  /** A forced break (`<br>`, preserved `\n`): the next piece starts a new line. */
  readonly breakAfter?: boolean;
}

export interface LineBox {
  readonly top: number;
  readonly height: number;
  readonly left: number;
  readonly width: number;
  readonly startChar: number;
  readonly endChar: number;
}

/** Below this a rect has no ink: it does not widen its line. */
const MIN_INK_WIDTH = 0.01;

interface OpenLine {
  contentTop: number;
  contentBottom: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  inked: boolean;
  startChar: number;
  endChar: number;
  closed: boolean;
}

/**
 * Whether `rect` sits on a new line after content spanning `previous` vertically: their
 * content areas overlap by less than half of the shorter of the two. Content areas of one
 * line overlap almost fully even with mixed font sizes; those of consecutive lines overlap
 * by at most the negative leading.
 */
export function startsNewLine(previous: Pick<Rect, 'y' | 'h'>, rect: Pick<Rect, 'y' | 'h'>): boolean {
  const overlap = Math.min(previous.y + previous.h, rect.y + rect.h) - Math.max(previous.y, rect.y);
  return overlap < 0.5 * Math.max(Math.min(previous.h, rect.h), 1);
}

/**
 * The leading above a content area (CSS 2.1 §10.8.1: half of `lineHeight − contentHeight`).
 * Chromium floors it to whole px and puts the rest below (measured on the pinned build for
 * line heights 10–21 px, odd, even and fractional leadings).
 */
export function ascentLeading(lineHeight: number, contentHeight: number): number {
  return Math.floor((lineHeight - contentHeight) / 2);
}

/**
 * Groups pieces into line boxes. A line's vertical extent is its line box: each content-area
 * rect grown by its leading ({@link ascentLeading} above, the rest below); its horizontal
 * extent is the union of the inked rects.
 */
export function groupLines(pieces: readonly MeasuredPiece[]): LineBox[] {
  const lines: OpenLine[] = [];
  let line: OpenLine | undefined;
  for (const piece of pieces) {
    const rect = piece.rects[0];
    if (rect === undefined) {
      if (line) line.endChar = piece.end;
      continue;
    }
    const top = rect.y - ascentLeading(piece.lineHeight, rect.h);
    const bottom = top + piece.lineHeight;
    const inked = rect.w > MIN_INK_WIDTH;
    if (
      line === undefined ||
      line.closed ||
      startsNewLine({ y: line.contentTop, h: line.contentBottom - line.contentTop }, rect)
    ) {
      line = {
        contentTop: rect.y,
        contentBottom: rect.y + rect.h,
        top,
        bottom,
        left: rect.x,
        right: rect.x + (inked ? rect.w : 0),
        inked,
        startChar: piece.start,
        endChar: piece.end,
        closed: false,
      };
      lines.push(line);
    } else {
      line.contentTop = Math.min(line.contentTop, rect.y);
      line.contentBottom = Math.max(line.contentBottom, rect.y + rect.h);
      line.top = Math.min(line.top, top);
      line.bottom = Math.max(line.bottom, bottom);
      if (inked) {
        line.left = line.inked ? Math.min(line.left, rect.x) : rect.x;
        line.right = line.inked ? Math.max(line.right, rect.x + rect.w) : rect.x + rect.w;
        line.inked = true;
      }
      line.endChar = piece.end;
    }
    if (piece.breakAfter) line.closed = true;
  }
  return lines.map((open) => ({
    top: open.top,
    height: open.bottom - open.top,
    left: open.left,
    width: open.right - open.left,
    startChar: open.startChar,
    endChar: open.endChar,
  }));
}
