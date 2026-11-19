import type { JsonValue } from '@holotype/ir';
import type { ComponentModel } from '../identify/components';
import { field, isObject, sameJson, sortedKeys } from '../identify/json';
import type { DcrChange, DcrProperty } from '../schema';
import { type ComponentNames, dcrDiagnostic, type ItemDraft } from './context';
import { ARROW, argName, camelCase, DOT, figmaValue } from './text';
import { propertyName, propertySuffix } from './usage';

/*
 * Component properties against the set's snapshot (15 §3.2, §4.4): a property Figma knows by
 * the same `#id` is the same property, so a new name is a rename (`property.changed`, keyed by
 * the Holotype key `arg:showIcon`); a new `#id` is `property.added` (keyed by Figma's id). A
 * new value on a variant axis is the `variant.added` that introduced it, so axes report only
 * new and lost axes. The layer references a new or renamed property brings are part of it.
 */

type PropertyType = DcrProperty['type'];

interface CurrentProperty {
  readonly id: string;
  readonly name: string;
  readonly type: PropertyType;
  readonly default?: JsonValue;
  readonly values?: string[];
}

export interface PropertyChanges {
  readonly drafts: ItemDraft[];
  /** Figma ids of new properties. */
  readonly added: ReadonlySet<string>;
  /** Figma ids of properties that are gone. */
  readonly removed: ReadonlySet<string>;
}

const REFERENCE = 'bind.componentPropertyReferences.';

/** Whether a layer-reference change belongs to a property item (a rename, a new or a lost property). */
export function isAbsorbedReference(change: DcrChange, properties: PropertyChanges): boolean {
  if (!change.field.startsWith(REFERENCE)) return false;
  const before = typeof change.before === 'string' ? change.before : undefined;
  const after = typeof change.after === 'string' ? change.after : undefined;
  if (before !== undefined && after !== undefined) return propertySuffix(before) === propertySuffix(after);
  if (after !== undefined) return properties.added.has(after);
  return before !== undefined && properties.removed.has(before);
}

