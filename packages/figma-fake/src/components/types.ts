/**
 * Component property data (typings:11134-11243). Shared by component sets, components and
 * instances; kept in its own module so `state.ts` can name the types without an import cycle.
 */

/** A value of a BOOLEAN, TEXT or INSTANCE_SWAP property, or a variable bound to it (typings:11283-11290). */
export type PropertyValue = string | boolean | VariableAlias;

/** The property types stored on an owner. VARIANT properties are derived from variant names. */
export type StoredPropertyType = 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP';

/** One BOOLEAN, TEXT or INSTANCE_SWAP definition. Its full name is `<name>#<id>` (typings:9719). */
export interface PropertyDef {
  readonly type: StoredPropertyType;
  /** The unique suffix after `#`; it never changes, so a rename keeps instance values. */
  readonly id: string;
  readonly name: string;
  readonly defaultValue: string | boolean;
  /** Set when the default value is bound to a variable (`ComponentPropertyDefinitions.boundVariables`). */
  readonly defaultAlias: VariableAlias | null;
  /** INSTANCE_SWAP only (typings:9741-9746). */
  readonly preferredValues: readonly InstanceSwapPreferredValue[] | null;
}

/** `componentPropertyReferences` (typings:6682-6690): node field → full property name. */
export type PropertyRefs = Readonly<{ visible?: string; characters?: string; mainComponent?: string }>;

/** The node fields a component property can drive. */
export type ReferenceField = keyof PropertyRefs;

/** `Label#1:2`: the name every property API takes for a non-VARIANT property (typings:9719). */
export function fullName(def: PropertyDef): string {
  return `${def.name}#${def.id}`;
}
