import { figmaError, unsupported } from '../errors';
import { requireLoaded } from '../fonts';
import type { NodeState } from '../state';
import { deepFreeze } from '../values';
import { isAlias } from '../variables/store';
import { explicitValue, providerOf, retarget, syncInstance } from './instances';
import { fullName, type PropertyDef, type PropertyRefs, type PropertyValue, type StoredPropertyType } from './types';

/**
 * Component properties (ComponentPropertiesMixin, typings:9717-9766; 09 §8;
 * https://developers.figma.com/docs/plugins/working-with-component-properties).
 *
 * Definitions live on the component set, or on a component outside a set. VARIANT properties
 * are the set's variant axes, read from the variant names; BOOLEAN, TEXT and INSTANCE_SWAP
 * properties are stored with a unique id, so their full name is `<name>#<id>`. Internally,
 * references and instance values point at the id, so a rename keeps them (09 §8.1 "Property
 * ids are never renamed").
 */

const STORED: readonly StoredPropertyType[] = ['BOOLEAN', 'TEXT', 'INSTANCE_SWAP'];

function isStoredType(value: unknown): value is StoredPropertyType {
  return typeof value === 'string' && (STORED as readonly string[]).includes(value);
}

/** A component inside a component set. */
export function isVariant(state: NodeState): boolean {
  return state.type === 'COMPONENT' && state.parent?.type === 'COMPONENT_SET';
}

/** The node holding `component`'s property definitions: its set, or itself. */
export function ownerOf(component: NodeState): NodeState {
  return isVariant(component) && component.parent ? component.parent : component;
}

/** Parses a variant name such as `Size=Large, State=Hover` (typings:9670-9715). */
export function parseVariantName(name: string): Record<string, string> | null {
  const properties: Record<string, string> = {};
  for (const part of name.split(',')) {
    const at = part.indexOf('=');
    if (at <= 0) return null;
    properties[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return properties;
}

export function variantPropertiesOf(state: NodeState): { [property: string]: string } | null {
  if (state.parent?.type !== 'COMPONENT_SET') return null;
  return parseVariantName(state.name);
}

function variantName(properties: Record<string, string>): string {
  return Object.entries(properties)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

/** Variant axes with their values in first-seen order (`variantGroupProperties`, typings:11188-11195). */
export function variantGroups(set: NodeState): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const child of set.children) {
    for (const [property, value] of Object.entries(variantPropertiesOf(child) ?? {})) {
      const values = groups.get(property) ?? [];
      if (!values.includes(value)) values.push(value);
      groups.set(property, values);
    }
  }
  return groups;
}

/** "The top-left-most variant, spatially" (typings:11184-11187): smallest y, then smallest x. */
export function defaultVariantOf(set: NodeState): NodeState | null {
  return [...set.children].sort((a, b) => a.y - b.y || a.x - b.x)[0] ?? null;
}

function findStored(owner: NodeState, name: string): PropertyDef | undefined {
  for (const def of owner.propertyDefs.values()) if (fullName(def) === name) return def;
  return undefined;
}

function resolvedDefault(owner: NodeState, def: PropertyDef): string | boolean {
  if (!def.defaultAlias) return def.defaultValue;
  const value = owner.ctx.variables.resolveAlias(def.defaultAlias);
  return typeof value === 'string' || typeof value === 'boolean' ? value : def.defaultValue;
}

/** `componentPropertyDefinitions` (typings:11162-11174). VARIANT axes first, then stored properties. */
export function definitionsOf(owner: NodeState): ComponentPropertyDefinitions {
  const out: ComponentPropertyDefinitions = {};
  if (owner.type === 'COMPONENT_SET') {
    const first = defaultVariantOf(owner);
    const defaults = first ? (variantPropertiesOf(first) ?? {}) : {};
    for (const [name, values] of variantGroups(owner)) {
      out[name] = { type: 'VARIANT', defaultValue: defaults[name] ?? values[0] ?? '', variantOptions: [...values] };
    }
  }
  for (const def of owner.propertyDefs.values()) {
    out[fullName(def)] = {
      type: def.type,
      defaultValue: resolvedDefault(owner, def),
      ...(def.preferredValues ? { preferredValues: def.preferredValues.map((value) => ({ ...value })) } : {}),
      ...(def.defaultAlias ? { boundVariables: { defaultValue: { ...def.defaultAlias } } } : {}),
    };
  }
  return out;
}

/** Variant properties cannot be read or changed on a variant: its set holds them (typings:9719). */
export function requireOwner(api: string, state: NodeState): void {
  if (isVariant(state)) {
    throw figmaError(api, 'Component properties of a variant are defined on its component set. Use the set instead.');
  }
}

function checkName(api: string, name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') throw figmaError(api, 'Expected a non-empty property name');
  return name;
}

/** A VARIANT axis name or value cannot contain `=` or `,`, which separate variant names (09 §7.1). */
function checkVariantText(api: string, what: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || /[=,]/.test(value)) {
    throw figmaError(api, `Invalid variant ${what} "${String(value)}": it cannot be empty or contain "=" or ","`);
  }
  return value.trim();
}

