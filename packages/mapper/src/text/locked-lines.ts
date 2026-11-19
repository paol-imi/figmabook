/*
 * Locked-lines text (07 §8.5, D-17): the browser's line breaks become U+2028 line
 * separators, so Figma breaks exactly where Chromium did. A break after a space replaces the
 * space; a break inside a word inserts a separator; a soft-hyphen break shows its hyphen.
 */

export const LINE_SEPARATOR = ' ';
const SOFT_HYPHEN = '­';

interface Span {
  readonly start: number;
  readonly end: number;
}

export interface LockedText<R extends Span, L extends { readonly startChar: number; readonly endChar: number }> {
  readonly characters: string;
  readonly ranges: R[];
  readonly lines: L[];
}

/** Rewrites `characters` with a line separator at every browser break, keeping ranges and lines aligned. */
export function lockLines<R extends Span, L extends { readonly startChar: number; readonly endChar: number }>(
  characters: string,
  ranges: readonly R[],
  lines: readonly L[],
): LockedText<R, L> {
  // UTF-16 code units, like `characters.length` and the capture offsets.
  const units = characters.split('');
  /** Break offsets (UTF-16) where a separator is inserted rather than replacing a character. */
  const inserted: number[] = [];
  for (const line of lines.slice(1)) {
    const at = line.startChar;
    const before = units[at - 1];
    if (at <= 0 || at >= units.length || before === undefined) continue;
    if (before === '\n' || before === LINE_SEPARATOR) continue;
    if (before === ' ' || before === '\t') {
      units[at - 1] = LINE_SEPARATOR;
    } else {
      if (before === SOFT_HYPHEN) units[at - 1] = '-';
      inserted.push(at);
    }
  }
  inserted.sort((a, b) => a - b);
  const shifted = (offset: number): number => offset + inserted.filter((at) => at <= offset).length;
  let text = '';
  units.forEach((unit, i) => {
    if (inserted.includes(i)) text += LINE_SEPARATOR;
    text += unit;
  });
  // An offset moves by the separators inserted at or before it, so a separator inserted at a
  // break belongs to the line (and range) before the break.
  return {
    characters: text,
    ranges: ranges.map((range) => ({ ...range, start: shifted(range.start), end: shifted(range.end) })),
    lines: lines.map((line) => ({ ...line, startChar: shifted(line.startChar), endChar: shifted(line.endChar) })),
  };
}
