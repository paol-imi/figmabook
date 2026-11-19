import { createHash } from 'node:crypto';
import { figmaError, unsupported } from '../errors';
import { PluginDataStore } from '../plugin-data';
import { checkEnum, checkString, deepFreeze } from '../values';

/**
 * Local variables and collections (BUILD §8.1 "Variables (subset)"; VariablesAPI,
 * typings:2148-2280; Variable, typings:11769-11982; VariableCollection, typings:11983-12051).
 *
 * Collections have one mode ("Mode 1"); adding and removing modes and explicit node modes are
 * B-139, extended collections and motion types (EASING, TIMING) are hardening. Values are
 * resolved in the collection's default mode.
 */

/** What the store needs from its document: the operation log and binding refresh. */
export interface VariableHost {
  readonly pluginId: string;
  readonly sessionId: number;
  /** Logs a write to a variable or collection (`nodeId` is its id). */
  recordEntity(id: string, method: string, property: string | null, value: unknown): void;
  /** Variable values changed: nodes bound to them take the new values. */
  refreshBindings(): void;
}

const SCOPES = [
  'ALL_SCOPES',
  'TEXT_CONTENT', // diag-check-ignore: Figma VariableScope, not a diagnostic
  'CORNER_RADIUS',
  'WIDTH_HEIGHT',
  'GAP',
  'ALL_FILLS',
  'FRAME_FILL',
  'SHAPE_FILL',
  'TEXT_FILL', // diag-check-ignore: Figma VariableScope, not a diagnostic
  'STROKE_COLOR',
  'STROKE_FLOAT',
  'EFFECT_FLOAT',
  'EFFECT_COLOR',
  'OPACITY',
  'COLOR_OPACITY',
  'FONT_FAMILY', // diag-check-ignore: Figma VariableScope, not a diagnostic
  'FONT_STYLE', // diag-check-ignore: Figma VariableScope, not a diagnostic
  'FONT_WEIGHT', // diag-check-ignore: Figma VariableScope, not a diagnostic
  'FONT_SIZE', // diag-check-ignore: Figma VariableScope, not a diagnostic
  'LINE_HEIGHT',
  'LETTER_SPACING',
  'PARAGRAPH_SPACING',
  'PARAGRAPH_INDENT',
] as const satisfies readonly VariableScope[];

const PLATFORMS = ['WEB', 'ANDROID', 'iOS'] as const satisfies readonly CodeSyntaxPlatform[];

/** The resolved types the slice models (typings:11722). */
const TYPES = ['BOOLEAN', 'COLOR', 'FLOAT', 'STRING'] as const;

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

export function isAlias(value: unknown): value is VariableAlias {
  return (
    isObject(value) && Reflect.get(value, 'type') === 'VARIABLE_ALIAS' && typeof Reflect.get(value, 'id') === 'string'
  );
}

function keyOf(id: string): string {
  return createHash('sha1').update(`holotype-fake-variable-key:${id}`).digest('hex');
}

/** A new variable's value in each mode (README "Differences": verify S-12). */
function initialValue(type: (typeof TYPES)[number]): VariableValue {
  switch (type) {
    case 'BOOLEAN':
      return false;
    case 'FLOAT':
      return 0;
    case 'STRING':
      return '';
    case 'COLOR':
      return deepFreeze({ r: 1, g: 1, b: 1, a: 1 });
  }
}

function unit(api: string, name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw figmaError(api, `Expected "${name}" to be a number between 0 and 1`);
  }
  return value;
}

/** The registry of one document's variables, and alias resolution. */
export class VariableStore {
  readonly collections = new Map<string, FakeVariableCollection>();
  readonly variables = new Map<string, FakeVariable>();
  #counter = 0;

  constructor(readonly host: VariableHost) {}

  nextId(prefix: string): string {
    this.#counter += 1;
    return `${prefix}${this.host.sessionId}:${this.#counter}`;
  }