function checkPreferred(api: string, value: unknown): readonly InstanceSwapPreferredValue[] {
  if (!Array.isArray(value)) throw figmaError(api, 'Expected "preferredValues" to be an array');
  return deepFreeze(
    value.map((entry: InstanceSwapPreferredValue) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        (entry.type !== 'COMPONENT' && entry.type !== 'COMPONENT_SET')
      ) {
        throw figmaError(api, 'A preferred value needs type "COMPONENT" or "COMPONENT_SET"');
      }
      if (typeof entry.key !== 'string') throw figmaError(api, 'A preferred value needs a component key');
      return { type: entry.type, key: entry.key };
    }),
  );
}

/** Validates a default value for `type`; TEXT and BOOLEAN accept a variable alias of the matching type. */
function checkDefault(
  api: string,
  owner: NodeState,
  type: StoredPropertyType,
  value: unknown,
): { value: string | boolean; alias: VariableAlias | null } {
  if (isAlias(value)) {
    if (type === 'INSTANCE_SWAP') throw figmaError(api, 'INSTANCE_SWAP defaults cannot be bound to a variable');
    const variable = owner.ctx.variables.resolveAlias(value);
    const alias = deepFreeze<VariableAlias>({ type: 'VARIABLE_ALIAS', id: value.id });
    if (type === 'BOOLEAN' && typeof variable === 'boolean') return { value: variable, alias };
    if (type === 'TEXT' && typeof variable === 'string') return { value: variable, alias };
    throw figmaError(api, `Expected a ${type === 'BOOLEAN' ? 'BOOLEAN' : 'STRING'} variable for a ${type} property`);
  }
  if (type === 'BOOLEAN') {
    if (typeof value !== 'boolean') throw figmaError(api, 'Expected a boolean default value for a BOOLEAN property');
    return { value, alias: null };
  }
  if (typeof value !== 'string') throw figmaError(api, `Expected a string default value for a ${type} property`);
  if (type === 'INSTANCE_SWAP') {
    // "The default value is the target component's node id" (09 §8.1).
    const target = owner.ctx.nodeById(value);
    if (!target || target.removed || target.type !== 'COMPONENT') {
      throw figmaError(api, `INSTANCE_SWAP default "${value}" is not the id of a component`);
    }
  }
  return { value, alias: null };
}

/** `addComponentProperty` (typings:9730-9738). Returns the full name. */
export function addProperty(
  owner: NodeState,
  propertyName: string,
  type: ComponentPropertyType,
  defaultValue: string | boolean | VariableAlias,
  options: ComponentPropertyOptions | undefined,
): string {
  const api = 'addComponentProperty';
  requireOwner(api, owner);
  const name = checkName(api, propertyName);
  if (type === 'SLOT') return unsupported('addComponentProperty(SLOT)', 'B-142');
  if (type === 'VARIANT') return addVariantAxis(owner, name, defaultValue);
  if (!isStoredType(type)) throw figmaError(api, `Invalid property type "${String(type)}"`);
  if (options?.description !== undefined || options?.slotSettings !== undefined) {
    throw figmaError(api, '"description" and "slotSettings" are only supported for SLOT properties');
  }
  if (options?.preferredValues !== undefined && type !== 'INSTANCE_SWAP') {
    throw figmaError(api, '"preferredValues" is only supported for INSTANCE_SWAP properties');
  }
  const checked = checkDefault(api, owner, type, defaultValue);
  const def: PropertyDef = {
    type,
    id: owner.ctx.nextPropertyId(),
    name,
    defaultValue: checked.value,
    defaultAlias: checked.alias,
    preferredValues: options?.preferredValues === undefined ? null : checkPreferred(api, options.preferredValues),
  };
  owner.propertyDefs.set(def.id, deepFreeze(def));
  return fullName(def);
}

