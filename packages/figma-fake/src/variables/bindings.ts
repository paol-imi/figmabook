import { ownerOf } from '../components/properties';
import { fullName } from '../components/types';
import { figmaError } from '../errors';
import { MIN_SIZE, resizeNode } from '../nodes/layout';
import type { NodeState } from '../state';
import type { CharStyle } from '../text-model';
import { deepFreeze } from '../values';
import { FakeVariable, isAlias, type VariableStore } from './store';
import { setRangeBinding, TEXT_FIELDS, writeTextBinding } from './text-bindings';

/**
 * Binds a text field on `[start, end)` (`setRangeBoundVariable`, typings:9977-9990; and
 * `setBoundVariable` with a text field, which binds the whole text). The value is written with the
 * setter rules: the fonts involved must be loaded (08 §8 "Fonts must be loaded before
 * `setRangeBoundVariable` on font fields").
 */
export function bindTextRange(
  state: NodeState,
  store: VariableStore,
  start: number,
  end: number,
  field: VariableBindableTextField,
  variable: FakeVariable | null,
): void {
  const api = 'setRangeBoundVariable';
  if (variable === null) {
    setRangeBinding(state, start, end, [field], null);
    return;
  }
  checkType(api, field, variable, fieldType(field));
  const value = store.resolve(variable);
  if (value === null) throw figmaError(api, `Variable "${variable.name}" has a dangling alias`);
  writeTextBinding(state, start, end, field, value, aliasOf(variable), true);
}

/**
 * Variable bindings of node fields (`setBoundVariable`, `boundVariables`, typings:6692-6740) and
 * of solid paints (`setBoundVariableForPaint`, typings:2255-2266; 08 §8).
 *
 * Binding writes the variable's value into the field ("Binding to a FLOAT changes the node's value
 * to the variable's value in the resolved mode", 08 §8). Writing a literal value to a bound field
 * unbinds it, and when a variable's value changes every bound field takes the new value.
 */

const NODE_FIELDS = [
  'height',
  'width',
  'characters',
  'itemSpacing',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'visible',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'counterAxisSpacing',
  'strokeWeight',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'opacity',
  'gridRowGap',
  'gridColumnGap',
] as const satisfies readonly VariableBindableNodeField[];

const CORNERS = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'] as const;
const SIDES = ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'] as const;

export function isNodeField(field: string): field is VariableBindableNodeField {
  return (NODE_FIELDS as readonly string[]).includes(field);
}

export function isTextField(field: string): field is VariableBindableTextField {
  return (TEXT_FIELDS as readonly string[]).includes(field);
}

/** The variable type a field takes (typings:6968-7003). */
export function fieldType(field: VariableBindableNodeField | VariableBindableTextField): VariableResolvedDataType {
  if (field === 'characters' || field === 'fontFamily' || field === 'fontStyle') return 'STRING';
  if (field === 'visible') return 'BOOLEAN';
  return 'FLOAT';
}

/**
 * The `variable` argument of a binding call: a variable of this document, or `null` to unbind.
 * "Passing a variable ID is deprecated" and throws under dynamic-page (typings:6720-6726).
 */
export function variableArg(api: string, store: VariableStore, variable: unknown): FakeVariable | null {
  if (variable === null) return null;
  if (typeof variable === 'string') {
    throw figmaError(api, 'Cannot call with documentAccess: dynamic-page. Pass a Variable object instead of its id.');
  }
  if (!(variable instanceof FakeVariable) || store.variable(variable.id) !== variable) {
    throw figmaError(api, 'Expected a variable of this document or null');
  }
  return variable;
}

export function checkType(api: string, field: string, variable: FakeVariable, expected: VariableResolvedDataType) {
  if (variable.resolvedType !== expected) {
    throw figmaError(api, `Cannot bind a ${variable.resolvedType} variable to "${field}", which takes ${expected}`);
  }
}

export function aliasOf(variable: FakeVariable): VariableAlias {
  return deepFreeze({ type: 'VARIABLE_ALIAS', id: variable.id });
}

/** "A `cornerRadius` binding … appears in `boundVariables` as `topLeftRadius`/…" on frames and rectangles (typings:6702-6705). */
function storedFields(view: object, field: VariableBindableNodeField): readonly string[] {
  return field === 'cornerRadius' && 'topLeftRadius' in view ? CORNERS : [field];
}

/**
 * `node.setBoundVariable(field, variable)` for node fields: the field must exist on the node and
 * take the variable's type; the value is written through the field's own setter, so its rules
 * (fonts, auto layout) apply.
 */