  liveVariables(): FakeVariable[] {
    return [...this.variables.values()].filter((variable) => !variable.isRemoved);
  }

  liveCollections(): FakeVariableCollection[] {
    return [...this.collections.values()].filter((collection) => !collection.isRemoved);
  }

  variable(id: string): FakeVariable | null {
    const variable = this.variables.get(id);
    return variable && !variable.isRemoved ? variable : null;
  }

  /** The value of `variable` in its collection's default mode, aliases followed. `null` for a dangling alias. */
  resolve(variable: FakeVariable, seen: Set<string> = new Set()): VariableValue | null {
    if (seen.has(variable.id)) return null;
    seen.add(variable.id);
    const value = variable.rawDefault();
    if (value === undefined) return null;
    if (!isAlias(value)) return value;
    const target = this.variable(value.id);
    return target ? this.resolve(target, seen) : null;
  }

  resolveAlias(alias: VariableAlias): VariableValue | null {
    const variable = this.variable(alias.id);
    return variable ? this.resolve(variable) : null;
  }

  /** Whether `variable` reaches `target` through aliases (a cycle if `target` aliases back). */
  reaches(variable: FakeVariable, target: FakeVariable): boolean {
    const seen = new Set<string>();
    const walk = (current: FakeVariable): boolean => {
      if (current === target) return true;
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      return Object.values(current.rawValues()).some((value) => {
        if (!isAlias(value)) return false;
        const next = this.variable(value.id);
        return next ? walk(next) : false;
      });
    };
    return walk(variable);
  }
}

/** Plugin data on variables and collections (`PluginDataMixin`, typings:6524-6579). */
abstract class Entity {
  readonly #data = new PluginDataStore();
  #removed = false;

  constructor(
    protected readonly store: VariableStore,
    readonly id: string,
    readonly kind: 'variable' | 'variable collection',
  ) {}

  get isRemoved(): boolean {
    return this.#removed;
  }

  protected markRemoved(): void {
    this.#removed = true;
  }

