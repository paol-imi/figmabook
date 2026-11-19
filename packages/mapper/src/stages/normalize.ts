import { hasOwnPaint } from '../css';
import { hasArea } from '../geometry';
import { liftNode, type WorkNode } from '../state';
import type { VariantStage } from './types';

/*
 * Stage 1, tree normalization (07 §2). Rules run top-down. Nothing dropped here is visible:
 * the rules remove skipped content, empty paint-less wrappers and invisible boxes.
 */

interface NormalizeOptions {
  readonly keepInvisible: boolean;
}

const HIDDEN_VISIBILITY = new Set(['hidden', 'collapse']);

/** Whether a replaced element still shows its content (an image, an SVG, a control). */
const hasReplacedContent = (node: WorkNode): boolean => node.capture.replaced !== undefined && !node.paintHidden;

/** Normalizes one node; returns what replaces it in its parent's child list (none, itself, or its children). */
function normalizeNode(node: WorkNode, options: NormalizeOptions, parentHidden: boolean): WorkNode[] {
  const { capture } = node;
  if (capture.source.srOnly) return [];
  const display = capture.computed?.display;
  if (display === 'none') return [];

  if (capture.type === 'text') {
    const characters = capture.text?.characters ?? '';
    if (parentHidden || capture.text === undefined || characters.trim() === '' || !hasArea(capture.borderBox))
      return [];
    return [node];
  }

  const hidden = capture.computed ? HIDDEN_VISIBILITY.has(capture.computed.visibility) : parentHidden;
  const children = node.children.flatMap((child) => normalizeNode(child, options, hidden));
  // `display: contents` boxes generate no box of their own: their children take their place.
  if (display === 'contents') return children;

  node.children = children;
  node.paintHidden = hidden;
  if (capture.computed?.opacity === 0) {
    if (!options.keepInvisible) return [];
    node.visible = false;
  }
  const paints = !hidden && hasOwnPaint(capture);
  if (children.length === 0 && !paints && !hasReplacedContent(node)) return [];
  return [node];
}

export const normalizeStage: VariantStage = {
  step: 1,
  name: 'normalize',
  per: 'variant',
  run(variant, component) {
    const options = { keepInvisible: component.input.config.mapper.keepInvisible };
    const { root, capture } = variant;
    const rootHidden = capture.root.computed ? HIDDEN_VISIBILITY.has(capture.root.computed.visibility) : false;
    root.children = [
      ...root.children.flatMap((child) => normalizeNode(child, options, rootHidden)),
      // Body-level overlays captured with the story paint above it (03 §portals).
      ...capture.portals.flatMap((portal) => normalizeNode(liftNode(portal), options, false)),
    ];
    root.paintHidden = rootHidden;
    if (capture.root.computed?.opacity === 0) root.visible = false;
  },
};
