import { figmaError } from './errors';

/** Fonts the fake offers when `createFakeFigma({ fonts })` is not given. */
export const DEFAULT_FONTS: readonly FontName[] = Object.freeze(
  ['Regular', 'Italic', 'Medium', 'Semi Bold', 'Bold']
    .map((style) => ({ family: 'Inter', style }))
    .concat(['Regular', 'Medium', 'Bold'].map((style) => ({ family: 'Roboto', style })))
    .map((font) => Object.freeze(font)),
);

/** The font of a new text node: `createText()` starts in Inter Regular (typings:1047-1066). */
export const DEFAULT_TEXT_FONT: FontName = Object.freeze({ family: 'Inter', style: 'Regular' });

export function fontKey(font: FontNameInput): string {
  return `${font.family}\u0000${font.style ?? ''}`;
}

/** `Inter Regular`, the way Figma names a font in its error messages. */
export function fontLabel(font: FontName): string {
  return `${font.family} ${font.style}`;
}

const WEIGHTS: ReadonlyArray<readonly [RegExp, number]> = [
  [/thin|hairline/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/light/i, 300],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/bold/i, 700],
  [/medium/i, 500],
  [/black|heavy/i, 900],
];

/** `fontWeight` derived from the style name (typings:9806-9809: 400 for "Regular", 700 for "Bold"). */
export function fontWeightOf(font: FontName): number {
  for (const [pattern, weight] of WEIGHTS) if (pattern.test(font.style)) return weight;
  return 400;
}

export function fontStyleOf(font: FontName): FontStyle {
  return /italic|oblique/i.test(font.style) ? 'ITALIC' : 'REGULAR';
}

/**
 * Available and loaded fonts. `loadFontAsync` must be awaited before any write that can
 * change rendered text (typings:1662-1698; https://developers.figma.com/docs/plugins/working-with-text).
 */
export class FontStore {
  readonly #available: readonly FontName[];
  #loaded = new Set<string>();

  constructor(available: readonly FontName[]) {
    this.#available = Object.freeze(available.map((font) => Object.freeze({ family: font.family, style: font.style })));
  }

  list(): Font[] {
    return this.#available.map((fontName) => ({ fontName: { family: fontName.family, style: fontName.style } }));
  }

  isAvailable(font: FontName): boolean {
    return this.#available.some((f) => f.family === font.family && f.style === font.style);
  }

  isLoaded(font: FontName): boolean {
    return this.#loaded.has(fontKey(font));
  }

  /**
   * Loads one style, or every style of the family when `style` is omitted (typings:1679-1681).
   * A font that is not available rejects, as Figma does for fonts it cannot reach.
   */
  load(font: FontNameInput): void {
    const matches = this.#available.filter(
      (f) => f.family === font.family && (font.style === undefined || f.style === font.style),
    );
    if (matches.length === 0) {
      const label = font.style === undefined ? font.family : `${font.family} ${font.style}`;
      throw figmaError('loadFontAsync', `The font "${label}" could not be loaded`);
    }
    for (const match of matches) this.#loaded.add(fontKey(match));
  }

  /** Forget loaded fonts: a new plugin run starts with none loaded. */
  unloadAll(): void {
    this.#loaded.clear();
  }
}
