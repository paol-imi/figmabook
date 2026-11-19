/*
 * Step 8, visuals (09 §6): new paint and effect arrays every time, stroke geometry, corner
 * radii, then compositing. Managed nodes always get explicit values (06 §5 "Defaults"), with
 * two exceptions where the content carries its own paint: a TEXT node's fills are per range
 * (step 7), and an imported SVG keeps the paints of its vectors unless the scene sets some.
 */
import type { SceneNode as IrNode, SceneStroke } from '@holotype/ir';
import { toEffects, toPaints } from '../paints';
import type { NodeWriter } from './types';

/** Whether the node's own content provides its paints when the scene leaves them out. */
const contentPainted = (node: SceneNode, scene: IrNode): boolean => node.type === 'TEXT' || scene.kind === 'svg';

export const paintWriter: NodeWriter = {
  name: 'paint',
  step: 8,
  write({ node, scene }, { resources }) {
    if (!('fills' in node) || !('strokes' in node)) return;
    if (scene.fills !== undefined || !contentPainted(node, scene)) {
      node.fills = toPaints(scene.fills ?? [], resources.imageHash);
    }
    if (scene.strokes !== undefined || !contentPainted(node, scene)) {
      node.strokes = toPaints(scene.strokes?.paints ?? [], resources.imageHash);
    }
    if (scene.strokes) writeStrokeGeometry(node, scene.strokes);
  },
};

function writeStrokeGeometry(node: SceneNode & MinimalStrokesMixin, stroke: SceneStroke): void {
  node.strokeAlign = stroke.align;
  const { t, r, b, l } = stroke.weight;
  if (t === r && r === b && b === l) {
    node.strokeWeight = t;
  } else if ('strokeTopWeight' in node) {
    node.strokeTopWeight = t;
    node.strokeRightWeight = r;
    node.strokeBottomWeight = b;
    node.strokeLeftWeight = l;
  } else {
    node.strokeWeight = Math.max(t, r, b, l);
  }
  if (stroke.dashPattern) node.dashPattern = [...stroke.dashPattern];
  if (stroke.cap && 'strokeCap' in node) node.strokeCap = stroke.cap;
  if (stroke.join) node.strokeJoin = stroke.join;
}

/**
 * Corner radii on the nodes that have per-corner radii (frames, rectangles); `cornerSmoothing`
 * stays 0. Other kinds (text, vectors, ellipses) have no per-corner radius to write.
 */
export const cornerWriter: NodeWriter = {
  name: 'corners',
  step: 8,
  write({ node, scene }) {
    if (!('topLeftRadius' in node)) return;
    const radius = scene.radius ?? { tl: 0, tr: 0, br: 0, bl: 0 };
    node.topLeftRadius = radius.tl;
    node.topRightRadius = radius.tr;
    node.bottomRightRadius = radius.br;
    node.bottomLeftRadius = radius.bl;
  },
};

export const effectWriter: NodeWriter = {
  name: 'effects',
  step: 8,
  write({ node, scene }) {
    if ('effects' in node) node.effects = toEffects(scene.effects ?? []);
  },
};

/** Opacity, blend mode, visibility, clipping and masks. Defaults per 06 §3.3. */
export const compositingWriter: NodeWriter = {
  name: 'compositing',
  step: 8,
  write({ node, scene }) {
    if ('opacity' in node) {
      node.opacity = scene.opacity ?? 1;
      node.blendMode = scene.blendMode ?? (node.type === 'FRAME' ? 'PASS_THROUGH' : 'NORMAL');
    }
    node.visible = scene.visible;
    if (node.type === 'FRAME') node.clipsContent = scene.clipsContent ?? false;
    if (scene.isMask && 'isMask' in node) {
      node.isMask = true;
      node.maskType = scene.maskType ?? 'ALPHA';
    }
  },
};
