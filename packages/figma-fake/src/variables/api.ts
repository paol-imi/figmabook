import { figmaError, unsupported } from '../errors';
import { checkEnum, checkString } from '../values';
import { bindPaint } from './bindings';
import { FakeVariable, FakeVariableCollection, VARIABLE_TYPES, type VariableStore } from './store';

/** The members of `figma.variables` in the port (BUILD §8.1 "Variables (subset)", 09 §4). */
export type VariablesPort = Pick<
  VariablesAPI,
  | 'createVariableCollection'
  | 'createVariable'
  | 'createVariableAlias'
  | 'getLocalVariablesAsync'
  | 'getLocalVariableCollectionsAsync'
  | 'getVariableByIdAsync'
  | 'setBoundVariableForPaint'
>;

const ALL_TYPES = ['BOOLEAN', 'COLOR', 'EASING', 'FLOAT', 'STRING', 'TIMING'] as const;

/** `figma.variables` (typings:2148-2280). */
export class FakeVariablesApi implements VariablesPort {
  constructor(readonly store: VariableStore) {}

  /** "If not found or the provided ID is invalid, returns a promise containing `null`" (typings:2150-2154). */
  async getVariableByIdAsync(id: string): Promise<Variable | null> {
    return this.store.variable(id);
  }

  /** Local variables, optionally of one resolved type, in creation order (typings:2173-2178). */
  async getLocalVariablesAsync(type?: VariableResolvedDataType): Promise<Variable[]> {
    if (type !== undefined) checkEnum('getLocalVariablesAsync', 'type', type, ALL_TYPES);
    return this.store.liveVariables().filter((variable) => type === undefined || variable.resolvedType === type);
  }

  async getLocalVariableCollectionsAsync(): Promise<VariableCollection[]> {
    return this.store.liveCollections();
  }

  /** "Creates a new variable collection with the given name" (typings:2215-2219). */
  createVariableCollection(name: string): VariableCollection {
    const collection = new FakeVariableCollection(this.store, checkString('createVariableCollection', 'name', name));
    this.store.host.recordEntity(collection.id, 'createVariableCollection', null, { name });
    return collection;
  }

  /**
   * Creates a variable in a collection (typings:2190-2214). Passing the collection's id is
   * deprecated and throws under `documentAccess: "dynamic-page"` (typings:2190-2199).
   */
  createVariable(
    name: string,
    collection: VariableCollection | string,
    resolvedType: VariableResolvedDataType,
  ): Variable {
    const api = 'createVariable';
    checkString(api, 'name', name);
    if (typeof collection === 'string') {
      throw figmaError(api, 'Cannot call with documentAccess: dynamic-page. Pass a VariableCollection object instead.');
    }
    if (!(collection instanceof FakeVariableCollection) || this.store.collections.get(collection.id) !== collection) {
      throw figmaError(api, 'Expected a variable collection of this document');
    }
    if (collection.isRemoved)
      throw figmaError(api, `The variable collection with id "${collection.id}" does not exist`);
    const type = checkEnum(api, 'resolvedType', resolvedType, ALL_TYPES);
    const modelled = VARIABLE_TYPES.find((t) => t === type);
    // Motion variables (EASING, TIMING) come with `tokens.motion` (08 §6.3), a hardening item.
    if (!modelled) return unsupported(`createVariable(${type})`, 'hardening');
    const variable = new FakeVariable(this.store, name, collection, modelled);
    this.store.host.recordEntity(variable.id, api, null, { name, collection: collection.id, resolvedType: type });
    return variable;
  }

  /** `{ type: 'VARIABLE_ALIAS', id }` (typings:2232-2238). Not a document write. */
  createVariableAlias(variable: Variable): VariableAlias {
    if (!(variable instanceof FakeVariable) || this.store.variable(variable.id) !== variable) {
      throw figmaError('createVariableAlias', 'Expected a variable of this document');
    }
    return { type: 'VARIABLE_ALIAS', id: variable.id };
  }

  setBoundVariableForPaint(
    paint: SolidPaint,
    field: VariableBindablePaintField,
    variable: Variable | null,
  ): SolidPaint {
    return bindPaint(this.store, paint, field, variable);
  }
}
