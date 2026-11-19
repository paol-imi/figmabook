import type { CTextStyle } from '@holotype/ir';
import { px } from '../css';

export interface UsedLineHeight {
  readonly px: number;
  readonly source: CTextStyle['lineHeightSource'];
}

/** The font properties `line-height: normal` depends on. */
const FONT_PROPERTIES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variation-settings',
  'font-optical-sizing',
] as const;

/**
 * The used line height (D-17: always explicit px). A px value is taken as is. For
 * `line-height: normal` a one-line probe with the same font is measured off screen (05 §4.2);
 * `1.2 × size` is never assumed, because it is wrong for Inter, Roboto and others.
 * `cache` holds probe results by font for one serialize call.
 */
export function usedLineHeight(style: CSSStyleDeclaration, doc: Document, cache: Map<string, number>): UsedLineHeight {
  if (style.lineHeight !== 'normal') return { px: px(style.lineHeight), source: 'explicit' };
  const declarations = FONT_PROPERTIES.map((property) => `${property}:${style.getPropertyValue(property)}`);
  const key = declarations.join(';');
  let measured = cache.get(key);
  if (measured === undefined) {
    const probe = doc.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = `${key};line-height:normal;position:absolute;left:-10000px;top:0;visibility:hidden;white-space:nowrap;margin:0;padding:0;border:0`;
    probe.textContent = 'x';
    (doc.body ?? doc.documentElement).appendChild(probe);
    measured = probe.getBoundingClientRect().height;
    probe.remove();
    cache.set(key, measured);
  }
  return { px: measured, source: 'normal-probed' };
}
