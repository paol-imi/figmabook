import type { CTextStyle, SceneFontRequest } from '@holotype/ir';

/*
 * Fonts → `SceneFontRequest` (07 §8.6). The mapper does not know which fonts the Figma user
 * has: it lists style names in preference order and the plugin preflight picks the first
 * that exists.
 */

/** CSS weight → Figma style-name synonyms (07 §8.6 table). */
const WEIGHT_NAMES: Readonly<Record<number, readonly string[]>> = {
  100: ['Thin', 'Hairline'],
  200: ['ExtraLight', 'Extra Light', 'UltraLight'],
  300: ['Light'],
  400: ['Regular', 'Normal', 'Book', 'Roman'],
  500: ['Medium'],
  600: ['SemiBold', 'Semi Bold', 'DemiBold', 'Demi Bold'],
  700: ['Bold'],
  800: ['ExtraBold', 'Extra Bold', 'UltraBold'],
  900: ['Black', 'Heavy'],
};

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** The nearest named weight, clamped to 100–900. */
const snapWeight = (weight: number): number => Math.min(900, Math.max(100, Math.round(weight / 100) * 100));

/**
 * Weights in CSS font-matching order (CSS Fonts 4 §5.2): for a target of 400–500 the
 * target, then 500, then lighter, then heavier; below 400 lighter first; above 500 heavier first.
 */
export function weightFallbackOrder(weight: number): number[] {
  const target = snapWeight(weight);
  const lighter = WEIGHTS.filter((w) => w < target).reverse();
  const heavier = WEIGHTS.filter((w) => w > target);
  if (target === 400) return [400, 500, ...lighter, ...heavier.filter((w) => w !== 500)];
  if (target === 500) return [500, ...lighter, ...heavier];
  return target < 400 ? [target, ...lighter, ...heavier] : [target, ...heavier, ...lighter];
}

/** Style names derived from a PostScript name: `Inter-SemiBoldItalic` → `Semi Bold Italic`, `SemiBold Italic`. */
export function postScriptStyles(postScriptName: string | undefined): string[] {
  if (postScriptName === undefined) return [];
  const dash = postScriptName.indexOf('-');
  if (dash < 0) return [];
  const raw = postScriptName.slice(dash + 1).replace(/[-_]/g, '');
  if (raw === '') return [];
  const spaced = raw.replace(/([a-z])([A-Z])/g, '$1 $2');
  const italic = /^(.+?)(Italic|Oblique)$/.exec(raw);
  const split = italic ? `${italic[1]} ${italic[2]}` : raw;
  return [spaced, raw, split];
}

function namesFor(weight: number, italic: boolean): string[] {
  const names = WEIGHT_NAMES[weight] ?? [];
  if (!italic) return [...names];
  return [
    ...names.map((name) => `${name} Italic`),
    ...(weight === 400 ? ['Italic'] : []),
    ...names.map((name) => `${name} Oblique`),
    ...(weight === 400 ? ['Oblique'] : []),
  ];
}

/** Ordered style candidates: PostScript-derived names, then the weight table in fallback order. */
export function styleCandidates(weight: number, italic: boolean, postScriptName?: string): string[] {
  const candidates = [
    ...postScriptStyles(postScriptName),
    ...weightFallbackOrder(weight).flatMap((w) => namesFor(w, italic)),
  ];
  return [...new Set(candidates)];
}

/** A metric-similar default family by generic class (07 §8.6 step 5). */
export function fallbackFamily(cssFamily: string): string {
  const families = cssFamily.toLowerCase();
  if (/\bmono(space)?\b|\bcode\b|courier|consolas|menlo/.test(families)) return 'Roboto Mono';
  if (/(^|[\s,"'])serif\b/.test(families.replace(/sans-serif/g, ''))) return 'Noto Serif';
  return 'Inter';
}

/** The first family of a CSS `font-family` list, unquoted. */
function firstCssFamily(cssFamily: string): string {
  const first =
    cssFamily
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? '';
  return first === '' ? 'Inter' : first;
}

/** The font request for a text style: the dominant platform font (most glyphs) and its candidates. */
export function fontRequest(style: CTextStyle): SceneFontRequest {
  // A stable sort keeps capture order among equal glyph counts.
  const [dominant] = [...style.used].sort((a, b) => b.glyphCount - a.glyphCount);
  const weight = Math.min(1000, Math.max(1, style.weight));
  const request: SceneFontRequest = {
    family: dominant?.family ?? firstCssFamily(style.cssFamily),
    weight,
    italic: style.italic,
    styleCandidates: styleCandidates(weight, style.italic, dominant?.postScriptName),
    fallbackFamily: fallbackFamily(style.cssFamily),
    isCustom: dominant?.isCustom ?? false,
  };
  if (dominant?.postScriptName) request.postScriptName = dominant.postScriptName;
  if (style.stretch !== 'normal' && style.stretch !== '100%') request.stretch = style.stretch;
  if (style.variation && Object.keys(style.variation).length > 0) request.variation = { ...style.variation };
  return request;
}
