import type { Diagnostic } from '@holotype/shared';
import { hasOwnPaint } from '../css';
import { plainDiagnostic } from '../diagnostics';
import { insetRect, intersectRects, overlaps } from '../geometry';
import { syntheticNode, type WorkNode } from '../state';
import { compareKeys, flowKey, isStackPositioned, type PaintKey, paintKey, sortByPaint } from './paint-order';

/*
 * Z-index escapes (07 §7.3). A positioned box paints in the stacking context of its nearest
 * stacking-context ancestor, not in its parent. When that puts it above (or, for a negative
 * z-index, below) a layer the tree paints the other way round, and the two overlap, no child
 * order can express it: the box is hoisted to the stacking-context frame as an absolute
 * child. A clip of an ancestor it leaves is kept by wrapping it in a clip frame with that
 * clip rect. The hoisted box keeps the key of its original path (naming, stage 13).
 */

/** The boxes of one stacking context: everything below its root, nested contexts as atoms. */
interface Scope {
  readonly root: WorkNode;
  /** Tree (pre-)order, which is Figma paint order once children are sorted. */
  readonly order: readonly WorkNode[];
  readonly parent: ReadonlyMap<WorkNode, WorkNode>;
}

/** Whether a node roots a stacking context of its own (and so paints as one atom). */
const isContext = (node: WorkNode): boolean => node.synthetic === undefined && node.capture.paint.stackingContext;

function scopeOf(root: WorkNode, skip: (node: WorkNode) => boolean): Scope {
  const order: WorkNode[] = [];
  const parent = new Map<WorkNode, WorkNode>();
  const visit = (node: WorkNode): void => {
    for (const child of node.children) {
      if (node === root && skip(child)) continue;
      parent.set(child, node);
      order.push(child);
      if (!isContext(child)) visit(child);
    }
  };
  visit(root);
  return { root, order, parent };
}

function ancestorsOf(node: WorkNode, scope: Scope): WorkNode[] {
  const out: WorkNode[] = [];
  for (let at = scope.parent.get(node); at !== undefined && at !== scope.root; at = scope.parent.get(at)) {
    out.push(at);
  }
  return out;
}

/** Where a box paints in its context: as part of its nearest positioned ancestor, else in its flow layer. */
function atomKey(node: WorkNode, scope: Scope): PaintKey {
  for (const at of [node, ...ancestorsOf(node, scope)]) {
    if (isStackPositioned(at.capture.paint)) return paintKey(at.capture.paint);
  }
  return flowKey(node.capture.paint);
}

/** Whether the box itself draws something an escape could cover or be covered by. */
function drawsOwn(node: WorkNode): boolean {
  if (node.kind === 'text' || node.capture.replaced !== undefined) return true;
  return !node.paintHidden && hasOwnPaint(node.capture);
}

/** Whether anything in the subtree draws (a nested stacking context paints as one atom). */
function drawsAny(node: WorkNode): boolean {
  return drawsOwn(node) || node.children.some(drawsAny);
}

function descendants(node: WorkNode, out = new Set<WorkNode>()): Set<WorkNode> {
  for (const child of node.children) {
    out.add(child);
    descendants(child, out);
  }
  return out;
}

/** Whether the tree's paint order between `node` and an overlapping box differs from CSS's. */
function escapes(node: WorkNode, scope: Scope): boolean {
  const key = paintKey(node.capture.paint);
  const ancestors = ancestorsOf(node, scope);
  // Ancestors always paint below their children in the tree.
  for (const ancestor of ancestors) {
    if (drawsOwn(ancestor) && overlaps(ancestor.box, node.box) && compareKeys(key, atomKey(ancestor, scope)) < 0) {
      return true;
    }
  }
  const skip = new Set([node, ...ancestors, ...descendants(node)]);
  const at = scope.order.indexOf(node);
  return scope.order.some((other, i) => {
    if (skip.has(other) || !overlaps(other.box, node.box)) return false;
    if (!(isContext(other) ? drawsAny(other) : drawsOwn(other))) return false;
    return i > at !== compareKeys(atomKey(other, scope), key) > 0;
  });
}

/** Whether a box clips its content on either axis (Figma clips both, 07 §10.5). */
function clips(node: WorkNode): boolean {
  const computed = node.capture.computed;
  return computed !== undefined && (computed.overflowX !== 'visible' || computed.overflowY !== 'visible');
}

/** Overflow clips at the padding box. */
function clipRect(node: WorkNode) {
  const width = node.capture.computed?.border.width ?? [0, 0, 0, 0];
  return insetRect(node.box, width);
}

function hoist(node: WorkNode, scope: Scope, isPinned: (node: WorkNode) => boolean): void {
  const parent = scope.parent.get(node);
  if (parent === undefined) return;
  const clippers = ancestorsOf(node, scope).filter(clips);
  parent.children = parent.children.filter((child) => child !== node);
  node.hoistedFrom = { parent };
  const [first, ...rest] = clippers;
  const moved =
    first === undefined
      ? node
      : syntheticNode(
          node,
          'clip',
          'frame',
          rest.reduce((rect, clipper) => intersectRects(rect, clipRect(clipper)), clipRect(first)),
          { fills: [], clipsContent: true },
          [node],
        );
  const { root } = scope;
  const pinned = root.children.filter(isPinned);
  root.children = [...sortByPaint([...root.children.filter((child) => !isPinned(child)), moved]), ...pinned];
  const note: Diagnostic = plainDiagnostic('LAYOUT_ZINDEX_HOIST', {
    fallback: clippers.length > 0 ? 'moved into a clip frame of the stacking context' : 'moved to the stacking context',
    data: { from: parent.capture.source.path, to: root.capture.source.path },
  });
  node.diagnostics.push(note);
}

/**
 * Hoists the escapes of the stacking context rooted at `root`, then of every context nested
 * in it. `isPinned` children of the root (portals) keep their place and form contexts of
 * their own.
 */
export function hoistEscapes(root: WorkNode, isPinned: (node: WorkNode) => boolean = () => false): void {
  let scope = scopeOf(root, isPinned);
  const candidates = scope.order.filter(
    (node) => isStackPositioned(node.capture.paint) && scope.parent.get(node) !== root,
  );
  for (const candidate of candidates) {
    if (scope.parent.get(candidate) === root || !escapes(candidate, scope)) continue;
    hoist(candidate, scope, isPinned);
    scope = scopeOf(root, isPinned);
  }
  for (const node of scope.order) if (isContext(node)) hoistEscapes(node);
  for (const pinned of root.children.filter(isPinned)) hoistEscapes(pinned);
}
