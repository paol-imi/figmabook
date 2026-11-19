import { figmaError, unsupported } from '../errors';
import { checkEntrySize, checkKey, checkNamespace, checkValue } from '../plugin-data';
import { bindState, live, type NodeState, stateOfNode } from '../state';
import { deepFreeze } from '../values';
import { detachNode } from './tree';

/**
 * Mixin constructor type. TypeScript requires mixin bases to have exactly this constructor
 * signature (error TS2545), so it is the one place `any` is unavoidable.
 */
// biome-ignore lint/suspicious/noExplicitAny: TS2545 requires a `...args: any[]` mixin constructor.
export type Ctor<T = NodeCore> = new (...args: any[]) => T;

/**
 * Plugin data of a node as Figma returns it: an instance sublayer "reads back the main
 * component's keys" (10 §2.1), so a key it does not set itself comes from the node it mirrors.
 */
function chain(state: NodeState): NodeState[] {
  const out: NodeState[] = [];
  for (let node: NodeState | null = state; node; node = node.source) out.push(node);
  return out;
}

function readPrivate(state: NodeState, key: string): string {
  for (const node of chain(state)) {
    const value = node.pluginData.get(key);
    if (value !== undefined) return value;
  }
  return '';
}

function readShared(state: NodeState, namespace: string, key: string): string {
  for (const node of chain(state)) {
    const value = node.sharedPluginData.get(namespace)?.get(key);
    if (value !== undefined) return value;
  }
  return '';
}

/** Keys of the node and of the nodes it mirrors, own keys first. */
export function privateKeysOf(state: NodeState): string[] {
  return [...new Set(chain(state).flatMap((node) => [...node.pluginData.keys()]))];
}

export function sharedKeysOf(state: NodeState, namespace: string): string[] {
  return [...new Set(chain(state).flatMap((node) => [...(node.sharedPluginData.get(namespace)?.keys() ?? [])]))];
}

/**
 * `BaseNodeMixin`, `PluginDataMixin` and `DevResourcesMixin` (typings:6364-6627): members
 * every node has.
 */
export class NodeCore {
  constructor(state: NodeState) {
    bindState(this, state);
    state.ctx.register(state);
  }

  get id(): string {
    return stateOfNode(this).id;
  }

  /** `parent` is null for the root and for removed nodes (typings:6374-6380). */
  get parent(): (BaseNode & ChildrenMixin) | null {
    const parent = stateOfNode(this).parent;
    return parent ? parent.parentView : null;
  }

  get name(): string {
    return live(this).name;
  }

  /**
   * Renaming a text node turns `autoRename` off (typings:6385-6389, 11052-11058). Renaming the
   * document is not possible: "`figma.root.name` will return the name, read-only" (typings:6383).
   */
  set name(value: string) {
    const state = live(this);
    if (typeof value !== 'string') throw figmaError('set_name', 'Expected "name" to be a string');
    if (state.type === 'DOCUMENT') throw figmaError('set_name', 'The document name is read-only');
    state.name = value;
    if (state.type === 'TEXT') state.autoRename = false;
    state.ctx.record(state, 'set', 'name', value);
  }

  get removed(): boolean {
    return stateOfNode(this).removed;
  }

  /** `[Node 1:2]` (typings:6408-6420). */
  toString(): string {
    return `[Node ${stateOfNode(this).id}]`;
  }

  /** Removes this node and all of its children (typings:6421-6427). */
  remove(): void {
    const state = live(this);
    if (state.type === 'DOCUMENT') throw figmaError('remove', 'Cannot remove the document');
    // An instance's layers come from its main component (hide them instead).
    if (state.inInstance) throw figmaError('remove', 'Cannot remove a node inside an instance');
    if (state.type === 'PAGE') {
      const pages = state.parent?.children ?? [];
      if (pages.length <= 1) throw figmaError('remove', 'Cannot remove the last page of a document');
      if (state.ctx.currentPage === state) state.ctx.currentPage = pages.find((p) => p !== state) ?? state;
    }
    detachNode(state);
    for (const node of [state, ...state.descendants()]) {
      node.removed = true;
      if (node.type === 'INSTANCE') node.ctx.instances.delete(node);
    }
    state.ctx.record(state, 'remove');
  }

