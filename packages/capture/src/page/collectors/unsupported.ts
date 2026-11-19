import type { Collector } from '../types';

/**
 * CSS this capture version does not record yet, with the value that means "not used". An
 * element that uses one gets `CAP_CSS_UNSUPPORTED` (BUILD §3.1 rule 6): the fact is left out,
 * never silently. Each entry goes away when its collector lands (item in the comment).
 */
const NOT_CAPTURED: readonly { readonly property: string; readonly unset: readonly string[] }[] = [
  { property: 'background-image', unset: ['none'] }, // B-42, B-101
  { property: 'box-shadow', unset: ['none'] }, // B-42
  { property: 'transform', unset: ['none'] }, // B-41, B-102
  { property: 'translate', unset: ['none'] }, // B-102
  { property: 'rotate', unset: ['none'] }, // B-102
  { property: 'scale', unset: ['none'] }, // B-102
];

/** Pseudo-elements that render boxes (05 §5.5, B-103). */
const PSEUDO_ELEMENTS = ['::before', '::after'] as const;

/** Reports CSS facts this version leaves out, and pseudo-elements it does not measure yet. */
export const unsupported: Collector = {
  name: 'unsupported',
  element({ element, style }, draft, context) {
    for (const { property, unset } of NOT_CAPTURED) {
      const value = style.getPropertyValue(property);
      if (value === '' || unset.includes(value)) continue;
      context.report({ code: 'CAP_CSS_UNSUPPORTED', nodeId: draft.id, property, value, fallback: 'left out' });
    }
    for (const pseudo of PSEUDO_ELEMENTS) {
      const pseudoStyle = getComputedStyle(element, pseudo);
      const { content, display } = pseudoStyle;
      if (content === 'none' || content === 'normal' || content === '' || display === 'none') continue;
      context.report({ code: 'CAP_PSEUDO_UNMEASURED', nodeId: draft.id, value: pseudo, data: { content } });
    }
  },
};
