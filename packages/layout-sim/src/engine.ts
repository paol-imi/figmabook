import type { Rect, Size } from '@holotype/ir';
import type { AssumptionLog } from './assumptions';
import {
  type Axis,
  crossAxis,
  inFlow,
  insetStart,
  insetSum,
  insetsOf,
  isAutoGap,
  isStack,
  length,
  primaryAxis,
  sizeFrom,
  sizingOf,
} from './axis';
import { crossOffset, primaryOffsets } from './distribute';
import { type FillBounds, shareFill } from './fill';
import type { SimNode, StackSpec } from './types';

/**
 * The two passes of a simulation over a validated tree (07 §6.2: bottom-up sizes, so a HUG
 * child uses its simulated size, not its measured one):
 *
 * 1. `naturalSize`, bottom-up and memoized: the size a node takes on its own — HUG axes from
 *    the content, FIXED and FILL axes from `size`, all clamped.
 * 2. `place`, top-down: each stack resolves its children's final sizes (FILL) and positions,
 *    then each child is placed inside its final box.
 *
 * Without wrap or text reflow, a node's natural size does not depend on its parent, so each
 * node is measured once and the whole run is linear in the tree size.
 */
export class Engine {
  private readonly natural = new Map<SimNode, Size>();

  constructor(private readonly log: AssumptionLog) {}

  naturalSize(node: SimNode): Size {
    const cached = this.natural.get(node);
    if (cached !== undefined) return cached;
    const size = isStack(node.layout) ? this.hugSize(node, node.layout) : node.size;
    const fitted = { w: this.fit(node, 'h', size.w), h: this.fit(node, 'v', size.h) };
    this.natural.set(node, fitted);
    return fitted;
  }

  /** Clamps `value` to the node's min/max, then raises it to the padding floor. */
  fit(node: SimNode, axis: Axis, value: number): number {
    const { lo, hi, floor } = this.boundsOf(node, axis);
    let fitted = value;
    if (lo !== undefined && fitted < lo) fitted = lo;
    if (hi !== undefined && fitted > hi) fitted = hi;
    if (fitted < floor) {
      if (hi !== undefined && hi < floor) this.log.use('min-max-before-floor');
      fitted = floor;
    }
    return fitted;
  }

  /** Places `node` with its final `size` at (`x`, `y`) of the root, then its visible subtree. */
  place(node: SimNode, size: Size, x: number, y: number, out: Map<string, Rect>): void {
    out.set(node.key, { x, y, w: size.w, h: size.h });
    const boxes = isStack(node.layout) ? this.layoutStack(node, node.layout, size) : this.layoutFree(node);
    for (const [child, box] of boxes) this.place(child, { w: box.w, h: box.h }, x + box.x, y + box.y, out);
  }

  private boundsOf(node: SimNode, axis: Axis): { lo?: number; hi?: number; floor: number } {
    const dim = axis === 'h' ? 'w' : 'h';
    const floor = isStack(node.layout) ? insetSum(insetsOf(node, node.layout, this.log), axis) : 0;
    const lo = node.min?.[dim];
    const hi = node.max?.[dim];
    return { floor, ...(lo === undefined ? {} : { lo }), ...(hi === undefined ? {} : { hi }) };
  }

  /** The node's size with its HUG axes computed from the content (07 §4.3). */
  private hugSize(node: SimNode, spec: StackSpec): Size {
    const main = primaryAxis(spec);
    const cross = crossAxis(main);
    const insets = insetsOf(node, spec, this.log);
    const flow = (node.children ?? []).filter(inFlow);
    const sizes = flow.map((child) => this.naturalSize(child));

    const content = (axis: Axis): number => {
      if (axis === main) {
        const total = sizes.reduce((sum, size) => sum + length(size, main), 0);
        if (isAutoGap(spec)) {
          if (flow.length > 1) this.log.use('auto-gap-hug');
          return total;
        }
        return total + spec.itemSpacing * Math.max(0, flow.length - 1);
      }
      if (spec.counterAxisAlignItems === 'BASELINE') return this.baselineExtent(flow, sizes);
      return sizes.reduce((max, size) => Math.max(max, length(size, cross)), 0);
    };

    const axisSize = (axis: Axis): number =>
      sizingOf(node, axis) === 'HUG' ? content(axis) + insetSum(insets, axis) : length(node.size, axis);
    return { w: axisSize('h'), h: axisSize('v') };
  }

