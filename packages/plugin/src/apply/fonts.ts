/*
 * Font resolution for text writes (09 §5.1, slice scope): exact family + style first, then the
 * request's metric-similar fallback family (normally Inter) at the nearest weight, with
 * `FONT_MISSING`. `loadFontAsync` runs once per unique FontName per session. Saved font maps
 * and the Fonts screen are B-61.
 */
import type { SceneFontRequest } from '@holotype/ir';
import { createDiagnostic, type Diagnostic, diagnostic, HolotypeError } from '@holotype/shared';
import type { FigmaPort } from '../port';

export type FontPort = Pick<FigmaPort, 'listAvailableFontsAsync' | 'loadFontAsync'>;

/** The family Figma always offers, used when a request's own fallback family is missing too. */
export const LAST_RESORT_FAMILY = 'Inter';

const WEIGHT_NAMES: ReadonlyArray<readonly [RegExp, number]> = [
  [/thin|hairline/, 100],
  [/extra\s*light|ultra\s*light/, 200],
  [/semi\s*bold|demi\s*bold/, 600],
  [/extra\s*bold|ultra\s*bold/, 800],
  [/light/, 300],
  [/medium/, 500],
  [/bold/, 700],
  [/black|heavy/, 900],
];

/** The CSS weight a style name stands for (`Semi Bold` → 600); 400 when it names none. */
export function styleWeight(style: string): number {
  const name = style.toLowerCase();
  for (const [pattern, weight] of WEIGHT_NAMES) if (pattern.test(name)) return weight;
  return 400;
}

export const isItalicStyle = (style: string): boolean => /italic|oblique/i.test(style);

/** A stable key of a request: the fields that decide its resolution. */
export function fontRequestKey(request: SceneFontRequest): string {
  return [
    request.family,
    request.weight,
    request.italic,
    request.styleCandidates.join('/'),
    request.fallbackFamily,
  ].join('|');
}

const fontKey = (font: FontName): string => `${font.family}|${font.style}`;

/**
 * `styles` from closest to farthest from `weight`: same italic-ness first, then the smallest
 * weight distance, ties to the heavier style (CSS font matching above 500 prefers heavier).
 */
export function rankStyles(styles: readonly string[], weight: number, italic: boolean): string[] {
  const score = (style: string) =>
    (isItalicStyle(style) === italic ? 0 : 10_000) +
    Math.abs(styleWeight(style) - weight) * 2 -
    (styleWeight(style) > weight ? 1 : 0);
  return [...styles].sort((a, b) => score(a) - score(b));
}

/** The style of `styles` closest to `weight` (see {@link rankStyles}). */
export const nearestStyle = (styles: readonly string[], weight: number, italic: boolean): string | undefined =>
  rankStyles(styles, weight, italic)[0];

export interface FontWhere {
  readonly sid: string;
  readonly nodeKey?: string;
}

/** Resolves `SceneFontRequest`s to loaded FontNames, reporting each substitution once. */
export class FontResolver {
  readonly #port: FontPort;
  readonly #emit: (diagnostic: Diagnostic) => void;
  #available: Promise<ReadonlyMap<string, readonly string[]>> | undefined;
  readonly #loads = new Map<string, Promise<boolean>>();
  readonly #resolved = new Map<string, Promise<FontName>>();

  constructor(port: FontPort, emit: (diagnostic: Diagnostic) => void) {
    this.#port = port;
    this.#emit = emit;
  }

  /** The loaded FontName for `request`. Throws `FONT_MISSING` (error) when no font at all loads. */
  resolve(request: SceneFontRequest, where: FontWhere): Promise<FontName> {
    const key = fontRequestKey(request);
    let resolved = this.#resolved.get(key);
    if (resolved === undefined) {
      resolved = this.#resolve(request, where);
      this.#resolved.set(key, resolved);
    }
    return resolved;
  }

  async #resolve(request: SceneFontRequest, where: FontWhere): Promise<FontName> {
    const available = await this.#availableFonts();
    const styles = available.get(request.family) ?? [];
    for (const style of request.styleCandidates) {
      if (styles.includes(style) && (await this.#load({ family: request.family, style }))) {
        return { family: request.family, style };
      }
    }
    const requested = `${request.family} ${request.styleCandidates[0] ?? ''}`.trim();
    for (const family of new Set([request.fallbackFamily, LAST_RESORT_FAMILY, ...available.keys()])) {
      const style = await this.#firstLoadable(
        family,
        rankStyles(available.get(family) ?? [], request.weight, request.italic),
      );
      if (style === undefined) continue;
      this.#emit(
        createDiagnostic(diagnostic('FONT_MISSING'), undefined, {
          sid: where.sid,
          ...(where.nodeKey === undefined ? {} : { nodeKey: where.nodeKey }),
          property: 'fontName',
          value: requested,
          fallback: `${family} ${style}`,
        }),
      );
      return { family, style };
    }
    throw new HolotypeError(
      createDiagnostic(diagnostic('FONT_MISSING'), undefined, {
        severity: 'error',
        sid: where.sid,
        property: 'fontName',
        value: requested,
        fallback: 'none: no font could be loaded',
      }),
    );
  }

  async #firstLoadable(family: string, styles: readonly string[]): Promise<string | undefined> {
    for (const style of styles) if (await this.#load({ family, style })) return style;
    return undefined;
  }

  #availableFonts(): Promise<ReadonlyMap<string, readonly string[]>> {
    this.#available ??= this.#port.listAvailableFontsAsync().then((fonts) => {
      const byFamily = new Map<string, string[]>();
      for (const { fontName } of fonts) {
        const styles = byFamily.get(fontName.family) ?? [];
        styles.push(fontName.style);
        byFamily.set(fontName.family, styles);
      }
      return byFamily;
    });
    return this.#available;
  }

  /** Loads a font once; `false` when Figma refuses it. */
  #load(font: FontName): Promise<boolean> {
    const key = fontKey(font);
    let load = this.#loads.get(key);
    if (load === undefined) {
      load = this.#port.loadFontAsync(font).then(
        () => true,
        () => false,
      );
      this.#loads.set(key, load);
    }
    return load;
  }
}
