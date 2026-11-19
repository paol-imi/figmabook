import { type SimNode, type SizeBounds, type StackSpec, simulate } from '@holotype/layout-sim';
import { type Axis, applyConstraints, isFill, MIN_SIZE, ownMode, setOwnMode } from '../nodes/layout';
import type { NodeState } from '../state';
import { firstBaseline, measureText, type TextOracle } from '../text-metrics';

/**
 * Derived geometry, recomputed after every write as Figma does ("Figma lays out synchronously",
 * 09 §11): text sizes from {@link measureText}, auto-layout positions and HUG/FILL sizes from
 * `@holotype/layout-sim` (09 §18 "lays out auto-layout … via layout-sim").
 *
 * The unit of work is a *layout root*: the topmost node reached from a changed node through
 * auto-layout parents. Only stack frames (HORIZONTAL/VERTICAL without wrap) are simulated; every
 * other node is a leaf that keeps its size, and the children of non-stack frames keep their
 * positions. Wrap (B-111) and GRID (B-112) frames are leaves too: their children are not moved.
 */

const EPSILON = 1e-6;
const MAX_PASSES = 4;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON;
}

/** A frame whose children layout-sim places: HORIZONTAL or VERTICAL, no wrap. */
function isSimStack(state: NodeState): boolean {
  return state.isStack && state.layoutWrap === 'NO_WRAP';
}

function inFlow(state: NodeState): boolean {
  return state.visible && state.layoutPositioning === 'AUTO';
}

function isRotated(state: NodeState): boolean {
  const [[a, b], [c, d]] = state.transform;
  return !(near(a, 1) && near(b, 0) && near(c, 0) && near(d, 1));
}

/** The box a rotated node occupies in its parent: `[minX, minY, width, height]` relative to its translation. */
function rotatedBox(state: NodeState): [number, number, number, number] {
  const [[a, b], [c, d]] = state.transform;
  const xs = [0, a * state.width, b * state.height, a * state.width + b * state.height];
  const ys = [0, c * state.width, d * state.height, c * state.width + d * state.height];
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  return [minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY];
}

/**
 * "A frame cannot hug an axis on which a child fills: Figma switches it to FIXED" (layout-sim
 * assumption `fill-breaks-hug`, https://help.figma.com/hc/en-us/articles/360040451373). Applied
 * before every simulation, so layout-sim never sees `fill-in-hug-parent`.
 */
function settleFillInHug(state: NodeState): void {
  if (!state.isStack) return;
  for (const axis of ['h', 'v'] as const) {
    if (ownMode(state, axis) !== 'AUTO') continue;
    if (state.children.some((child) => inFlow(child) && isFill(child, axis))) setOwnMode(state, axis, 'FIXED');
  }
}

function bounds(min: number | null, max: number | null): { min?: number; max?: number } {
  // A max below the min cannot hold: the min wins, as the padding floor does (layout-sim `min-max-before-floor`).
  const hi = max !== null && (min === null || max >= min) ? max : null;
  return { ...(min === null ? {} : { min }), ...(hi === null ? {} : { max: hi }) };
}

function sizeBounds(state: NodeState): { min?: SizeBounds; max?: SizeBounds } {
  const w = bounds(state.minWidth, state.maxWidth);
  const h = bounds(state.minHeight, state.maxHeight);
  const min: { w?: number; h?: number } = {};
  const max: { w?: number; h?: number } = {};
  if (w.min !== undefined) min.w = w.min;
  if (h.min !== undefined) min.h = h.min;
  if (w.max !== undefined) max.w = w.max;
  if (h.max !== undefined) max.h = h.max;
  return {
    ...(Object.keys(min).length > 0 ? { min } : {}),
    ...(Object.keys(max).length > 0 ? { max } : {}),
  };
}

