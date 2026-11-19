import type { NodeState } from './state';

/** Axis-aligned bounds of a node on its page, without strokes or effects (typings:7387-7390). */
export function boundingBox(state: NodeState): Rect {
  const [[a, b, tx], [c, d, ty]] = state.absoluteTransform();
  const xs = [0, state.width].flatMap((w) => [0, state.height].map((h) => a * w + b * h + tx));
  const ys = [0, state.width].flatMap((w) => [0, state.height].map((h) => c * w + d * h + ty));
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How far a visible stroke reaches outside the box on each side: OUTSIDE all of it, CENTER half. */
function strokeOutset(state: NodeState): Box {
  const visible = state.strokes.some((paint) => paint.visible !== false);
  const share = state.strokeAlign === 'OUTSIDE' ? 1 : state.strokeAlign === 'CENTER' ? 0.5 : 0;
  if (!visible || share === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return {
    x0: state.strokeLeftWeight * share,
    y0: state.strokeTopWeight * share,
    x1: state.strokeRightWeight * share,
    y1: state.strokeBottomWeight * share,
  };
}

function union(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function renderBox(state: NodeState): Box | null {
  if (!state.visible) return null;
  const rect = boundingBox(state);
  const outset = strokeOutset(state);
  let box: Box = {
    x0: rect.x - outset.x0,
    y0: rect.y - outset.y0,
    x1: rect.x + rect.width + outset.x1,
    y1: rect.y + rect.height + outset.y1,
  };
  const base = { ...box };
  for (const effect of state.effects) {
    if (!effect.visible) continue;
    if (effect.type === 'DROP_SHADOW') {
      const grow = effect.radius + (effect.spread ?? 0);
      box = union(box, {
        x0: base.x0 + effect.offset.x - grow,
        y0: base.y0 + effect.offset.y - grow,
        x1: base.x1 + effect.offset.x + grow,
        y1: base.y1 + effect.offset.y + grow,
      });
    } else if (effect.type === 'LAYER_BLUR') {
      box = union(box, {
        x0: base.x0 - effect.radius,
        y0: base.y0 - effect.radius,
        x1: base.x1 + effect.radius,
        y1: base.y1 + effect.radius,
      });
    }
  }
  const clips = state.isFrameLike && state.clipsContent;
  if (!clips) {
    for (const child of state.children) {
      const inner = renderBox(child);
      if (inner) box = union(box, inner);
    }
  }
  return box;
}

/**
 * `absoluteRenderBounds` (typings:7398-7400): "The actual bounds of a node accounting for drop
 * shadows, thick strokes, and anything else that may fall outside the node's regular bounding
 * box … This value will be `null` if the node is invisible." Approximated: strokes by alignment
 * and weight, drop shadows by offset, blur and spread, layer blur by radius, and the children of
 * nodes that do not clip. Glyph outlines are not modelled: text uses its box.
 */
export function renderBounds(state: NodeState): Rect | null {
  const box = renderBox(state);
  return box ? { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 } : null;
}
