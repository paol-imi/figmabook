import { parseCssColor } from '../color';
import { px, sides } from '../css';
import { extractText } from '../text/extract';
import type { CollectContext, Collector, StyledElement } from '../types';

/**
 * Inline boxes that paint (`<mark>`, `<code>` with a background, bordered links) need overlay
 * facts (05 §4.1, `inlineDecorations`), which come with B-43. Their text is captured; their
 * paint is reported.
 */
function reportInlinePaint({ element, style }: StyledElement, context: CollectContext, nodeId: string): void {
  const data = { inline: element.localName };
  const background = parseCssColor(style.backgroundColor);
  if (background === null || background.a > 0) {
    context.report({
      code: 'CAP_CSS_UNSUPPORTED',
      nodeId,
      property: 'background-color',
      value: style.backgroundColor,
      fallback: 'left out',
      data,
    });
  }
  const bordered = sides(
    (side) =>
      style.getPropertyValue(`border-${side}-style`) !== 'none' &&
      px(style.getPropertyValue(`border-${side}-width`)) > 0,
  ).some(Boolean);
  if (bordered) {
    context.report({
      code: 'CAP_CSS_UNSUPPORTED',
      nodeId,
      property: 'border',
      value: style.border,
      fallback: 'left out',
      data,
    });
  }
  if (style.boxShadow !== 'none') {
    context.report({
      code: 'CAP_CSS_UNSUPPORTED',
      nodeId,
      property: 'box-shadow',
      value: style.boxShadow,
      fallback: 'left out',
      data,
    });
  }
}

/**
 * `text-decoration` propagates from the block and its inline ancestors to the text (CSS Text
 * Decoration §2.1). Decorations come with B-43; any set on the way is reported once.
 */
function reportDecoration(styles: readonly StyledElement[], context: CollectContext, nodeId: string): void {
  const decorated = styles.find(({ style }) => {
    const line = style.getPropertyValue('text-decoration-line');
    return line !== '' && line !== 'none';
  });
  if (decorated === undefined) return;
  context.report({
    code: 'CAP_CSS_UNSUPPORTED',
    nodeId,
    property: 'text-decoration',
    value: decorated.style.getPropertyValue('text-decoration'),
    fallback: 'left out',
    data: { element: decorated.element.localName },
  });
}

/** The block container and its ancestors up to the capture root, nearest first. */
function blockAncestors(container: Element, root: Element): StyledElement[] {
  const chain: StyledElement[] = [];
  for (let element: Element | null = container; element !== null; element = element.parentElement) {
    chain.push({ element, style: getComputedStyle(element) });
    if (element === root) break;
  }
  return chain;
}

/**
 * Text runs and line boxes (05 §4): one text node per text block, with `characters`, styled
 * runs (family, size, weight, line height, color) and the browser's lines.
 */
export const text: Collector = {
  name: 'text',
  text({ block }, draft, context) {
    const extracted = extractText(block, context, draft.id);
    if (extracted === null) return;
    draft.text = extracted.text;
    draft.borderBox = extracted.borderBox;
    for (const inline of block.inlines) reportInlinePaint(inline, context, draft.id);
    reportDecoration([...block.inlines, ...blockAncestors(block.container, context.root)], context, draft.id);
  },
};
