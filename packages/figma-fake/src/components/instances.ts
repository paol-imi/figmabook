import { newState } from '../defaults';
import { applyConstraints } from '../nodes/layout';
import type { NodeState } from '../state';
import { applyOverrides, mirrorInto, overridesOf, PLACEMENT, rebase } from './mirror';
import type { PropertyValue } from './types';

/**
 * Instances and their sublayers (InstanceNode, typings:11244-11330; 10 §2.1).
 *
 * An instance owns a copy of its main component's tree. Each copy ("sublayer") remembers the
 * node it mirrors (`source`) and has the id `I<instance>;<source>`, Figma's format for instance
 * sublayers (10 §2.1: "instance sublayer ids look like `I<instanceId>;<childId>`"); a sublayer of
 * a nested instance gets `I<instance>;<nested>;<child>`. Sublayers read their source's plugin
 * data ("Instance sublayers carry their main component's plugin data", 10 §2.1).
 *
 * After every write, instances whose main component changed are synced again
 * (`syncDependents`), so instances follow their main component as in Figma; fields an instance
 * overrides are kept (see `mirror.ts`).
 */

/** The ViewFactory builds the public node object for a new sublayer state. */
export type ViewFactory = (state: NodeState) => void;

let viewFactory: ViewFactory | null = null;

/** Registered by the node classes module, which depends on this one. */
export function setViewFactory(factory: ViewFactory): void {
  viewFactory = factory;
}

function makeView(state: NodeState): void {
  if (!viewFactory) throw new Error('figma-fake internal error: no view factory registered');
  viewFactory(state);
}

function strip(id: string): string {
  return id.startsWith('I') ? id.slice(1) : id;
}

/** `I<owner>;<source>`; nested ids concatenate (10 §2.1). */
export function sublayerId(owner: NodeState, source: NodeState): string {
  return `I${strip(owner.id)};${strip(source.id)}`;
}

/** An instance of a variant is named after its component set, as in the editor. */
export function instanceName(main: NodeState): string {
  return main.parent?.type === 'COMPONENT_SET' ? main.parent.name : main.name;
}

/** The instance whose main component defines the properties `state`'s references point to. */
export function providerOf(state: NodeState): NodeState | null {
  for (let node = state.parent; node; node = node.parent) if (node.type === 'INSTANCE') return node;
  return null;
}

/**
 * The value of a property on an instance: set on it with `setProperties`, else inherited from the
 * nested instance it mirrors (a nested instance in a main component can have its own values).
 */
export function explicitValue(instance: NodeState, name: string): PropertyValue | undefined {
  const own = instance.propertyValues.get(name);
  if (own !== undefined) return own;
  return instance.source && !instance.swapped ? explicitValue(instance.source, name) : undefined;
}

function markRemoved(state: NodeState): void {
  for (const node of [state, ...state.descendants()]) {
    node.removed = true;
    if (node.type === 'INSTANCE') node.ctx.instances.delete(node);
  }
}

function createSublayer(source: NodeState, owner: NodeState): NodeState {
  const state = newState(source.ctx, source.type, sublayerId(owner, source), source.name);
  state.source = source;
  state.owner = owner;
  makeView(state);
  return state;
}

/** A string-typed property value with aliases resolved. */
function resolvedValue(instance: NodeState, name: string): string | boolean | undefined {
  const value = explicitValue(instance, name);
  if (value === undefined || typeof value !== 'object') return value;
  const resolved = instance.ctx.variables.resolveAlias(value);
  return typeof resolved === 'string' || typeof resolved === 'boolean' ? resolved : undefined;
}