  /** Each call replaces all relaunch data; descriptions are limited to 1000 characters (typings:6429-6447). */
  setRelaunchData(data: { [command: string]: string }): void {
    const state = live(this);
    for (const [command, description] of Object.entries(data)) {
      if (typeof description !== 'string') throw figmaError('setRelaunchData', `Expected "${command}" to be a string`);
      if (description.length > 1000) throw figmaError('setRelaunchData', 'Description exceeds 1000 characters');
    }
    state.relaunchData = deepFreeze({ ...data });
    state.ctx.record(state, 'setRelaunchData', null, data);
  }

  getRelaunchData(): { [command: string]: string } {
    return { ...live(this).relaunchData };
  }

  get isAsset(): boolean {
    return unsupported('BaseNode.isAsset', 'hardening');
  }

  getCSSAsync(): Promise<{ [key: string]: string }> {
    return unsupported('BaseNode.getCSSAsync', 'hardening');
  }

  getTopLevelFrame(): FrameNode | undefined {
    return unsupported('BaseNode.getTopLevelFrame', 'hardening');
  }

  // PluginDataMixin: private data, scoped to the plugin id (typings:6524-6579).

  getPluginData(key: string): string {
    checkKey('getPluginData', key);
    return readPrivate(live(this), key);
  }

  /** Setting `''` removes the key (typings:6531-6533). */
  setPluginData(key: string, value: string): void {
    checkKey('setPluginData', key);
    checkValue('setPluginData', value);
    const state = live(this);
    checkEntrySize('setPluginData', state.ctx.pluginId, key, value);
    if (value === '') state.pluginData.delete(key);
    else state.pluginData.set(key, value);
    state.ctx.record(state, 'setPluginData', key, value);
  }

  getPluginDataKeys(): string[] {
    return privateKeysOf(live(this));
  }

  getSharedPluginData(namespace: string, key: string): string {
    checkNamespace('getSharedPluginData', namespace);
    checkKey('getSharedPluginData', key);
    return readShared(live(this), namespace, key);
  }

  /** Public data under a namespace; `''` removes the key (typings:6547-6574). */
  setSharedPluginData(namespace: string, key: string, value: string): void {
    checkNamespace('setSharedPluginData', namespace);
    checkKey('setSharedPluginData', key);
    checkValue('setSharedPluginData', value);
    const state = live(this);
    checkEntrySize('setSharedPluginData', namespace, key, value);
    const entries = state.sharedPluginData.get(namespace) ?? new Map<string, string>();
    if (value === '') entries.delete(key);
    else entries.set(key, value);
    if (entries.size > 0) state.sharedPluginData.set(namespace, entries);
    else state.sharedPluginData.delete(namespace);
    state.ctx.record(state, 'setSharedPluginData', `${namespace}/${key}`, value);
  }

  getSharedPluginDataKeys(namespace: string): string[] {
    checkNamespace('getSharedPluginDataKeys', namespace);
    return sharedKeysOf(live(this), namespace);
  }

  // DevResourcesMixin (typings:6581-6627): not modelled.

  getDevResourcesAsync(_options?: { includeChildren?: boolean }): Promise<DevResourceWithNodeId[]> {
    return unsupported('BaseNode.getDevResourcesAsync', 'hardening');
  }

  addDevResourceAsync(_url: string, _name?: string): Promise<void> {
    return unsupported('BaseNode.addDevResourceAsync', 'hardening');
  }

  editDevResourceAsync(_currentUrl: string, _newValue: { name?: string; url?: string }): Promise<void> {
    return unsupported('BaseNode.editDevResourceAsync', 'hardening');
  }

  deleteDevResourceAsync(_url: string): Promise<void> {
    return unsupported('BaseNode.deleteDevResourceAsync', 'hardening');
  }

  setDevResourcePreviewAsync(_url: string, _preview: PlainTextElement): Promise<void> {
    return unsupported('BaseNode.setDevResourcePreviewAsync', 'hardening');
  }
}