const PROPERTY_TYPES: ReadonlySet<string> = new Set(['VARIANT', 'BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'SLOT']);

/** The set's current property definitions (Plugin API `componentPropertyDefinitions`). */
function currentProperties(defs: JsonValue | undefined): CurrentProperty[] {
  if (!isObject(defs)) return [];
  return sortedKeys(defs).flatMap((id) => {
    const def = defs[id];
    const type = field(def, 'type');
    if (typeof type !== 'string' || !PROPERTY_TYPES.has(type)) return [];
    const fallback = field(def, 'defaultValue');
    const options = field(def, 'variantOptions');
    return [
      {
        id,
        name: type === 'VARIANT' ? id : propertyName(id),
        type: type as PropertyType,
        ...(fallback === undefined ? {} : { default: fallback }),
        ...(Array.isArray(options) ? { values: options.filter((o): o is string => typeof o === 'string') } : {}),
      },
    ];
  });
}

const typeWord = (type: string) => type.toLowerCase().replace('_', ' ');

export function classifyProperties(model: ComponentModel, names: ComponentNames): PropertyChanges {
  const empty: PropertyChanges = { drafts: [], added: new Set(), removed: new Set() };
  const snapshot = model.setBaseline?.props;
  if (snapshot === undefined) return empty;
  const current = currentProperties(model.set.component?.propertyDefs);
  const plain = current.filter((property) => property.type !== 'VARIANT');
  const drafts: ItemDraft[] = [];
  const added = new Set<string>();
  const removed = new Set<string>();
  const matched = new Set<string>();
  const target = (key: string) => ({ sid: model.sid, key, figmaNodeId: model.set.id });

  for (const key of sortedKeys(snapshot.properties)) {
    const applied = snapshot.properties[key];
    if (!applied) continue;
    const found =
      plain.find((property) => property.id === applied.id) ??
      plain.find((property) => propertySuffix(property.id) === propertySuffix(applied.id));
    const appliedName = propertyName(applied.id);
    if (!found) {
      removed.add(applied.id);
      drafts.push(lost(model, names, key, appliedName));
      continue;
    }
    matched.add(found.id);
    const renamed = found.name !== appliedName;
    const retyped = found.type !== applied.type;
    const redefaulted = !sameJson(found.default, applied.default);
    if (!renamed && !retyped && !redefaulted) continue;
    const previous: NonNullable<DcrProperty['previous']> = {};
    if (renamed) previous.name = appliedName;
    if (redefaulted && applied.default !== undefined) previous.default = applied.default;
    const arg = argName(key);
    const code: string[] = [];
    const designer: string[] = [];
    if (renamed) {
      code.push(`property ${arg} renamed: ${appliedName} ${ARROW} ${found.name}`);
      designer.push(`property ${appliedName} renamed to ${found.name}`);
    }
    if (retyped) {
      code.push(`property ${arg} type ${applied.type} ${ARROW} ${found.type}`);
      designer.push(`property ${found.name} is now ${typeWord(found.type)}`);
    }
    if (redefaulted) {
      const change = `${figmaValue(applied.default)} ${ARROW} ${figmaValue(found.default)}`;
      code.push(`property ${arg} default ${change}`);
      designer.push(`property ${found.name} default ${change}`);
    }
    drafts.push({
      item: {
        kind: 'property.changed',
        title: `${names.code} ${DOT} ${code.join(', ')}`,
        designerTitle: `${names.designer} ${DOT} ${designer.join(', ')}`,
        target: target(key),
        property: {
          type: found.type,
          name: found.name,
          ...(found.default === undefined ? {} : { default: found.default }),
          previous,
        },
        acceptance: { type: 'structure', story: 'existing' },
      },
      before: false,
      questions: [],
      headline: `${names.designer}: ${designer.join(', ')}`,
    });
  }

  for (const property of plain) {
    if (matched.has(property.id)) continue;
    added.add(property.id);
    drafts.push(newProperty(model, names, property, property.id));
  }

  const axes = new Set(snapshot.axes.map((axis) => axis.name));
  const variantAxes = current.filter((property) => property.type === 'VARIANT');
  for (const property of variantAxes) {
    if (!axes.has(property.name)) drafts.push(newProperty(model, names, property, property.id));
  }
  const now = new Set(variantAxes.map((property) => property.name));
  for (const axis of snapshot.axes) if (!now.has(axis.name)) drafts.push(lost(model, names, axis.key, axis.name));
  return { drafts, added, removed };
}

function newProperty(model: ComponentModel, names: ComponentNames, property: CurrentProperty, key: string): ItemDraft {
  const word = typeWord(property.type);
  return {
    item: {
      kind: 'property.added',
      title: `${names.code} ${DOT} new ${property.type} property ${camelCase(property.name)}`,
      designerTitle: `${names.designer} ${DOT} new property ${property.name} (${word})`,
      target: { sid: model.sid, key, figmaNodeId: model.set.id },
      property: {
        type: property.type,
        name: property.name,
        ...(property.values === undefined ? {} : { values: property.values }),
        ...(property.default === undefined ? {} : { default: property.default }),
      },
      acceptance: { type: 'structure', story: 'must-add' },
    },
    before: false,
    questions: [],
    headline: `${names.designer}: new ${word} property ${property.name}`,
  };
}

/** A property or axis that is gone: no item kind removes a prop (D-20), so it is listed raw. */
function lost(model: ComponentModel, names: ComponentNames, key: string, name: string): ItemDraft {
  return {
    item: {
      kind: 'unknown',
      title: `${names.code} ${DOT} unclassified change: property ${argName(key)} removed`,
      designerTitle: `${names.designer} ${DOT} property ${name} removed`,
      target: { sid: model.sid, key, figmaNodeId: model.set.id },
      acceptance: { type: 'structure', story: 'existing' },
      diagnostics: [dcrDiagnostic('DCR_UNKNOWN_CHANGE', { sid: model.sid, property: name, value: 'removed' })],
    },
    before: false,
    questions: [],
    headline: `${names.designer}: 1 change Holotype cannot classify (property ${name} removed)`,
  };
}