/** "Adding a VARIANT property gives every existing variant `Name=Default`" (09 §7.2 "Add an axis"). */
function addVariantAxis(owner: NodeState, name: string, defaultValue: unknown): string {
  const api = 'addComponentProperty';
  if (owner.type !== 'COMPONENT_SET') throw figmaError(api, 'VARIANT properties can only be added to component sets');
  const axis = checkVariantText(api, 'property name', name);
  const value = checkVariantText(api, 'value', defaultValue);
  if (variantGroups(owner).has(axis)) throw figmaError(api, `The variant property "${axis}" already exists`);
  for (const variant of owner.children) {
    variant.name = variantName({ ...(variantPropertiesOf(variant) ?? {}), [axis]: value });
  }
  return axis;
}

/** `editComponentProperty` (typings:9740-9760): name for all types, the rest per type. */
export function editProperty(
  owner: NodeState,
  propertyName: string,
  newValue: {
    name?: string;
    defaultValue?: string | boolean | VariableAlias;
    preferredValues?: InstanceSwapPreferredValue[];
    description?: string;
    slotSettings?: SlotSettings;
  },
): string {
  const api = 'editComponentProperty';
  requireOwner(api, owner);
  if (typeof newValue !== 'object' || newValue === null) throw figmaError(api, 'Expected an object of changes');
  if (newValue.description !== undefined || newValue.slotSettings !== undefined) {
    throw figmaError(api, '"description" and "slotSettings" are only supported for SLOT properties');
  }
  if (owner.type === 'COMPONENT_SET' && variantGroups(owner).has(propertyName)) {
    if (newValue.defaultValue !== undefined || newValue.preferredValues !== undefined) {
      throw figmaError(api, 'Only "name" can be edited on a VARIANT property');
    }
    if (newValue.name === undefined) return propertyName;
    const renamed = checkVariantText(api, 'property name', newValue.name);
    if (renamed !== propertyName && variantGroups(owner).has(renamed)) {
      throw figmaError(api, `The variant property "${renamed}" already exists`);
    }
    for (const variant of owner.children) {
      const entries = Object.entries(variantPropertiesOf(variant) ?? {}).map(([key, value]): [string, string] => [
        key === propertyName ? renamed : key,
        value,
      ]);
      variant.name = variantName(Object.fromEntries(entries));
    }
    return renamed;
  }
  const def = findStored(owner, propertyName);
  if (!def) throw figmaError(api, `Component property "${propertyName}" does not exist`);
  let next: PropertyDef = def;
  if (newValue.name !== undefined) next = { ...next, name: checkName(api, newValue.name) };
  if (newValue.defaultValue !== undefined) {
    const checked = checkDefault(api, owner, def.type, newValue.defaultValue);
    next = { ...next, defaultValue: checked.value, defaultAlias: checked.alias };
  }
  if (newValue.preferredValues !== undefined) {
    if (def.type !== 'INSTANCE_SWAP')
      throw figmaError(api, '"preferredValues" is only supported for INSTANCE_SWAP properties');
    next = { ...next, preferredValues: checkPreferred(api, newValue.preferredValues) };
  }
  owner.propertyDefs.set(def.id, deepFreeze(next));
  return fullName(next);
}

/** Every component node that can reference `owner`'s properties: the owner and its variants, with their subtrees. */
function ownerNodes(owner: NodeState): NodeState[] {
  return [owner, ...owner.descendants()];
}