function stackSpec(state: NodeState): StackSpec {
  const mode = state.layoutMode === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL';
  const align = state.counterAxisAlignItems;
  return {
    mode,
    padding: {
      t: Math.max(0, state.paddingTop),
      r: Math.max(0, state.paddingRight),
      b: Math.max(0, state.paddingBottom),
      l: Math.max(0, state.paddingLeft),
    },
    itemSpacing: state.itemSpacing,
    primaryAxisAlignItems: state.primaryAxisAlignItems,
    // BASELINE survives a switch to VERTICAL in the stored value; it lays out as MIN there.
    counterAxisAlignItems: align === 'BASELINE' && mode === 'VERTICAL' ? 'MIN' : align,
    primaryAxisSizingMode: state.primaryAxisSizingMode,
    counterAxisSizingMode: state.counterAxisSizingMode,
    strokesIncludedInLayout: state.strokesIncludedInLayout,
  };
}

/** First-baseline offset of a node for BASELINE rows: its own for text, else its first in-flow child's. */
function baselineOf(state: NodeState): number | undefined {
  if (state.text) return firstBaseline(state.text);
  for (const child of state.children) {
    if (!inFlow(child)) continue;
    const inner = baselineOf(child);
    if (inner !== undefined) return child.y + inner;
  }
  return undefined;
}

