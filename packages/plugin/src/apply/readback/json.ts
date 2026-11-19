/*
 * Plugin API values → plain JSON for the read-back groups (06 §6 "ah"). Figma returns frozen
 * objects with every optional field filled in; these helpers copy them into fresh JSON and
 * take the variable bindings out, because bindings belong to the `bind` group, not to the
 * group of the value they bind (one field, one group).
 */
import type { JsonValue } from '@holotype/ir';

export type JsonObject = { [key: string]: JsonValue };

/** A deep JSON copy of plain Plugin API data: `undefined` members are dropped. */
export function toJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === 'object') {
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = toJson(item);
    return out;
  }
  throw new TypeError(`readGroups: a ${typeof value} is not Plugin API data`);
}

/** Whether a value is a `VariableAlias`. */
export function isAlias(value: unknown): value is VariableAlias {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<VariableAlias>).type === 'VARIABLE_ALIAS' &&
    typeof (value as Partial<VariableAlias>).id === 'string'
  );
}

/** Copies `source` without `boundVariables` and without the members `skip` says are defaults. */
function copyWithout(source: object, skip: (key: string, value: unknown) => boolean): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'boundVariables' || value === undefined || skip(key, value)) continue;
    out[key] = key === 'gradientStops' && Array.isArray(value) ? value.map(stopJson) : toJson(value);
  }
  return out;
}

const stopJson = (stop: ColorStop): JsonValue => copyWithout(stop, () => false);

/**
 * A paint as Figma stores it, minus its bindings and the optional members at their defaults
 * (`visible: true`, `blendMode: 'NORMAL'`), which the Plugin API fills in on read.
 */
export function paintJson(paint: Paint): JsonObject {
  return copyWithout(
    paint,
    (key, value) => (key === 'visible' && value === true) || (key === 'blendMode' && value === 'NORMAL'),
  );
}

/** An effect minus its bindings; `showShadowBehindNode: false` is its default. */
export function effectJson(effect: Effect): JsonObject {
  return copyWithout(effect, (key, value) => key === 'showShadowBehindNode' && value === false);
}

/**
 * The variable bound to each solid paint's color, in paint order (`null` for an unbound
 * paint), or `undefined` when no paint is bound (06 §6: `bind.fills: [id]`).
 */
export function paintBindings(paints: readonly Paint[]): JsonValue[] | undefined {
  const ids = paints.map((paint) => (paint.type === 'SOLID' && paint.boundVariables?.color?.id) || null);
  return ids.some((id) => id !== null) ? ids : undefined;
}

/** `{ field: variableId }` of an effect's bindings, or `null` when it has none. */
function effectBinding(effect: Effect): JsonObject | null {
  const out: JsonObject = {};
  const bindings = 'boundVariables' in effect ? effect.boundVariables : undefined;
  for (const [field, alias] of Object.entries(bindings ?? {})) if (isAlias(alias)) out[field] = alias.id;
  return Object.keys(out).length > 0 ? out : null;
}

/** Per-effect bindings in effect order, or `undefined` when no effect is bound. */
export function effectBindings(effects: readonly Effect[]): JsonValue[] | undefined {
  const bound = effects.map(effectBinding);
  return bound.some((item) => item !== null) ? bound : undefined;
}

/** `{ field: variableId }` of a map of single aliases (node fields, a text segment). */
export function aliasIds(bindings: object): JsonObject {
  const out: JsonObject = {};
  for (const [field, alias] of Object.entries(bindings)) if (isAlias(alias)) out[field] = alias.id;
  return out;
}
