import type { CTextStyle } from '@holotype/ir';
import { px } from '../css';
import { readColor } from '../read-color';
import type { CollectContext } from '../types';
import type { UsedLineHeight } from './line-height';

const TRANSFORMS: ReadonlySet<string> = new Set(['none', 'uppercase', 'lowercase', 'capitalize']);

/** Text CSS this version does not record yet (B-43), with the values that mean "not used". */
const NOT_CAPTURED: readonly { readonly property: string; readonly unset: readonly string[] }[] = [
  { property: 'text-shadow', unset: ['none'] },
  { property: 'font-feature-settings', unset: ['normal'] },
  { property: 'font-variation-settings', unset: ['normal'] },
  { property: '-webkit-text-stroke-width', unset: ['0px'] },
];

/**
 * The text style of a run (06 §2.2 `CTextStyle`) from its element's computed style: family
 * list, weight, italic, stretch, size, line height, spacing, case and color. `used` (the
 * platform fonts, CDP) and decorations come with B-43; until then `used` is empty and set
 * decorations, shadows and font features are reported.
 */
export function textStyleOf(
  style: CSSStyleDeclaration,
  lineHeight: UsedLineHeight,
  context: CollectContext,
  nodeId: string,
): CTextStyle {
  for (const { property, unset } of NOT_CAPTURED) {
    const value = style.getPropertyValue(property);
    if (value !== '' && !unset.includes(value)) {
      context.report({ code: 'CAP_CSS_UNSUPPORTED', nodeId, property, value, fallback: 'left out' });
    }
  }
  const transform = TRANSFORMS.has(style.textTransform) ? (style.textTransform as CTextStyle['transform']) : 'none';
  if (transform !== style.textTransform) {
    context.report({
      code: 'CAP_CSS_UNSUPPORTED',
      nodeId,
      property: 'text-transform',
      value: style.textTransform,
      fallback: 'none',
    });
  }
  const weight = Number(style.fontWeight);
  return {
    cssFamily: style.fontFamily,
    used: [],
    weight: Number.isFinite(weight) ? weight : 400,
    italic: style.fontStyle !== 'normal',
    stretch: style.fontStretch,
    size: px(style.fontSize),
    lineHeightPx: lineHeight.px,
    lineHeightSource: lineHeight.source,
    letterSpacingPx: px(style.letterSpacing),
    wordSpacingPx: px(style.wordSpacing),
    transform,
    smallCaps: style.fontVariantCaps === 'small-caps' || style.fontVariantCaps === 'all-small-caps',
    color: readColor(context, nodeId, 'color', style.color),
  };
}