/** The nodes of one simulation: the root, then everything reached through stack frames. */
function scopeOf(root: NodeState): NodeState[] {
  const out: NodeState[] = [root];
  const walk = (state: NodeState) => {
    if (!isSimStack(state)) return;
    for (const child of state.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

type TextSizes = Map<NodeState, { w: number; h: number }>;

function toSim(state: NodeState, root: boolean, textSizes: TextSizes): SimNode {
  const rotated = !root && isRotated(state);
  const box = rotated ? rotatedBox(state) : null;
  const size = box ? { w: box[2], h: box[3] } : (textSizes.get(state) ?? { w: state.width, h: state.height });
  const filling = (axis: Axis) => !root && !rotated && isFill(state, axis);
  const baseline = !root && state.parent?.counterAxisAlignItems === 'BASELINE' ? baselineOf(state) : undefined;
  const stroke = {
    align: state.strokeAlign,
    weight: {
      t: state.strokeTopWeight,
      r: state.strokeRightWeight,
      b: state.strokeBottomWeight,
      l: state.strokeLeftWeight,
    },
  };
  return {
    key: state.id,
    size,
    visible: root || state.visible,
    ...(root ? {} : { positioning: state.layoutPositioning, xy: { x: state.x, y: state.y } }),
    ...(baseline === undefined ? {} : { baseline }),
    ...(filling('h') ? { sizingH: 'FILL' as const } : {}),
    ...(filling('v') ? { sizingV: 'FILL' as const } : {}),
    ...sizeBounds(state),
    ...(isSimStack(state)
      ? {
          layout: stackSpec(state),
          ...(state.strokes.length > 0 ? { stroke } : {}),
          children: state.children.map((child) => toSim(child, false, textSizes)),
        }
      : {}),
  };
}

/** The text oracle and a sink for nodes whose geometry changed. */
export interface LayoutHost {
  readonly oracle: TextOracle | null;
  /** Nodes that must be settled again (children moved by constraints). */
  touch(state: NodeState): void;
}

/** Width and height a text node takes from its content and `textAutoResize` (typings:11026-11035). */
function naturalTextSize(state: NodeState, host: LayoutHost, wrapAt?: number): { w: number; h: number } | null {
  const text = state.text;
  if (!text || state.textAutoResize === 'NONE' || state.textAutoResize === 'TRUNCATE') return null;
  const auto = state.textAutoResize === 'WIDTH_AND_HEIGHT';
  const lineCount = host.oracle && state.views.text ? host.oracle(state.views.text) : undefined;
  const measure = (wrapWidth: number | null) =>
    measureText(text, {
      wrapWidth,
      paragraphSpacing: state.paragraphSpacing,
      maxLines: state.textTruncation === 'ENDING' ? state.maxLines : null,
      lineCount,
    });
  const content = measure(auto ? null : state.width);
  if (!auto) return { w: state.width, h: content.height };
  // Auto-width text narrowed by its parent (min/max) wraps at the width it gets.
  if (wrapAt !== undefined && wrapAt < content.width - EPSILON) return { w: content.width, h: measure(wrapAt).height };
  return { w: content.width, h: content.height };
}

function setSize(state: NodeState, w: number, h: number, changed: Set<NodeState>): boolean {
  if (near(state.width, w) && near(state.height, h)) return false;
  const [dw, dh, sx, sy] = [w - state.width, h - state.height, w / state.width, h / state.height];
  state.width = w;
  state.height = h;
  changed.add(state);
  // A non-stack container resized by its parent's layout applies its children's constraints.
  if (!isSimStack(state) && state.children.length > 0 && Number.isFinite(sx) && Number.isFinite(sy)) {
    applyConstraints(state, dw, dh, sx, sy);
  }
  return true;
}

/** The topmost node whose geometry can depend on `state`: up through simulated stack parents. */
export function layoutRoot(state: NodeState): NodeState {
  let node = state;
  while (node.parent && isSimStack(node.parent)) node = node.parent;
  return node;
}

/** Simulates one layout root and writes positions and sizes back into `changed`. */
function layoutStack(root: NodeState, host: LayoutHost, changed: Set<NodeState>): void {
  const textSizes: TextSizes = new Map();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const scope = scopeOf(root);
    for (const node of scope) settleFillInHug(node);
    const texts = scope.filter((node) => node !== root && node.text !== null);
    if (pass === 0) {
      for (const text of texts) {
        const size = naturalTextSize(text, host);
        if (size) textSizes.set(text, size);
      }
    }
    const result = simulate(toSim(root, true, textSizes));
    if (!result.ok) {
      const issues = result.error.map((issue) => `${issue.code} at ${issue.key}: ${issue.message}`).join('; ');
      throw new Error(`figma-fake internal error: layout simulation failed (${issues})`);
    }
    const rects = result.value.rects;
    const byId = new Map(scope.map((node) => [node.id, node]));
    for (const [key, rect] of rects) {
      const state = byId.get(key);
      if (!state) continue;
      if (state === root) {
        setSize(root, Math.max(rect.w, MIN_SIZE), Math.max(rect.h, MIN_SIZE), changed);
        continue;
      }
      const parentRect = state.parent ? rects.get(state.parent.id) : undefined;
      if (!parentRect) continue;
      const rotated = isRotated(state);
      if (state.layoutPositioning === 'AUTO') {
        // A rotated child takes its bounding box in the flow; its own size is kept.
        const [minX, minY] = rotated ? rotatedBox(state) : [0, 0];
        move(state, rect.x - parentRect.x - minX, rect.y - parentRect.y - minY, changed);
      }
      if (rotated) continue;
      const [w, h] = [Math.max(rect.w, state.text ? 0 : MIN_SIZE), Math.max(rect.h, MIN_SIZE)];
      if (setSize(state, w, h, changed) && !isSimStack(state)) host.touch(state);
    }
    // Hidden text takes no part in the flow but still sizes itself.
    for (const text of texts) {
      const size = textSizes.get(text);
      if (size && !rects.has(text.id)) setSize(text, size.w, size.h, changed);
    }
    // Text whose width the layout changed wraps again; repeat until the heights hold.
    let settled = true;
    for (const text of texts) {
      const given = textSizes.get(text);
      const size = given ? naturalTextSize(text, host, text.width) : null;
      if (given && size && !near(size.h, given.h)) {
        textSizes.set(text, { w: given.w, h: size.h });
        settled = false;
      }
    }
    if (settled) return;
  }
}

function move(state: NodeState, x: number, y: number, changed: Set<NodeState>): void {
  if (near(state.x, x) && near(state.y, y)) return;
  state.setPosition(x, y);
  changed.add(state);
}

/**
 * Brings the geometry derived from `state` up to date: its text size, then its layout root.
 * Returns every node whose position or size changed.
 */
export function relayout(states: Iterable<NodeState>, host: LayoutHost): Set<NodeState> {
  const changed = new Set<NodeState>();
  const roots = new Set<NodeState>();
  for (const state of states) {
    if (state.removed || state.type === 'DOCUMENT' || state.type === 'PAGE') continue;
    if (state.text && !(state.parent && isSimStack(state.parent))) {
      const size = naturalTextSize(state, host);
      if (size) setSize(state, size.w, size.h, changed);
    }
    roots.add(layoutRoot(state));
  }
  for (const root of roots) {
    if (root.removed) continue;
    settleFillInHug(root);
    if (isSimStack(root)) layoutStack(root, host, changed);
  }
  return changed;
}