  /** Reading or writing a removed variable throws, like a removed node. */
  protected live(): void {
    if (this.#removed) throw figmaError('get', `The ${this.kind} with id "${this.id}" does not exist`);
  }

  protected record(method: string, property: string | null, value: unknown): void {
    this.store.host.recordEntity(this.id, method, property, value);
  }

  getPluginData(key: string): string {
    this.live();
    return this.#data.get('getPluginData', key);
  }

  setPluginData(key: string, value: string): void {
    this.live();
    this.#data.set('setPluginData', this.store.host.pluginId, key, value);
    this.record('setPluginData', key, value);
  }

  getPluginDataKeys(): string[] {
    this.live();
    return [...this.#data.private.keys()];
  }

  getSharedPluginData(namespace: string, key: string): string {
    this.live();
    return this.#data.getShared('getSharedPluginData', namespace, key);
  }

  setSharedPluginData(namespace: string, key: string, value: string): void {
    this.live();
    this.#data.setShared('setSharedPluginData', namespace, key, value);
    this.record('setSharedPluginData', `${namespace}/${key}`, value);
  }

  getSharedPluginDataKeys(namespace: string): string[] {
    this.live();
    return this.#data.sharedKeys('getSharedPluginDataKeys', namespace);
  }

  /** Plugin data for snapshots. */
  dataJson(): { pluginData?: Record<string, string>; sharedPluginData?: Record<string, Record<string, string>> } {
    const out: { pluginData?: Record<string, string>; sharedPluginData?: Record<string, Record<string, string>> } = {};
    if (this.#data.private.size > 0) out.pluginData = Object.fromEntries(this.#data.private);
    if (this.#data.shared.size > 0) {
      out.sharedPluginData = Object.fromEntries(
        [...this.#data.shared].map(([namespace, entries]) => [namespace, Object.fromEntries(entries)]),
      );
    }
    return out;
  }
}

/** `VariableCollection` (typings:11983-12051). */
export class FakeVariableCollection extends Entity implements VariableCollection {
  #name: string;
  #hidden = false;
  readonly #modes: Array<{ modeId: string; name: string }>;
  readonly #variableIds: string[] = [];

  constructor(store: VariableStore, name: string) {
    super(store, store.nextId('VariableCollectionId:'), 'variable collection');
    this.#name = name;
    // A new collection has one mode, "Mode 1" (https://help.figma.com/hc/en-us/articles/15343816063383).
    this.#modes = [{ modeId: store.nextId(''), name: 'Mode 1' }];
    store.collections.set(this.id, this);
  }

  get name(): string {
    this.live();
    return this.#name;
  }

  set name(value: string) {
    this.live();
    this.#name = checkString('set_name', 'name', value);
    this.record('set', 'name', value);
  }

  get hiddenFromPublishing(): boolean {
    this.live();
    return this.#hidden;
  }

  set hiddenFromPublishing(value: boolean) {
    this.live();
    if (typeof value !== 'boolean') throw figmaError('set_hiddenFromPublishing', 'Expected a boolean');
    this.#hidden = value;
    this.record('set', 'hiddenFromPublishing', value);
  }

  async getPublishStatusAsync(): Promise<PublishStatus> {
    this.live();
    return 'UNPUBLISHED';
  }

  get remote(): boolean {
    this.live();
    return false;
  }

  get isExtension(): boolean {
    this.live();
    return false;
  }

  /** A new array on every read, like other array properties (typings:10645-10650). */
  get modes(): Array<{ modeId: string; name: string }> {
    this.live();
    return this.#modes.map((mode) => ({ ...mode }));
  }

  get variableIds(): string[] {
    this.live();
    return this.#variableIds.filter((id) => this.store.variable(id) !== null);
  }

  get defaultModeId(): string {
    this.live();
    return this.#modes[0]?.modeId ?? '';
  }

  get key(): string {
    this.live();
    return keyOf(this.id);
  }

  hasMode(modeId: string): boolean {
    return this.#modes.some((mode) => mode.modeId === modeId);
  }

  modeIds(): string[] {
    return this.#modes.map((mode) => mode.modeId);
  }

  adopt(variable: FakeVariable): void {
    this.#variableIds.push(variable.id);
  }

  extend(_name: string): ExtendedVariableCollection {
    return unsupported('VariableCollection.extend', 'hardening');
  }

  /** "Removes this variable collection and all of its variables from the document" (typings:12030). */
  remove(): void {
    this.live();
    for (const id of this.#variableIds) this.store.variable(id)?.drop();
    this.markRemoved();
    this.record('remove', null, null);
    this.store.host.refreshBindings();
  }

  removeMode(_modeId: string): void {
    unsupported('VariableCollection.removeMode', 'B-139');
  }

  addMode(_name: string): string {
    return unsupported('VariableCollection.addMode', 'B-139');
  }

  renameMode(modeId: string, newName: string): void {
    this.live();
    const mode = this.#modes.find((m) => m.modeId === modeId);
    if (!mode) throw figmaError('renameMode', `The mode "${modeId}" is not in this collection`);
    mode.name = checkString('renameMode', 'newName', newName);
    this.record('renameMode', modeId, newName);
  }
}

/** `Variable` (typings:11769-11982). */
export class FakeVariable extends Entity implements Variable {
  #name: string;
  #description = '';
  #hidden = false;
  #scopes: VariableScope[] = ['ALL_SCOPES'];
  readonly #codeSyntax: { [platform in CodeSyntaxPlatform]?: string } = {};
  readonly #values = new Map<string, VariableValue>();
  readonly #collection: FakeVariableCollection;
  readonly resolvedType: VariableResolvedDataType;

  constructor(store: VariableStore, name: string, collection: FakeVariableCollection, type: (typeof TYPES)[number]) {
    super(store, store.nextId('VariableID:'), 'variable');
    this.#name = name;
    this.#collection = collection;
    this.resolvedType = type;
    for (const modeId of collection.modeIds()) this.#values.set(modeId, initialValue(type));
    store.variables.set(this.id, this);
    collection.adopt(this);
  }

  get name(): string {
    this.live();
    return this.#name;
  }

  set name(value: string) {
    this.live();
    this.#name = checkString('set_name', 'name', value);
    this.record('set', 'name', value);
  }

  get description(): string {
    this.live();
    return this.#description;
  }

  set description(value: string) {
    this.live();
    this.#description = checkString('set_description', 'description', value);
    this.record('set', 'description', value);
  }

  get hiddenFromPublishing(): boolean {
    this.live();
    return this.#hidden;
  }

  set hiddenFromPublishing(value: boolean) {
    this.live();
    if (typeof value !== 'boolean') throw figmaError('set_hiddenFromPublishing', 'Expected a boolean');
    this.#hidden = value;
    this.record('set', 'hiddenFromPublishing', value);
  }

  async getPublishStatusAsync(): Promise<PublishStatus> {
    this.live();
    return 'UNPUBLISHED';
  }

  get remote(): boolean {
    this.live();
    return false;
  }

  get variableCollectionId(): string {
    this.live();
    return this.#collection.id;
  }

  get key(): string {
    this.live();
    return keyOf(this.id);
  }

  /** The default mode's value, without resolving aliases. */
  rawDefault(): VariableValue | undefined {
    return this.#values.get(this.#collection.defaultModeId);
  }

  rawValues(): Record<string, VariableValue> {
    return Object.fromEntries(this.#values);
  }

  /** Resolution in the default mode; the consumer's explicit modes are B-139 (typings:11800-11900). */
  resolveForConsumer(_consumer: SceneNode): { value: VariableValue; resolvedType: VariableResolvedDataType } {
    this.live();
    const value = this.store.resolve(this);
    if (value === null) throw figmaError('resolveForConsumer', `Variable "${this.#name}" has a dangling alias`);
    return { value, resolvedType: this.resolvedType };
  }

  /**
   * "Sets the value of this variable for the provided mode" (typings:11914). The value must match
   * `resolvedType`; an alias must point to a variable of the same type and must not loop back.
   */
  setValueForMode(modeId: string, newValue: VariableValue): void {
    this.live();
    const api = 'setValueForMode';
    if (!this.#collection.hasMode(modeId)) throw figmaError(api, `The mode "${modeId}" is not in this collection`);
    const value = this.#checkValue(api, newValue);
    this.#values.set(modeId, value);
    this.record(api, modeId, value);
    this.store.host.refreshBindings();
  }

  #checkValue(api: string, value: unknown): VariableValue {
    if (isAlias(value)) {
      const target = this.store.variable(value.id);
      if (!target) throw figmaError(api, `The variable "${value.id}" does not exist`);
      if (target.resolvedType !== this.resolvedType) {
        throw figmaError(api, `Cannot alias a ${this.resolvedType} variable to a ${target.resolvedType} variable`);
      }
      if (this.store.reaches(target, this)) throw figmaError(api, 'Aliases cannot form a cycle');
      return deepFreeze({ type: 'VARIABLE_ALIAS', id: value.id });
    }
    switch (this.resolvedType) {
      case 'BOOLEAN':
        if (typeof value !== 'boolean') throw figmaError(api, 'Expected a boolean value for a BOOLEAN variable');
        return value;
      case 'FLOAT':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw figmaError(api, 'Expected a number value for a FLOAT variable');
        }
        return value;
      case 'STRING':
        if (typeof value !== 'string') throw figmaError(api, 'Expected a string value for a STRING variable');
        return value;
      case 'COLOR': {
        if (isObject(value) && 'color' in value) return unsupported('VariableComposedColor', 'hardening');
        if (!isObject(value)) throw figmaError(api, 'Expected an RGB or RGBA value for a COLOR variable');
        const a = Reflect.get(value, 'a');
        // COLOR values are stored as RGBA: an RGB value gets alpha 1.
        return deepFreeze({
          r: unit(api, 'r', Reflect.get(value, 'r')),
          g: unit(api, 'g', Reflect.get(value, 'g')),
          b: unit(api, 'b', Reflect.get(value, 'b')),
          a: a === undefined ? 1 : unit(api, 'a', a),
        });
      }
      default:
        return unsupported(`${this.resolvedType} variables`, 'hardening');
    }
  }

  get valuesByMode(): { [modeId: string]: VariableValue } {
    this.live();
    return this.rawValues();
  }

  /** Removes the variable; bound nodes keep their last values (typings:11921). */
  remove(): void {
    this.live();
    this.drop();
    this.record('remove', null, null);
    this.store.host.refreshBindings();
  }

  drop(): void {
    this.markRemoved();
  }

  get scopes(): Array<VariableScope> {
    this.live();
    return [...this.#scopes];
  }

  /** Picker scopes; they do not restrict binding through the API (typings:11923-11930). */
  set scopes(value: Array<VariableScope>) {
    this.live();
    if (!Array.isArray(value)) throw figmaError('set_scopes', 'Expected an array of scopes');
    this.#scopes = value.map((scope: VariableScope) => checkEnum('set_scopes', 'scope', scope, SCOPES));
    this.record('set', 'scopes', this.#scopes);
  }

  get codeSyntax(): { [platform in CodeSyntaxPlatform]?: string } {
    this.live();
    return { ...this.#codeSyntax };
  }

  /** `'WEB'`, `'ANDROID'` or `'iOS'` (typings:11933-11960). */
  setVariableCodeSyntax(platform: CodeSyntaxPlatform, value: string): void {
    this.live();
    const api = 'setVariableCodeSyntax';
    const key = checkEnum(api, 'platform', platform, PLATFORMS);
    this.#codeSyntax[key] = checkString(api, 'value', value);
    this.record(api, key, value);
  }

  removeVariableCodeSyntax(platform: CodeSyntaxPlatform): void {
    this.live();
    const key = checkEnum('removeVariableCodeSyntax', 'platform', platform, PLATFORMS);
    delete this.#codeSyntax[key];
    this.record('removeVariableCodeSyntax', key, null);
  }

  valuesByModeForCollectionAsync(_collection: VariableCollection): Promise<{ [modeId: string]: VariableValue }> {
    return unsupported('Variable.valuesByModeForCollectionAsync', 'hardening');
  }

  removeOverrideForMode(_extendedModeId: string): void {
    unsupported('Variable.removeOverrideForMode', 'hardening');
  }

  /** Snapshot view: every field that differs from a new variable, plus identity. */
  snapshotJson(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: this.id,
      name: this.#name,
      collection: this.#collection.id,
      resolvedType: this.resolvedType,
      valuesByMode: this.rawValues(),
      ...this.dataJson(),
    };
    if (this.#description) out.description = this.#description;
    if (this.#hidden) out.hiddenFromPublishing = true;
    if (!(this.#scopes.length === 1 && this.#scopes[0] === 'ALL_SCOPES')) out.scopes = [...this.#scopes];
    if (Object.keys(this.#codeSyntax).length > 0) out.codeSyntax = { ...this.#codeSyntax };
    return out;
  }
}

/** A collection as it appears in snapshots. */
export function collectionJson(collection: FakeVariableCollection): Record<string, unknown> {
  return {
    id: collection.id,
    name: collection.name,
    modes: collection.modes,
    defaultModeId: collection.defaultModeId,
    variableIds: collection.variableIds,
    ...(collection.hiddenFromPublishing ? { hiddenFromPublishing: true } : {}),
    ...collection.dataJson(),
  };
}

export { TYPES as VARIABLE_TYPES };
