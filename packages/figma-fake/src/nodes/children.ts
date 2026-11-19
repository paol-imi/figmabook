import { figmaError, unsupported } from '../errors';
import { live, type NodeState, stateOfNode } from '../state';
import { type Ctor, NodeCore } from './core';
import { attachNode } from './tree';

/**
 * Under `documentAccess: "dynamic-page"` a page must be loaded before its children are read
 * or changed (typings:7034, 7051, 7063, …; `PageNode.loadAsync`, typings:10726-10729).
 */
export function checkLoaded(api: string, state: NodeState): void {
  if (state.type === 'PAGE' && !state.loaded) {
    throw figmaError(
      api,
      'Cannot access children on a page that has not been explicitly loaded. Remember to call `await page.loadAsync()` first.',
    );
  }
}

/** The node passed to `appendChild` / `insertChild` must be a live node of this fake. */
export function stateOf(api: string, node: unknown): NodeState {
  if (node instanceof NodeCore) return live(node);
  throw figmaError(api, 'Expected a node object');
}

export interface Criteria {
  readonly types?: readonly NodeType[] | undefined;
  readonly pluginData?: { readonly keys?: readonly string[] | undefined } | undefined;
  readonly sharedPluginData?: { readonly namespace: string; readonly keys?: readonly string[] | undefined } | undefined;
}

/** `FindAllCriteria`: every given criterion must hold; `keys` match if any key is present (typings:12821-12876). */
export function matchesCriteria(state: NodeState, criteria: Criteria): boolean {
  if (criteria.types && !criteria.types.includes(state.type)) return false;
  if (criteria.pluginData) {
    const keys = criteria.pluginData.keys;
    if (state.pluginData.size === 0) return false;
    if (keys && !keys.some((key) => state.pluginData.has(key))) return false;
  }
  if (criteria.sharedPluginData) {
    const entries = state.sharedPluginData.get(criteria.sharedPluginData.namespace);
    if (!entries || entries.size === 0) return false;
    const keys = criteria.sharedPluginData.keys;
    if (keys && !keys.some((key) => entries.has(key))) return false;
  }
  return true;
}

function hasCriteriaType<T extends NodeType[]>(
  node: SceneNode,
  criteria: FindAllCriteria<T>,
): node is { type: T[number] } & SceneNode {
  return node instanceof NodeCore && matchesCriteria(stateOfNode(node), criteria);
}

/** `ChildrenMixin` for frames, pages, sections, components and component sets (typings:7030-7279). */
export function WithChildren<B extends Ctor>(Base: B) {
  return class extends Base implements ChildrenMixin {
    /** A new read-only array on every read, back to front (typings:7032-7040). */
    get children(): ReadonlyArray<SceneNode> {
      const state = live(this);
      checkLoaded('children', state);
      return Object.freeze(state.children.map((child) => child.sceneView));
    }

    appendChild(child: SceneNode): void {
      const state = live(this);
      checkLoaded('appendChild', state);
      const childState = stateOf('appendChild', child);
      attachNode('appendChild', state, childState, state.children.length);
      state.ctx.record(state, 'appendChild', null, childState.id);
    }

    insertChild(index: number, child: SceneNode): void {
      const state = live(this);
      checkLoaded('insertChild', state);
      const childState = stateOf('insertChild', child);
      attachNode('insertChild', state, childState, index);
      state.ctx.record(state, 'insertChild', null, { index, child: childState.id });
    }

    findChildren(callback?: (node: SceneNode) => boolean): SceneNode[] {
      const state = live(this);
      checkLoaded('findChildren', state);
      const children = state.children.map((child) => child.sceneView);
      return callback ? children.filter(callback) : children;
    }

    findChild(callback: (node: SceneNode) => boolean): SceneNode | null {
      return this.findChildren().find(callback) ?? null;
    }

    /** Pre-order, back to front, excluding this node (typings:7113-7137). */
    findAll(callback?: (node: SceneNode) => boolean): SceneNode[] {
      const state = live(this);
      checkLoaded('findAll', state);
      const nodes = state.descendants().map((node) => node.sceneView);
      return callback ? nodes.filter(callback) : nodes;
    }

    findOne(callback: (node: SceneNode) => boolean): SceneNode | null {
      return this.findAll().find(callback) ?? null;
    }

    findAllWithCriteria<T extends NodeType[]>(criteria: FindAllCriteria<T>): Array<{ type: T[number] } & SceneNode> {
      const state = live(this);
      checkLoaded('findAllWithCriteria', state);
      return state
        .descendants()
        .map((node) => node.sceneView)
        .filter((node) => hasCriteriaType(node, criteria));
    }

    findWidgetNodesByWidgetId(_widgetId: string): Array<WidgetNode> {
      return unsupported('ChildrenMixin.findWidgetNodesByWidgetId', 'hardening');
    }
  };
}
