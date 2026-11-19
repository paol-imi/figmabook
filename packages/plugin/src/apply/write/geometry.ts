import { atLeastMin, type NodeWriter } from './types';

/**
 * Step 4, size. The applier writes absolute layout only, so no parent is auto layout and
 * `resizeWithoutConstraints` avoids scaling children by their constraints (09 §6). An
 * imported SVG wrapper is the exception: its vectors follow the wrapper (`resize`). Text is
 * sized last, by the text writer (09 §6.1).
 */
export const sizeWriter: NodeWriter = {
  name: 'size',
  step: 4,
  write({ node, scene, box }) {
    if (node.type === 'TEXT' || !('resizeWithoutConstraints' in node)) return;
    const width = atLeastMin(box.w);
    const height = atLeastMin(box.h);
    if (scene.kind === 'svg' && node.type === 'FRAME') node.resize(width, height);
    else node.resizeWithoutConstraints(width, height);
  },
};

/**
 * Step 5, position: `x`/`y` in the parent, then `relativeTransform` when the node is rotated,
 * skewed or scaled (it overrides `x`/`y`), then constraints.
 */
export const positionWriter: NodeWriter = {
  name: 'position',
  step: 5,
  write({ node, scene, box }) {
    node.x = box.x;
    node.y = box.y;
    if (scene.relativeTransform) {
      const [[a, b, c], [d, e, f]] = scene.relativeTransform;
      node.relativeTransform = [
        [a, b, c],
        [d, e, f],
      ];
    }
    const constraints = scene.child?.constraints;
    if (constraints && 'constraints' in node) {
      node.constraints = { horizontal: constraints.horizontal, vertical: constraints.vertical };
    }
  },
};
