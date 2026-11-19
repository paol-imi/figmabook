import type { Rect, SceneNode } from '@holotype/ir';
import { simulate } from './simulate';
import type { SimNode, SimResult, SimulateOptions } from './types';

export interface SceneSimOptions extends SimulateOptions {
  /**
   * First-baseline offsets by node key, for frames with `counterAxisAlignItems: BASELINE`.
   * Scene IR does not store baselines; the mapper passes them from the capture (07 §6.1).
   */
  readonly baselines?: ReadonlyMap<string, number>;
}

/**
 * Converts a Scene IR subtree to the simulator's input (06 §3.3 → 07 §6.1 `SimNode`):
 * `nk` → key, `child.*` → sizing, positioning and bounds, `strokes` → stroke box. A node
 * without `child` takes its sizing from its own layout (AUTO → HUG) or FIXED.
 */
export function toSimNode(node: SceneNode, options: Pick<SceneSimOptions, 'baselines'> = {}): SimNode {
  const { child } = node;
  const baseline = options.baselines?.get(node.nk);
  return {
    key: node.nk,
    size: node.size,
    visible: node.visible,
    ...(child === undefined
      ? {}
      : {
          positioning: child.positioning,
          sizingH: child.sizingH,
          sizingV: child.sizingV,
          ...(child.min === undefined ? {} : { min: child.min }),
          ...(child.max === undefined ? {} : { max: child.max }),
        }),
    ...(node.xy === undefined ? {} : { xy: node.xy }),
    ...(node.strokes === undefined ? {} : { stroke: { align: node.strokes.align, weight: node.strokes.weight } }),
    ...(node.relativeTransform === undefined ? {} : { transformed: true }),
    ...(baseline === undefined ? {} : { baseline }),
    ...(node.layout === undefined ? {} : { layout: node.layout }),
    ...(node.children === undefined ? {} : { children: node.children.map((c) => toSimNode(c, options)) }),
  };
}

/**
 * Simulates a Scene IR subtree: leaves keep their `size`, HUG frames are re-measured from
 * their children (07 §6.2 "bottom-up"). Rects are relative to `node`.
 */
export function simulateScene(node: SceneNode, options: SceneSimOptions = {}): SimResult {
  const { baselines, ...rest } = options;
  return simulate(toSimNode(node, baselines === undefined ? {} : { baselines }), rest);
}

/**
 * The browser-measured boxes of a container (06 §3.3 `fallback`) as rects relative to it:
 * the container itself at the origin, then its children. Undefined without a fallback.
 */
export function fallbackRects(node: SceneNode): ReadonlyMap<string, Rect> | undefined {
  const { fallback } = node;
  if (fallback === undefined) return undefined;
  const rects = new Map<string, Rect>([[node.nk, { x: 0, y: 0, w: fallback.size.w, h: fallback.size.h }]]);
  for (const key of Object.keys(fallback.children)) {
    const rect = fallback.children[key];
    if (rect !== undefined) rects.set(key, rect);
  }
  return rects;
}
