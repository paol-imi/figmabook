/*
 * The slice's read-back: the largest box difference between what Figma reports and the
 * Scene IR's `expect` (relative to the variant root, D-15), for `ApplyReport.readback`.
 * Text boxes depend on Figma's own text metrics and are checked by the line-count rule of
 * B-55 instead, so they are left out here. Verification with relax and fallback is B-56.
 */
import { normalizeNumber } from '@holotype/ir/core';
import type { WrittenNode } from '../write/node';

export function readbackDelta(root: SceneNode, written: Iterable<WrittenNode>): number {
  const origin = root.absoluteBoundingBox;
  if (origin === null) return 0;
  let max = 0;
  for (const { node, scene } of written) {
    if (node.type === 'TEXT' || node.removed) continue;
    const box = node.absoluteBoundingBox;
    if (box === null) continue;
    const { expect } = scene;
    max = Math.max(
      max,
      Math.abs(box.x - origin.x - expect.x),
      Math.abs(box.y - origin.y - expect.y),
      Math.abs(box.width - expect.w),
      Math.abs(box.height - expect.h),
    );
  }
  return normalizeNumber(max);
}
