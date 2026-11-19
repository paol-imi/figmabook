import { type HasState, live, type NodeState } from '../state';

type IfEquals<X, Y, A, B> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? A : B;

/** Data fields of `NodeState` that a setter may assign (no getters, no methods, no readonly fields). */
export type WritableField = {
  [P in keyof NodeState]-?: NodeState[P] extends (...args: never[]) => unknown
    ? never
    : IfEquals<{ [Q in P]: NodeState[P] }, { -readonly [Q in P]: NodeState[P] }, P, never>;
}[keyof NodeState];

/**
 * Stores an already-validated value and records the write. Validation happens first, so a
 * write that throws leaves no trace in the document or the operation log.
 */
export function assign<K extends WritableField>(
  node: HasState,
  field: K,
  value: NodeState[K],
  property: string = field,
): NodeState {
  const state = live(node);
  state[field] = value;
  state.ctx.record(state, 'set', property, value);
  return state;
}