/** `deleteComponentProperty` (typings:9761-9765): not for VARIANT; references to it are cleared. */
export function deleteProperty(owner: NodeState, propertyName: string): void {
  const api = 'deleteComponentProperty';
  requireOwner(api, owner);
  if (owner.type === 'COMPONENT_SET' && variantGroups(owner).has(propertyName)) {
    throw figmaError(api, 'VARIANT properties cannot be deleted: rename or remove the variants instead');
  }
  const def = findStored(owner, propertyName);
  if (!def) throw figmaError(api, `Component property "${propertyName}" does not exist`);
  owner.propertyDefs.delete(def.id);
  for (const node of ownerNodes(owner)) {
    const refs = node.propertyRefs;
    if (!refs) continue;
    const kept = Object.entries(refs).filter(([, id]) => id !== def.id);
    node.propertyRefs = kept.length > 0 ? deepFreeze(Object.fromEntries(kept)) : null;
  }
}

/** The component whose properties `state` (a component sublayer) can reference. */
function referenceOwner(state: NodeState): NodeState | null {
  if (state.inInstance) {
    const main = providerOf(state)?.mainComponent;
    return main ? ownerOf(main) : null;
  }
  for (let node = state.parent; node; node = node.parent) if (node.type === 'COMPONENT') return ownerOf(node);
  return null;
}

/**
 * `componentPropertyReferences` read (typings:6682-6690): "A node can only have
 * componentPropertyReferences if it is a component sublayer or an instance sublayer. It will be
 * null otherwise."
 */
export function referencesOf(
  state: NodeState,
): { [field in 'visible' | 'characters' | 'mainComponent']?: string } | null {
  const owner = referenceOwner(state);
  if (!owner) return null;
  const out: { [field in 'visible' | 'characters' | 'mainComponent']?: string } = {};
  for (const [field, id] of Object.entries(state.propertyRefs ?? {})) {
    const def = owner.propertyDefs.get(id);
    if (def && (field === 'visible' || field === 'characters' || field === 'mainComponent')) out[field] = fullName(def);
  }
  return out;
}

const FIELD_TYPES: Readonly<Record<keyof PropertyRefs, StoredPropertyType>> = {
  visible: 'BOOLEAN',
  characters: 'TEXT',
  mainComponent: 'INSTANCE_SWAP',
};

/** `componentPropertyReferences =`: binds node fields to the containing component's properties (09 §8.1). */
export function setReferences(state: NodeState, value: unknown): PropertyRefs | null {
  const api = 'set_componentPropertyReferences';
  if (state.inInstance) throw figmaError(api, 'Cannot set component property references on a layer inside an instance');
  const owner = referenceOwner(state);
  if (!owner) throw figmaError(api, 'Component property references can only be set on layers inside a component');
  if (value === null) return null;
  if (typeof value !== 'object') throw figmaError(api, 'Expected an object or null');
  const refs: { -readonly [field in keyof PropertyRefs]?: string } = {};
  for (const [field, name] of Object.entries(value)) {
    if (field !== 'visible' && field !== 'characters' && field !== 'mainComponent') {
      throw figmaError(api, `Invalid field "${field}": expected "visible", "characters" or "mainComponent"`);
    }
    if (typeof name !== 'string') throw figmaError(api, `Expected a property name for "${field}"`);
    const def = findStored(owner, name);
    if (!def) throw figmaError(api, `Component property "${name}" does not exist on the containing component`);
    if (def.type !== FIELD_TYPES[field]) {
      throw figmaError(api, `"${field}" can only reference a ${FIELD_TYPES[field]} property, not ${def.type}`);
    }
    if (field === 'characters' && state.type !== 'TEXT')
      throw figmaError(api, '"characters" can only be set on text layers');
    if (field === 'mainComponent' && state.type !== 'INSTANCE') {
      throw figmaError(api, '"mainComponent" can only be set on instances');
    }
    refs[field] = def.id;
  }
  return Object.keys(refs).length > 0 ? deepFreeze(refs) : null;
}

