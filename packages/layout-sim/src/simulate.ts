import type { Rect, Size } from '@holotype/ir';
import { err, ok } from '@holotype/shared';
import { AssumptionLog } from './assumptions';
import { type Axis, sizingOf } from './axis';
import { Engine } from './engine';
import { issue } from './issues';
import type {
  SceneGridLayout,
  SimNode,
  SimResult,
  SimulateOptions,
  Simulation,
  SizeBounds,
  StackSpec,
  StrokeBox,
} from './types';
import { validateTree } from './validate';

/**
 * Simulates a tree of frames the way Figma auto layout places them (07 §6.1). Returns every
 * visible node's box relative to the root, or the issues that make the tree unsimulatable.
 * Pure and deterministic: the same input gives the same output, in the same order.
 */
export function simulate(root: SimNode, options: SimulateOptions = {}): SimResult {
  const issues = validateTree(root, options);
  if (issues.length > 0) return err(issues);

  const log = new AssumptionLog();
  const engine = new Engine(log);
  const natural = engine.naturalSize(root);
  const forced = (axis: Axis, value: number): number => {
    const outer = axis === 'h' ? options.outer?.w : options.outer?.h;
    return sizingOf(root, axis) === 'FILL' && outer !== undefined ? engine.fit(root, axis, outer) : value;
  };
  const size: Size = { w: forced('h', natural.w), h: forced('v', natural.h) };
  const rects = new Map<string, Rect>();
  engine.place(root, size, 0, 0, rects);
  return ok({ size, rects, assumptions: log.list() });
}

/** The auto-layout frame around `children` in {@link simulateAutoLayout} and {@link measureHug}. */
export interface StackFrame {
  /** Key of the frame in `Simulation.rects`; defaults to {@link DEFAULT_FRAME_KEY}. */
  readonly key?: string;
  /** Size on the FIXED axes; defaults to 0 × 0 (the frame then takes its padding). */
  readonly size?: Size;
  readonly min?: SizeBounds;
  readonly max?: SizeBounds;
  readonly stroke?: StrokeBox;
}

export const DEFAULT_FRAME_KEY = '$frame';

/**
 * One auto-layout frame (02 §6.1 `simulateAutoLayout(spec, children)`). `children` may be
 * leaves with their intrinsic sizes or whole subtrees; the frame's sizing follows `spec`.
 */
export function simulateAutoLayout(
  spec: StackSpec,
  children: readonly SimNode[],
  frame: StackFrame = {},
  options: SimulateOptions = {},
): SimResult {
  return simulate(frameNode(spec, children, frame), options);
}

/**
 * The size a frame takes when it hugs both axes around `children`: content plus padding,
 * within its min/max (02 §6.1 `measureHug()`).
 */
export function measureHug(spec: StackSpec, children: readonly SimNode[], frame: StackFrame = {}): SimResult<Size> {
  const hugging: StackSpec = { ...spec, primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO' };
  const result = simulate(frameNode(hugging, children, frame));
  return result.ok ? ok(result.value.size) : result;
}

/** GRID auto layout (02 §6.1). Not simulated before B-112 and spike S-10: always `unsupported-grid`. */
export function simulateGrid(
  _spec: SceneGridLayout,
  _children: readonly SimNode[],
  frame: StackFrame = {},
): SimResult<Simulation> {
  const key = frame.key ?? DEFAULT_FRAME_KEY;
  return err([issue('unsupported-grid', key, 'Grid auto layout is not simulated yet.')]);
}

function frameNode(spec: StackSpec, children: readonly SimNode[], frame: StackFrame): SimNode {
  return {
    key: frame.key ?? DEFAULT_FRAME_KEY,
    size: frame.size ?? { w: 0, h: 0 },
    layout: spec,
    children,
    ...(frame.min === undefined ? {} : { min: frame.min }),
    ...(frame.max === undefined ? {} : { max: frame.max }),
    ...(frame.stroke === undefined ? {} : { stroke: frame.stroke }),
  };
}