export function bindNodeField(
  view: object,
  state: NodeState,
  store: VariableStore,
  field: VariableBindableNodeField,
  variable: FakeVariable | null,
): void {
  const api = 'setBoundVariable';
  if (!(field in view)) throw figmaError(api, `Cannot bind "${field}" on a ${state.type} node`);
  if (variable === null) {
    for (const key of storedFields(view, field)) state.bindings.delete(key);
    return;
  }
  checkType(api, field, variable, fieldType(field));
  const value = store.resolve(variable);
  if (value === null) throw figmaError(api, `Variable "${variable.name}" has a dangling alias`);
  state.ctx.silently(() => {
    if (field === 'width' || field === 'height') {
      const size = Math.max(Number(value), MIN_SIZE);
      resizeNode(state, api, field === 'width' ? size : state.width, field === 'height' ? size : state.height, true);
    } else {
      Reflect.set(view, field, value);
    }
  });
  for (const key of storedFields(view, field)) state.bindings.set(key, aliasOf(variable));
}

/** Writes a bound value straight into a node, as Figma does when the variable changes. */
function writeNodeField(state: NodeState, field: string, value: VariableValue): void {
  if (field === 'visible') {
    if (typeof value === 'boolean') state.visible = value;
    return;
  }
  if (field === 'characters') {
    if (state.text && typeof value === 'string') {
      state.text.replace(value);
      if (state.autoRename) state.name = value;
    }
    return;
  }
  if (typeof value !== 'number') return;
  if (field === 'width' || field === 'height') {
    const size = Math.max(value, MIN_SIZE);
    state.ctx.silently(() =>
      resizeNode(
        state,
        'setBoundVariable',
        field === 'width' ? size : state.width,
        field === 'height' ? size : state.height,
        true,
      ),
    );
    return;
  }
  const targets = field === 'cornerRadius' ? CORNERS : field === 'strokeWeight' ? SIDES : [field];
  for (const target of targets) {
    const current: unknown = Reflect.get(state, target);
    if (typeof current === 'number' || current === null) Reflect.set(state, target, value);
  }
}

/** Fields a literal write unbinds: the written property, and the per-side fields of shorthands. */
const LITERAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  cornerRadius: ['cornerRadius', ...CORNERS],
  strokeWeight: ['strokeWeight', ...SIDES],
};

/** Writing a literal value to a bound field removes its binding (called for every logged write). */
export function unbindLiteral(state: NodeState, method: string, property: string | null): void {
  if (state.bindings.size === 0) return;
  let fields: readonly string[] = [];
  if (method === 'set' && property) fields = LITERAL_FIELDS[property] ?? [property];
  else if (method === 'resize' || method === 'resizeWithoutConstraints') fields = ['width', 'height'];
  for (const field of fields) state.bindings.delete(field);
}

/** A copy of a solid paint bound to a color (`setBoundVariableForPaint`, typings:2255-2266). */
function recolor(paint: SolidPaint, value: VariableValue | null): SolidPaint {
  if (value === null || typeof value !== 'object' || isAlias(value) || !('r' in value)) return paint;
  const { r, g, b } = value;
  const a = 'a' in value ? value.a : 1;
  return { ...paint, color: { r, g, b }, opacity: a };
}

/**
 * `figma.variables.setBoundVariableForPaint(paint, 'color', variable)`: "returns a copy of the
 * paint which is now bound to the provided variable" (typings:2255-2266). The paint's colour
 * becomes the variable's value; the variable's alpha becomes the paint opacity (README
 * "Differences", verify S-12). The given paint is not changed.
 */
export function bindPaint(
  store: VariableStore,
  paint: SolidPaint,
  field: VariableBindablePaintField,
  variable: unknown,
): SolidPaint {
  const api = 'setBoundVariableForPaint';
  if (typeof paint !== 'object' || paint === null || paint.type !== 'SOLID') {
    throw figmaError(api, 'Only solid paints can be bound to a variable');
  }
  if (field !== 'color') throw figmaError(api, `Invalid field "${String(field)}": expected "color"`);
  const target = variableArg(api, store, variable);
  const { color: _old, ...others } = paint.boundVariables ?? {};
  if (target === null) return { ...paint, color: { ...paint.color }, boundVariables: others };
  checkType(api, field, target, 'COLOR');
  const bound: SolidPaint = {
    ...paint,
    color: { ...paint.color },
    boundVariables: { ...others, color: aliasOf(target) },
  };
  return recolor(bound, store.resolve(target));
}