/** `InstanceNode.componentProperties` (typings:11291-11295, 11234-11243). */
export function instanceProperties(instance: NodeState): ComponentProperties {
  const main = instance.mainComponent;
  if (!main) return {};
  const out: ComponentProperties = {};
  for (const [name, value] of Object.entries(variantPropertiesOf(main) ?? {})) out[name] = { type: 'VARIANT', value };
  const owner = ownerOf(main);
  for (const def of owner.propertyDefs.values()) {
    const value = explicitValue(instance, def.id);
    let resolved: string | boolean = resolvedDefault(owner, def);
    if (value !== undefined && isAlias(value)) {
      const variable = owner.ctx.variables.resolveAlias(value);
      if (typeof variable === 'string' || typeof variable === 'boolean') resolved = variable;
    } else if (value !== undefined) resolved = value;
    out[fullName(def)] = {
      type: def.type,
      value: resolved,
      ...(def.preferredValues ? { preferredValues: def.preferredValues.map((entry) => ({ ...entry })) } : {}),
      ...(value !== undefined && isAlias(value) ? { boundVariables: { value: { ...value } } } : {}),
    };
  }
  return out;
}

/** Text sublayers of `instance` bound to property `id`: their fonts must be loaded to change it. */
function boundTexts(instance: NodeState, id: string): NodeState[] {
  return instance.descendants().filter((node) => node.text && node.propertyRefs?.characters === id);
}

/**
 * `InstanceNode.setProperties` (typings:11283-11290): VARIANT names first ("prioritizes updating
 * the VARIANT type properties"), unspecified properties keep their values. A VARIANT change
 * swaps to the variant with the new values; there must be one.
 */
export function setInstanceProperties(instance: NodeState, properties: unknown): void {
  const api = 'setProperties';
  if (typeof properties !== 'object' || properties === null) throw figmaError(api, 'Expected an object of properties');
  const main = instance.mainComponent;
  if (!main || main.removed) throw figmaError(api, 'The instance has no main component');
  const owner = ownerOf(main);
  const axes = owner.type === 'COMPONENT_SET' ? variantGroups(owner) : new Map<string, string[]>();
  const variant: Record<string, string> = { ...(variantPropertiesOf(main) ?? {}) };
  const values = new Map<string, PropertyValue>();
  let variantChanged = false;
  for (const [name, value] of Object.entries(properties)) {
    if (axes.has(name)) {
      if (typeof value !== 'string')
        throw figmaError(api, `Expected a string value for the VARIANT property "${name}"`);
      variantChanged ||= variant[name] !== value;
      variant[name] = value;
      continue;
    }
    const def = findStored(owner, name);
    if (!def) throw figmaError(api, `Could not find a component property with name: '${name}'`);
    values.set(def.id, checkInstanceValue(api, instance, def, value));
    if (def.type === 'TEXT') {
      for (const text of boundTexts(instance, def.id)) requireLoaded(api, instance.ctx.fonts, text.text?.fonts() ?? []);
    }
  }
  if (variantChanged) {
    const keys = Object.keys(variant);
    const target = owner.children.find((child) => {
      const props = variantPropertiesOf(child);
      return props !== null && Object.keys(props).length === keys.length && keys.every((k) => props[k] === variant[k]);
    });
    if (!target) throw figmaError(api, `Unable to find a variant with the property values ${variantName(variant)}`);
    retarget(instance, target, true);
  }
  for (const [id, value] of values) instance.propertyValues.set(id, value);
  syncInstance(instance);
}

function checkInstanceValue(api: string, instance: NodeState, def: PropertyDef, value: unknown): PropertyValue {
  if (isAlias(value)) {
    if (def.type === 'INSTANCE_SWAP') throw figmaError(api, 'INSTANCE_SWAP values cannot be bound to a variable');
    const resolved = instance.ctx.variables.resolveAlias(value);
    const wanted = def.type === 'BOOLEAN' ? 'boolean' : 'string';
    if (typeof resolved !== wanted) throw figmaError(api, `Expected a ${wanted} variable for "${fullName(def)}"`);
    return deepFreeze({ type: 'VARIABLE_ALIAS', id: value.id });
  }
  if (def.type === 'BOOLEAN') {
    if (typeof value !== 'boolean') throw figmaError(api, `Expected a boolean value for "${fullName(def)}"`);
    return value;
  }
  if (typeof value !== 'string') throw figmaError(api, `Expected a string value for "${fullName(def)}"`);
  if (def.type === 'INSTANCE_SWAP') {
    const target = instance.ctx.nodeById(value);
    if (!target || target.removed || target.type !== 'COMPONENT') {
      throw figmaError(api, `"${value}" is not the id of a component`);
    }
  }
  return value;
}
