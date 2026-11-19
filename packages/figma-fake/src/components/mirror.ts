import { jsonEqual } from '../json';
import type { NodeState } from '../state';
import type { CharStyle } from '../text-model';

/**
 * Copying a main component's properties into its instances.
 *
 * "An instance … reflects" its main component (typings:11251-11262): every property of an
 * instance sublayer follows the main component unless the instance overrides it. The fake keeps
 * the values it last copied from the source in `NodeState.mirror`; at the next sync a field
 * whose value still equals that copy follows the source again, and a field that differs is an
 * override and is kept (README "Differences": an override equal to the inherited value is not
 * told apart from no override; the full override model is B-125).
 */

/** Fields that belong to the node itself: identity, structure, plugin data, instance and owner state. */
const OWN = new Set<string>([
  'ctx',
  'type',
  'id',
  'views',
  'removed',
  'parent',
  'children',
  'pluginData',
  'sharedPluginData',
  'relaunchData',
  'mainComponent',
  'source',
  'owner',
  'swapped',
  'mirror',
  'propertyValues',
  'propertyDefs',
  'propertyRefs',
  'bindings',
  'text',
  'transform',
  'width',
  'height',
  // Page-only fields.
  'loaded',
  'pageBackgrounds',
  'prototypeBackgrounds',
  'selection',
  'flowStartingPoints',
]);

/** How an instance root sits in its own parent: never copied from the main component. */
export const PLACEMENT = ['layoutAlign', 'layoutGrow', 'layoutPositioning', 'constraints', 'devStatus'] as const;

let mirrored: readonly string[] | null = null;

/** Every plain data field of `NodeState` that an instance copies, read from a live state's keys. */
function mirroredFields(sample: NodeState): readonly string[] {
  if (!mirrored) mirrored = Object.keys(sample).filter((key) => !OWN.has(key));
  return mirrored;
}

interface TextSnapshot {
  readonly styles: readonly CharStyle[];
  readonly base: CharStyle;
}

function read(state: NodeState, field: string): unknown {
  switch (field) {
    case 'characters':
      return state.text?.characters ?? null;
    case 'textStyles':
      return state.text ? ({ styles: [...state.text.styles], base: state.text.base } satisfies TextSnapshot) : null;
    case 'bindings':
      return [...state.bindings.entries()];
    case 'width':
      return state.width;
    case 'height':
      return state.height;
    default:
      return Reflect.get(state, field);
  }
}

function isTextSnapshot(value: unknown): value is TextSnapshot {
  return typeof value === 'object' && value !== null && 'styles' in value && 'base' in value;
}

function isBindingEntries(value: unknown): value is Array<[string, VariableAlias]> {
  return Array.isArray(value);
}

function write(state: NodeState, field: string, value: unknown): void {
  switch (field) {
    case 'characters':
      if (state.text && typeof value === 'string') state.text.characters = value;
      return;
    case 'textStyles':
      if (state.text && isTextSnapshot(value)) {
        state.text.styles = [...value.styles];
        state.text.base = value.base;
      }
      return;
    case 'bindings':
      if (isBindingEntries(value)) state.bindings = new Map(value);
      return;
    case 'width':
    case 'height':
      if (typeof value === 'number') state[field === 'width' ? 'width' : 'height'] = value;
      return;
    default:
      Reflect.set(state, field, value);
  }
}

/** What a sync copies besides the mirrored fields. */
export interface MirrorOptions {
  /** Copy `width`/`height` with override detection (instance roots); otherwise sizes follow the source. */
  readonly ownSize?: boolean;
  /** Fields driven by a component property this sync: never overrides (09 §8.1). */
  readonly propertyDriven?: ReadonlySet<string>;
  /** Fields not copied at all (an instance root's placement). */
  readonly skip?: readonly string[];
  /** The name the node takes when it is not renamed (an instance of a variant is named after its set). */
  readonly name?: string;
}

/** Copies `source` into `target`, keeping every field the target overrides. */
export function mirrorInto(target: NodeState, source: NodeState, options: MirrorOptions = {}): void {
  const base = target.mirror;
  const next = new Map<string, unknown>();
  const fields = [...mirroredFields(source), 'bindings', ...(source.text ? ['textStyles', 'characters'] : [])];
  if (options.ownSize) fields.push('width', 'height');
  const skip = new Set(options.skip ?? []);
  for (const field of fields) {
    if (skip.has(field)) continue;
    const incoming = field === 'name' && options.name !== undefined ? options.name : read(source, field);
    next.set(field, incoming);
    const overridden =
      base?.has(field) === true &&
      !options.propertyDriven?.has(field) &&
      !jsonEqual(read(target, field), base.get(field));
    if (!overridden) write(target, field, incoming);
  }
  if (!options.ownSize) {
    // Sublayer geometry follows the source; the instance's own layout and constraints then apply.
    target.transform = source.transform;
    target.width = source.width;
    target.height = source.height;
  }
  target.mirror = next;
  keepStylesAligned(target);
}

/**
 * Characters and styles are mirrored separately, so an override of one can meet new values of
 * the other: keep one style per character (`TextModel` invariant), extending with the last style.
 */
function keepStylesAligned(target: NodeState): void {
  const text = target.text;
  if (!text || text.styles.length === text.characters.length) return;
  const last = text.styles[text.styles.length - 1] ?? text.base;
  text.styles = Array.from({ length: text.characters.length }, (_, i) => text.styles[i] ?? last);
}

/**
 * Copies every property of `source` onto `target` (no override detection), with geometry and
 * plugin data: `createComponentFromNode` "preserving all of its properties" (typings:1104-1120).
 */
export function copyNode(target: NodeState, source: NodeState): void {
  for (const field of mirroredFields(source)) write(target, field, read(source, field));
  target.transform = source.transform;
  target.width = source.width;
  target.height = source.height;
  target.bindings = new Map(source.bindings);
  target.pluginData = new Map(source.pluginData);
  target.sharedPluginData = new Map([...source.sharedPluginData].map(([ns, entries]) => [ns, new Map(entries)]));
  target.relaunchData = source.relaunchData;
}

/** Re-reads `fields` of `target` into its mirror, so values a property just wrote do not count as overrides. */
export function rebase(target: NodeState, fields: readonly string[]): void {
  for (const field of fields) target.mirror?.set(field, read(target, field));
}

/** The fields of `target` that differ from what it last copied: its overrides. */
export function overridesOf(target: NodeState): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [field, value] of target.mirror ?? []) {
    const current = read(target, field);
    if (!jsonEqual(current, value)) out.set(field, current);
  }
  return out;
}

/** Writes overrides captured by {@link overridesOf} onto another node (instance swap). */
export function applyOverrides(target: NodeState, overrides: ReadonlyMap<string, unknown>): void {
  for (const [field, value] of overrides) {
    if (field === 'characters' || field === 'textStyles') {
      if (!target.text) continue;
    }
    write(target, field, value);
  }
  keepStylesAligned(target);
}
