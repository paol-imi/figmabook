import { figmaError } from '../errors';
import type { NodeState } from '../state';

/**
 * Parent/child invariants. Figma: "Reparenting nodes is subject to many restrictions … Below
 * are possible exceptions that can be thrown if the operation is invalid" (typings:7053-7057).
 * The rules enforced here are the ones the applier can meet; each throws a plain `Error`.
 */
function checkParenting(api: string, parent: NodeState, child: NodeState): void {
  if (child.type === 'DOCUMENT') throw figmaError(api, 'The document cannot be reparented');
  if (parent.type === 'DOCUMENT') {
    if (child.type !== 'PAGE') throw figmaError(api, 'Only pages can be children of the document');
    return;
  }
  // "A page node can be the parent of all types of nodes except for the document node and other page nodes" (typings:1123-1125).
  if (child.type === 'PAGE') throw figmaError(api, 'A page can only be a child of the document');
  if (parent.ctx !== child.ctx) throw figmaError(api, 'The node belongs to another document');
  // An instance's layers come from its main component: nothing can be added to or taken out of it.
  if (parent.type === 'INSTANCE' || parent.inInstance) {
    throw figmaError(api, 'Cannot move node. New parent is an instance or is inside of an instance');
  }
  if (child.inInstance) throw figmaError(api, 'Cannot move node. Node is inside of an instance');
  checkInstanceCycle(api, parent, child);
  if (parent.hasAncestorOrSelf(child)) {
    throw figmaError(api, 'Cannot move a node into itself or one of its descendants');
  }
  // `ComponentSetNode.children` are `ComponentNode`s (typings:11175-11195).
  if (parent.type === 'COMPONENT_SET' && child.type !== 'COMPONENT') {
    throw figmaError(api, 'Component sets can only contain components');
  }
  // Sections live on the canvas: their parent is a page or another section.
  if (child.type === 'SECTION' && parent.type !== 'PAGE' && parent.type !== 'SECTION') {
    throw figmaError(api, 'Sections can only be placed on a page or inside another section');
  }
  // Main components cannot be nested inside other components (the editor refuses it too).
  const ancestors: NodeState[] = [];
  for (let p: NodeState | null = parent; p; p = p.parent) ancestors.push(p);
  const insideComponent = ancestors.some((p) => p.type === 'COMPONENT');
  const movesComponents =
    child.type === 'COMPONENT' ||
    child.type === 'COMPONENT_SET' ||
    child.descendants().some((d) => d.type === 'COMPONENT' || d.type === 'COMPONENT_SET');
  if (movesComponents && insideComponent) throw figmaError(api, 'Cannot move a component inside another component');
  if (child.type === 'COMPONENT_SET' && ancestors.some((p) => p.type === 'COMPONENT_SET')) {
    throw figmaError(api, 'Cannot move a component set inside another component set');
  }
}

/** Every main component `state`'s instances depend on, transitively (nested instances included). */
function dependencies(state: NodeState, out = new Set<NodeState>()): Set<NodeState> {
  for (const node of [state, ...state.descendants()]) {
    const main = node.type === 'INSTANCE' ? node.mainComponent : null;
    if (!main || out.has(main)) continue;
    out.add(main);
    if (main.parent?.type === 'COMPONENT_SET') out.add(main.parent);
    dependencies(main, out);
  }
  return out;
}

/** An instance cannot be pointed at a component that contains it (the same rule as a move). */
export function checkInstanceTarget(api: string, instance: NodeState, target: NodeState): void {
  const deps = new Set<NodeState>([target]);
  if (target.parent?.type === 'COMPONENT_SET') deps.add(target.parent);
  dependencies(target, deps);
  for (let node: NodeState | null = instance; node; node = node.parent) {
    if (deps.has(node)) throw figmaError(api, 'Cannot use a component that contains this instance');
  }
}

/** A component cannot contain an instance of itself, directly or through other components. */
function checkInstanceCycle(api: string, parent: NodeState, child: NodeState): void {
  const deps = dependencies(child);
  if (deps.size === 0) return;
  for (let node: NodeState | null = parent; node; node = node.parent) {
    if (deps.has(node)) throw figmaError(api, 'Cannot move an instance of a component inside itself');
  }
}

/**
 * Detaches a node from its parent. An emptied component set deletes itself: "empty component
 * sets are not supported in Figma" (typings:1846-1850), like a group that loses its last child
 * (typings:6390-6396).
 */
export function detachNode(state: NodeState): void {
  const parent = state.parent;
  state.detach();
  if (parent) parent.ctx.touch(parent);
  if (parent && parent.type === 'COMPONENT_SET' && parent.children.length === 0) {
    detachNode(parent);
    for (const node of [parent, ...parent.descendants()]) node.removed = true;
  }
}

/**
 * `insertChild(index, child)` semantics (typings:7060-7080): `index` addresses the children
 * array as it is before the move, from 0 to `children.length` inclusive; anything else throws.
 * A node already in `parent` is placed before the child that was at `index`, as fractional
 * indexing does, so `insertChild(children.length, c)` moves `c` to the top.
 */
export function attachNode(api: string, parent: NodeState, child: NodeState, index: number): void {
  checkParenting(api, parent, child);
  const siblings = parent.children;
  if (!Number.isInteger(index) || index < 0 || index > siblings.length) {
    throw figmaError(api, `Index ${index} is out of range: the node has ${siblings.length} children`);
  }
  const before = siblings[index] ?? null;
  if (before === child) return;
  if (child.parent === parent) siblings.splice(siblings.indexOf(child), 1);
  else detachNode(child);
  const at = before ? siblings.indexOf(before) : siblings.length;
  siblings.splice(at, 0, child);
  child.parent = parent;
  parent.ctx.touch(parent);
  parent.ctx.touch(child);
}