function refreshPaints(paints: readonly Paint[], store: VariableStore): readonly Paint[] | null {
  let changed = false;
  const next = paints.map((paint) => {
    const alias = paint.type === 'SOLID' ? paint.boundVariables?.color : undefined;
    if (paint.type !== 'SOLID' || !alias) return paint;
    const updated = recolor(paint, store.resolveAlias(alias));
    if (updated.opacity !== paint.opacity || JSON.stringify(updated.color) !== JSON.stringify(paint.color))
      changed = true;
    return updated;
  });
  return changed ? deepFreeze(next) : null;
}

/** Text runs bound to variables, grouped as `[start, end, field, alias]`. */
function textRuns(styles: readonly CharStyle[]): Array<[number, number, VariableBindableTextField, VariableAlias]> {
  const runs: Array<[number, number, VariableBindableTextField, VariableAlias]> = [];
  for (const field of TEXT_FIELDS) {
    let start = -1;
    let current: VariableAlias | undefined;
    for (let i = 0; i <= styles.length; i++) {
      const alias = styles[i]?.boundVariables[field];
      if (alias?.id === current?.id) continue;
      if (current && start >= 0) runs.push([start, i, field, current]);
      start = i;
      current = alias;
    }
  }
  return runs;
}

/** Every bound field and paint in the document takes its variable's current value (typings:11914). */
export function refreshBindings(nodes: Iterable<NodeState>, store: VariableStore): void {
  for (const state of nodes) {
    if (state.removed) continue;
    // Only nodes with a binding are rewritten and laid out again.
    let bound = state.bindings.size > 0;
    for (const [field, alias] of state.bindings) {
      const value = store.resolveAlias(alias);
      if (value !== null) writeNodeField(state, field, value);
    }
    const text = state.text;
    if (text) {
      for (const [start, end, field, alias] of textRuns(text.styles)) {
        bound = true;
        const value = store.resolveAlias(alias);
        if (value !== null) writeTextBinding(state, start, end, field, value, undefined, false);
      }
      for (let i = 0; i < text.styles.length; i++) {
        const style = text.styles[i];
        const fills = style ? refreshPaints(style.fills, store) : null;
        if (style && fills) {
          text.styles[i] = { ...style, fills };
          bound = true;
        }
      }
    } else {
      const fills = refreshPaints(state.fills, store);
      if (fills) {
        state.fills = fills;
        bound = true;
      }
    }
    const strokes = refreshPaints(state.strokes, store);
    if (strokes) {
      state.strokes = strokes;
      bound = true;
    }
    if (bound) state.ctx.touch(state);
  }
}

type BoundRest = {
  fills?: VariableAlias[];
  strokes?: VariableAlias[];
  effects?: VariableAlias[];
  componentProperties?: { [propertyName: string]: VariableAlias };
  textRangeFills?: VariableAlias[];
};

function paintAliases(paints: readonly Paint[]): VariableAlias[] {
  return paints.flatMap((paint) =>
    paint.type === 'SOLID' && paint.boundVariables?.color ? [paint.boundVariables.color] : [],
  );
}

function unique(aliases: readonly VariableAlias[]): VariableAlias[] {
  const seen = new Map<string, VariableAlias>();
  for (const alias of aliases) seen.set(alias.id, alias);
  return [...seen.values()];
}

/** `boundVariables` (typings:6700-6716). */
export function boundVariablesOf(state: NodeState): NonNullable<SceneNodeMixin['boundVariables']> {
  const node: { [field in VariableBindableNodeField]?: VariableAlias } = {};
  for (const [field, alias] of state.bindings) if (isNodeField(field)) node[field] = alias;
  const text: { [field in VariableBindableTextField]?: VariableAlias[] } = {};
  const rest: BoundRest = {};
  if (state.text) {
    const styles = state.text.styles.length > 0 ? state.text.styles : [state.text.base];
    for (const field of TEXT_FIELDS) {
      const aliases = unique(
        styles.flatMap((style) => (style.boundVariables[field] ? [style.boundVariables[field]] : [])),
      );
      if (aliases.length > 0) text[field] = aliases;
    }
    const fills = unique(styles.flatMap((style) => paintAliases(style.fills)));
    if (fills.length > 0) rest.textRangeFills = fills;
  } else {
    const fills = paintAliases(state.fills);
    if (fills.length > 0) rest.fills = fills;
  }
  const strokes = paintAliases(state.strokes);
  if (strokes.length > 0) rest.strokes = strokes;
  const properties: { [propertyName: string]: VariableAlias } = {};
  const owner = state.mainComponent ? ownerOf(state.mainComponent) : null;
  for (const [id, value] of state.propertyValues) {
    const def = owner?.propertyDefs.get(id);
    if (def && isAlias(value)) properties[fullName(def)] = value;
  }
  if (Object.keys(properties).length > 0) rest.componentProperties = properties;
  return deepFreeze({ ...node, ...text, ...rest });
}