/** Applies the provider's BOOLEAN and TEXT values to a sublayer bound to them (09 §8.1). */
function applyBoundValues(layer: NodeState, provider: NodeState | null): void {
  const refs = layer.propertyRefs;
  if (!refs || !provider) return;
  if (refs.visible !== undefined) {
    const value = resolvedValue(provider, refs.visible);
    if (typeof value === 'boolean') layer.visible = value;
  }
  if (refs.characters !== undefined && layer.text) {
    const value = resolvedValue(provider, refs.characters);
    if (typeof value === 'string' && value !== layer.text.characters) layer.text.replace(value);
  }
  rebase(layer, ['visible', 'characters', 'textStyles']);
}

function drivenFields(source: NodeState): ReadonlySet<string> {
  const refs = source.propertyRefs;
  const out = new Set<string>();
  if (refs?.visible !== undefined) out.add('visible');
  if (refs?.characters !== undefined) out.add('characters').add('textStyles');
  return out;
}

function setNestedMain(layer: NodeState, main: NodeState, swapped: boolean): void {
  const registry = layer.ctx.instances;
  registry.delete(layer);
  layer.mainComponent = main;
  layer.swapped = swapped;
  if (swapped) registry.add(layer);
}

/** Copies how a swapped nested instance sits in its parent from the slot it fills. */
function placeLike(layer: NodeState, slot: NodeState): void {
  layer.transform = slot.transform;
  for (const field of PLACEMENT) Reflect.set(layer, field, Reflect.get(slot, field));
}

/** Syncs a nested instance sublayer `layer`, which mirrors the instance `source`. */
function syncNested(layer: NodeState, source: NodeState, owner: NodeState, provider: NodeState | null): void {
  const natural = source.mainComponent;
  // An INSTANCE_SWAP property bound to `mainComponent` picks the main (09 §8.1, 10.3).
  const ref = source.propertyRefs?.mainComponent;
  const swapTo = ref !== undefined && provider ? resolvedValue(provider, ref) : undefined;
  if (typeof swapTo === 'string') {
    const target = layer.ctx.nodeById(swapTo);
    if (target && target.type === 'COMPONENT' && !target.removed) setNestedMain(layer, target, target !== natural);
  } else if (!layer.swapped && natural) setNestedMain(layer, natural, false);
  const main = layer.mainComponent;
  if (layer.swapped && main && !main.removed) {
    mirrorInto(layer, main, { ownSize: true, skip: PLACEMENT, name: instanceName(main) });
    placeLike(layer, source);
    applyBoundValues(layer, provider);
    syncChildren(layer, main, owner, layer);
    fitToSize(layer, main);
    return;
  }
  mirrorInto(layer, source, { propertyDriven: drivenFields(source) });
  applyBoundValues(layer, provider);
  syncChildren(layer, source, owner, layer);
}

/** Mirrors `template`'s children into `parent`, reusing sublayers by source. */
function syncChildren(parent: NodeState, template: NodeState, owner: NodeState, provider: NodeState | null): void {
  const existing = new Map<NodeState, NodeState>();
  for (const child of parent.children) if (child.source) existing.set(child.source, child);
  const next: NodeState[] = [];
  for (const source of template.children) {
    const layer = existing.get(source) ?? createSublayer(source, owner);
    existing.delete(source);
    layer.parent = parent;
    layer.propertyRefs = source.propertyRefs;
    next.push(layer);
    if (layer.type === 'INSTANCE') {
      syncNested(layer, source, owner, provider);
      continue;
    }
    mirrorInto(layer, source, { propertyDriven: drivenFields(source) });
    applyBoundValues(layer, provider);
    syncChildren(layer, source, owner, provider);
  }
  for (const stale of existing.values()) markRemoved(stale);
  parent.children = next;
}

/** An instance resized away from its main applies its sublayers' constraints (typings:7501-7515). */
function fitToSize(instance: NodeState, main: NodeState): void {
  if (instance.isStack) return;
  const [dw, dh] = [instance.width - main.width, instance.height - main.height];
  if (dw === 0 && dh === 0) return;
  applyConstraints(instance, dw, dh, instance.width / main.width, instance.height / main.height);
}

