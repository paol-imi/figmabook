import { DEFAULT_TEXT_FONT, fontKey } from './fonts';
import { jsonEqual } from './json';
import { deepFreeze } from './values';

/**
 * The per-character style of a text node. Figma stores text styles per character range
 * (typings:9767-10172: every `setRange*` takes `start` inclusive and `end` exclusive), so the
 * fake keeps one immutable record per UTF-16 code unit, and node-level getters return
 * `figma.mixed` when the records differ.
 */
export interface CharStyle {
  readonly fontName: FontName;
  readonly fontSize: number;
  readonly textCase: TextCase;
  readonly textDecoration: TextDecoration;
  readonly textDecorationStyle: TextDecorationStyle;
  readonly textDecorationOffset: TextDecorationOffset;
  readonly textDecorationThickness: TextDecorationThickness;
  readonly textDecorationColor: TextDecorationColor;
  readonly textDecorationSkipInk: boolean;
  readonly lineHeight: LineHeight;
  readonly letterSpacing: LetterSpacing;
  readonly fills: readonly Paint[];
  readonly hyperlink: HyperlinkTarget | null;
}

export type StyleField = keyof CharStyle;

/** A new text node's style: Inter Regular 12, auto line height, black fill (typings:1043-1066). */
export const DEFAULT_CHAR_STYLE: CharStyle = deepFreeze({
  fontName: DEFAULT_TEXT_FONT,
  fontSize: 12,
  textCase: 'ORIGINAL',
  textDecoration: 'NONE',
  textDecorationStyle: 'SOLID',
  textDecorationOffset: { unit: 'AUTO' },
  textDecorationThickness: { unit: 'AUTO' },
  textDecorationColor: { value: 'AUTO' },
  textDecorationSkipInk: true,
  lineHeight: { unit: 'AUTO' },
  letterSpacing: { unit: 'PERCENT', value: 0 },
  fills: [
    { type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color: { r: 0, g: 0, b: 0 }, boundVariables: {} },
  ],
  hyperlink: null,
});

/** The text content and its styles. `styles.length === characters.length` always holds. */
export class TextModel {
  characters = '';
  styles: CharStyle[] = [];
  /** The style used when the text is empty, and for characters typed into an empty node. */
  base: CharStyle = DEFAULT_CHAR_STYLE;

  /** Styles of `[start, end)`, or the base style for an empty node or empty range. */
  stylesIn(start: number, end: number): readonly CharStyle[] {
    if (this.styles.length === 0 || start === end) return [this.styleAt(start)];
    return this.styles.slice(start, end);
  }

  styleAt(index: number): CharStyle {
    return this.styles[Math.min(index, this.styles.length - 1)] ?? this.base;
  }

  /** Every distinct font used by the node (the base font when empty). */
  fonts(start = 0, end = this.characters.length): FontName[] {
    const seen = new Map<string, FontName>();
    for (const style of this.stylesIn(start, end)) seen.set(fontKey(style.fontName), style.fontName);
    return [...seen.values()];
  }

  /** The value of one field over `[start, end)`, or `undefined` when the characters differ. */
  uniform<K extends StyleField>(field: K, start = 0, end = this.characters.length): CharStyle[K] | undefined {
    const styles = this.stylesIn(start, end);
    const first = styles[0];
    if (first === undefined) return undefined;
    return styles.every((style) => jsonEqual(style[field], first[field])) ? first[field] : undefined;
  }

  /** Sets one field on `[start, end)`; on an empty node it sets the base style. */
  setRange<K extends StyleField>(field: K, start: number, end: number, value: CharStyle[K]): void {
    const frozen = deepFreeze(value);
    if (this.styles.length === 0) {
      this.base = { ...this.base, [field]: frozen };
      return;
    }
    for (let i = start; i < end; i++) {
      const style = this.styles[i];
      if (style !== undefined) this.styles[i] = { ...style, [field]: frozen };
    }
    if (start === 0) this.base = this.styles[0] ?? this.base;
  }

  /**
   * Replaces the whole text. "Setting this property will reset styles applied to character
   * ranges" (typings:9861-9867): every character takes the style of the first character.
   */
  replace(characters: string): void {
    const style = this.styleAt(0);
    this.base = style;
    this.characters = characters;
    this.styles = Array.from({ length: characters.length }, () => style);
  }

  /** `insertCharacters`: inserted characters copy the style before (or after) them (typings:9869-9876). */
  insert(start: number, characters: string, useStyle: 'BEFORE' | 'AFTER'): void {
    const neighbour = useStyle === 'BEFORE' && start > 0 ? this.styleAt(start - 1) : this.styleAt(start);
    this.characters = this.characters.slice(0, start) + characters + this.characters.slice(start);
    this.styles.splice(start, 0, ...Array.from({ length: characters.length }, () => neighbour));
  }

  delete(start: number, end: number): void {
    if (start === 0 && end > 0 && this.styles[0]) this.base = this.styles[0];
    this.characters = this.characters.slice(0, start) + this.characters.slice(end);
    this.styles.splice(start, end - start);
  }

  /** Maximal runs of characters whose `fields` are equal, for `getStyledTextSegments`. */
  segments(fields: readonly StyleField[], start: number, end: number): Array<{ start: number; end: number }> {
    const runs: Array<{ start: number; end: number }> = [];
    let runStart = start;
    for (let i = start + 1; i <= end; i++) {
      const prev = this.styles[i - 1];
      const next = this.styles[i];
      const same = i < end && prev && next && fields.every((field) => jsonEqual(prev[field], next[field]));
      if (!same) {
        runs.push({ start: runStart, end: i });
        runStart = i;
      }
    }
    return runs;
  }
}