  /** Child boxes of a stack frame of final size `size`, relative to the frame. */
  private layoutStack(node: SimNode, spec: StackSpec, size: Size): Map<SimNode, Rect> {
    const main = primaryAxis(spec);
    const cross = crossAxis(main);
    const insets = insetsOf(node, spec, this.log);
    const innerMain = length(size, main) - insetSum(insets, main);
    const innerCross = length(size, cross) - insetSum(insets, cross);
    const flow = (node.children ?? []).filter(inFlow);
    const natural = flow.map((child) => this.naturalSize(child));

    const mainSizes = this.mainSizes(spec, flow, natural, innerMain);
    const crossSizes = flow.map((child, index) =>
      sizingOf(child, cross) === 'FILL' ? this.fit(child, cross, innerCross) : length(natural[index] as Size, cross),
    );
    const mainOffsets = primaryOffsets(spec, insetStart(insets, main), innerMain, mainSizes, this.log);
    const crossOffsets =
      spec.counterAxisAlignItems === 'BASELINE'
        ? this.baselineOffsets(flow, crossSizes, insetStart(insets, cross))
        : crossSizes.map((crossSize) =>
            crossOffset(
              spec.counterAxisAlignItems as 'MIN' | 'CENTER' | 'MAX',
              insetStart(insets, cross),
              innerCross,
              crossSize,
              this.log,
            ),
          );

    const flowBoxes = new Map<SimNode, Rect>();
    flow.forEach((child, index) => {
      const position = sizeFrom(main, mainOffsets[index] as number, crossOffsets[index] as number);
      const box = sizeFrom(main, mainSizes[index] as number, crossSizes[index] as number);
      flowBoxes.set(child, { x: position.w, y: position.h, w: box.w, h: box.h });
    });

    // Keep the children's layer order; ABSOLUTE children sit at their own xy (07 §4.6).
    const boxes = new Map<SimNode, Rect>();
    for (const child of node.children ?? []) {
      if (child.visible === false) continue;
      boxes.set(child, flowBoxes.get(child) ?? this.freeBox(child));
    }
    return boxes;
  }

  /** Final primary sizes of the in-flow children: FILL children share the free space. */
  private mainSizes(spec: StackSpec, flow: readonly SimNode[], natural: readonly Size[], inner: number): number[] {
    const main = primaryAxis(spec);
    const sizes = natural.map((size) => length(size, main));
    const fills: number[] = [];
    flow.forEach((child, index) => {
      if (sizingOf(child, main) === 'FILL') fills.push(index);
    });
    if (fills.length === 0) return sizes;

    const filling = new Set(fills);
    const fixed = sizes.reduce((sum, size, index) => (filling.has(index) ? sum : sum + size), 0);
    const gaps = isAutoGap(spec) ? 0 : spec.itemSpacing * (flow.length - 1);
    const bounds = fills.map((index): FillBounds => {
      const { lo, hi, floor } = this.boundsOf(flow[index] as SimNode, main);
      const low = Math.max(floor, lo ?? 0);
      return { lo: low, hi: Math.max(low, hi ?? Number.POSITIVE_INFINITY) };
    });
    const share = shareFill(inner - fixed - gaps, bounds);
    if (fills.length > 1) this.log.use('fill-equal-share');
    if (share.clamped) this.log.use('fill-min-max');
    if (share.starved) this.log.use('fill-no-space');
    fills.forEach((index, position) => {
      sizes[index] = share.sizes[position] as number;
    });
    return sizes;
  }

  /** Child boxes of a frame without auto layout: every visible child at its own xy. */
  private layoutFree(node: SimNode): Map<SimNode, Rect> {
    const boxes = new Map<SimNode, Rect>();
    for (const child of node.children ?? []) {
      if (child.visible !== false) boxes.set(child, this.freeBox(child));
    }
    return boxes;
  }

  private freeBox(child: SimNode): Rect {
    const size = this.naturalSize(child);
    const xy = child.xy ?? { x: 0, y: 0 };
    return { x: xy.x, y: xy.y, w: size.w, h: size.h };
  }

  /** First-baseline offset of a child (assumptions `baseline-*`, spike S-04). */
  private baselineOf(child: SimNode, height: number): number {
    if (child.baseline !== undefined) return child.baseline;
    this.log.use('baseline-synthesized');
    return height;
  }

  /** HUG height of a BASELINE row: the deepest baseline plus the deepest descent. */
  private baselineExtent(flow: readonly SimNode[], sizes: readonly Size[]): number {
    this.log.use('baseline-alignment');
    let ascent = 0;
    let descent = 0;
    flow.forEach((child, index) => {
      const height = (sizes[index] as Size).h;
      const baseline = this.baselineOf(child, height);
      ascent = Math.max(ascent, baseline);
      descent = Math.max(descent, height - baseline);
    });
    return flow.length === 0 ? 0 : ascent + descent;
  }

  /** Vertical offsets of a BASELINE row: baselines line up, the deepest one at the top inset. */
  private baselineOffsets(flow: readonly SimNode[], heights: readonly number[], top: number): number[] {
    this.log.use('baseline-alignment');
    const baselines = flow.map((child, index) =>
      sizingOf(child, 'v') === 'FILL' ? undefined : this.baselineOf(child, heights[index] as number),
    );
    const deepest = baselines.reduce<number>((max, baseline) => Math.max(max, baseline ?? 0), 0);
    return baselines.map((baseline) => {
      if (baseline !== undefined) return top + deepest - baseline;
      this.log.use('baseline-fill');
      return top;
    });
  }
}
