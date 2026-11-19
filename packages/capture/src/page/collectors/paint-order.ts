import type { CPaintOrder } from '@holotype/ir';
import type { Collector } from '../types';

/** `will-change` values that create a stacking context. */
const STACKING_WILL_CHANGE =
  /\b(?:opacity|transform|translate|rotate|scale|filter|backdrop-filter|isolation|mix-blend-mode|clip-path|mask|z-index|position)\b/;

const isFlexOrGrid = (display: string | undefined): boolean => display !== undefined && /flex|grid/.test(display);

/** `z-index` as an integer, or `auto`. */
export function parseZIndex(value: string): number | 'auto' {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : 'auto';
}

/**
 * Whether the element creates a stacking context (05 §8). `zIndex` only counts where it
 * applies: on positioned boxes and on flex or grid items.
 */
export function createsStackingContext(style: CSSStyleDeclaration, parentDisplay: string | undefined): boolean {
  const zIndex = parseZIndex(style.zIndex);
  const positioned = style.position !== 'static';
  if (style.position === 'fixed' || style.position === 'sticky') return true;
  if (zIndex !== 'auto' && (positioned || isFlexOrGrid(parentDisplay))) return true;
  if (Number(style.opacity) < 1) return true;
  if ([style.transform, style.translate, style.rotate, style.scale].some((value) => value !== 'none' && value !== ''))
    return true;
  if (style.filter !== 'none' || style.backdropFilter !== 'none') return true;
  if (style.clipPath !== 'none' || (style.maskImage !== 'none' && style.maskImage !== '')) return true;
  if (style.isolation === 'isolate' || style.mixBlendMode !== 'normal') return true;
  if (/\b(?:paint|layout|strict|content)\b/.test(style.contain)) return true;
  return STACKING_WILL_CHANGE.test(style.willChange);
}

/** The CSS 2.1 Appendix E bucket of a box within its stacking context (05 §8). */
export function paintLayer(style: CSSStyleDeclaration, parentDisplay: string | undefined): CPaintOrder['layer'] {
  const zIndex = parseZIndex(style.zIndex);
  const positioned = style.position !== 'static';
  const zApplies = positioned || isFlexOrGrid(parentDisplay);
  if (zApplies && zIndex !== 'auto' && zIndex < 0) return 'negative';
  if (zApplies && zIndex !== 'auto' && zIndex > 0) return 'positive';
  if (positioned) return 'positioned';
  if (style.float !== 'none') return 'float';
  if (style.display.startsWith('inline')) return 'inline';
  return 'block';
}

/**
 * Stacking facts (05 §8, `CPaintOrder`). `domIndex` is the walk order for now; `order` on
 * flex and grid items is applied with the rest of the paint-order work (B-41).
 */
export const paintOrder: Collector = {
  name: 'paint-order',
  element({ style, parentStyle, index }, draft) {
    const parentDisplay = parentStyle?.display;
    draft.paint = {
      stackingContext: createsStackingContext(style, parentDisplay),
      zIndex: parseZIndex(style.zIndex),
      layer: paintLayer(style, parentDisplay),
      domIndex: index,
    };
  },
  text({ index }, draft) {
    draft.paint = { stackingContext: false, zIndex: 'auto', layer: 'inline', domIndex: index };
  },
};
