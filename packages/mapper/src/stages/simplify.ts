import type { CaptureDoc, CNode } from '@holotype/ir';
import { isTransformed } from '../css';
import { type WorkNode, walkWork } from '../state';
import { fitText, placesLines } from '../text/fit';
import type { VariantStage } from './types';

/*
 * Stage 8, tree simplification (07 §11), bottom-up after layout and visuals. This version
 * applies rule 3, the text-only element: capture emits a text block inside an element as
 * the element plus a `#text` child, and an element that only holds its text, draws nothing
 * and has no padding or border is replaced by the TEXT layer, which takes the element's
 * box, key, name and `child` props. Alignment anchors (test id, `data-holotype-name|key`,
 * a component boundary) are never collapsed. The other rules are hardening (B-114).
 */

interface SimplifyContext {
  /** Capture ids of framework component roots (alignment anchors). */
  readonly boundaries: ReadonlySet<string>;
  /** Layers a hoisted box came from: their key path must survive (07 §7.3). */
  readonly hoistOrigins: ReadonlySet<WorkNode>;
}

const isAnchor = (node: CNode, context: SimplifyContext): boolean =>
  node.source.testId !== undefined ||
  node.source.figmaName !== undefined ||
  node.source.figmaKey !== undefined ||
  context.boundaries.has(node.id);

/** Whether the element's own layer would draw or do anything in Figma. */
function hasVisuals(node: WorkNode): boolean {
  const { fields } = node;
  return (
    (fields.fills ?? []).length > 0 ||
    fields.strokes !== undefined ||
    (fields.effects ?? []).length > 0 ||
    fields.opacity !== undefined ||
    fields.blendMode !== undefined ||
    fields.clipsContent === true
  );
}

/** The TEXT layer that can take `wrapper`'s place, or `undefined`. */
export function collapsibleText(wrapper: WorkNode, context: SimplifyContext): WorkNode | undefined {
  const [text, ...others] = wrapper.children;
  if (wrapper.kind !== 'frame' || text === undefined || others.length > 0 || text.kind !== 'text') return undefined;
  if (wrapper.synthetic !== undefined || text.synthetic !== undefined || text.hoistedFrom !== undefined)
    return undefined;
  if (context.hoistOrigins.has(wrapper) || wrapper.hoistedFrom !== undefined) return undefined;
  const { capture } = wrapper;
  const { computed } = capture;
  if (computed === undefined || capture.replaced !== undefined || isAnchor(capture, context)) return undefined;
  if (!wrapper.visible || wrapper.paintHidden || hasVisuals(wrapper) || wrapper.diagnostics.length > 0)
    return undefined;
  if (isTransformed(capture.transform)) return undefined;
  if (computed.padding.some((side) => side !== 0) || computed.border.width.some((side) => side !== 0)) return undefined;
  const lines = text.capture.text;
  return lines !== undefined && text.fields.text !== undefined && placesLines(lines, wrapper.box) ? text : undefined;
}

/** Replaces `wrapper` with its text layer, which takes over its box and identity. */
function collapse(wrapper: WorkNode, text: WorkNode): WorkNode {
  const lines = text.capture.text;
  const scene = text.fields.text;
  text.wrapper = wrapper.capture;
  text.box = wrapper.box;
  if (lines !== undefined && scene !== undefined) {
    const { autoResize: _autoResize, truncation: _truncation, alignV: _alignV, ...rest } = scene;
    text.fields.text = { ...rest, ...fitText(lines, wrapper.box) };
  }
  if (wrapper.fields.child !== undefined) text.fields.child = wrapper.fields.child;
  return text;
}

function simplify(node: WorkNode, context: SimplifyContext): void {
  node.children = node.children.map((child) => {
    simplify(child, context);
    const text = collapsibleText(child, context);
    return text === undefined ? child : collapse(child, text);
  });
}

function boundaryIds(capture: CaptureDoc): Set<string> {
  return new Set((capture.framework?.boundaries ?? []).flatMap((boundary) => boundary.nodeIds));
}

export const simplifyStage: VariantStage = {
  step: 8,
  name: 'simplify',
  per: 'variant',
  run(variant) {
    const hoistOrigins = new Set<WorkNode>();
    for (const node of walkWork(variant.root)) if (node.hoistedFrom) hoistOrigins.add(node.hoistedFrom.parent);
    simplify(variant.root, { boundaries: boundaryIds(variant.capture), hoistOrigins });
  },
};