/** Brings a top-level instance (or a swapped nested one) up to date with its main component. */
export function syncInstance(instance: NodeState): void {
  const main = instance.mainComponent;
  // A deleted main component leaves its instances as they were.
  if (!main || main.removed) return;
  if (instance.owner !== null && instance.source) {
    syncNested(instance, instance.source, instance.owner, providerOf(instance));
    return;
  }
  mirrorInto(instance, main, { ownSize: true, skip: PLACEMENT, name: instanceName(main) });
  syncChildren(instance, main, instance, instance);
  fitToSize(instance, main);
}

/** `ComponentNode.createInstance()`: a new instance on the current page (typings:11213-11216). */
export function createInstanceState(main: NodeState): NodeState {
  const ctx = main.ctx;
  const instance = newState(ctx, 'INSTANCE', ctx.nextId('INSTANCE'), instanceName(main));
  makeView(instance);
  instance.mainComponent = main;
  ctx.instances.add(instance);
  syncInstance(instance);
  return instance;
}

/** A sublayer's place in its instance, for carrying overrides across a swap. */
function pathsOf(instance: NodeState): Map<string, NodeState> {
  const out = new Map<string, NodeState>();
  const walk = (node: NodeState, prefix: string) => {
    const seen = new Map<string, number>();
    for (const child of node.children) {
      const key = `${child.type}:${child.name}`;
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      const path = `${prefix}/${key}#${index}`;
      out.set(path, child);
      walk(child, path);
    }
  };
  walk(instance, '');
  return out;
}

/**
 * Points an instance at another component. `preserve` keeps overrides on sublayers that match by
 * name path, like `swapComponent` ("preserves overrides using the same heuristics as instance swap
 * in the Figma editor UI", typings:11266-11275); assigning `mainComponent` clears them (typings:11262).
 */
export function retarget(instance: NodeState, main: NodeState, preserve: boolean): void {
  const carried = new Map<string, { type: string; overrides: Map<string, unknown> }>();
  if (preserve) {
    for (const [path, layer] of pathsOf(instance))
      carried.set(path, { type: layer.type, overrides: overridesOf(layer) });
  } else {
    instance.mirror = null;
    instance.propertyValues.clear();
  }
  for (const child of instance.children) markRemoved(child);
  instance.children = [];
  if (instance.owner === null) {
    instance.ctx.instances.delete(instance);
    instance.mainComponent = main;
    instance.ctx.instances.add(instance);
  } else {
    setNestedMain(instance, main, main !== instance.source?.mainComponent);
  }
  syncInstance(instance);
  for (const [path, layer] of pathsOf(instance)) {
    const old = carried.get(path);
    if (old && old.type === layer.type) applyOverrides(layer, old.overrides);
  }
}

/**
 * Syncs every instance that mirrors one of `changed` (or an ancestor of one), then the instances
 * that mirror those, and so on. Returns every node the syncs rewrote, for the layout pass.
 */
export function syncDependents(changed: Iterable<NodeState>): Set<NodeState> {
  const touched = new Set<NodeState>();
  const queue = [...changed];
  const synced = new Set<NodeState>();
  const seen = new Set<NodeState>();
  while (queue.length > 0) {
    const node = queue.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    for (let ancestor: NodeState | null = node; ancestor; ancestor = ancestor.parent) {
      // A component set's own changes (name, property definitions) reach its variants' instances.
      const mains =
        ancestor.type === 'COMPONENT'
          ? [ancestor]
          : ancestor === node && node.type === 'COMPONENT_SET'
            ? node.children
            : [];
      for (const instance of mains.flatMap((main) => main.ctx.instances.of(main))) {
        if (synced.has(instance)) continue;
        synced.add(instance);
        syncInstance(instance);
        for (const state of [instance, ...instance.descendants()]) touched.add(state);
        queue.push(instance);
      }
    }
  }
  return touched;
}
