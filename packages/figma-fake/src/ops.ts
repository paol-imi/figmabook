import { type JsonValue, toJson } from './json';

/**
 * One document write, in call order (BUILD §8: "record every write in `ops()`").
 *
 * - Property assignment: `{ method: 'set', nodeId, property: 'opacity', value: 0.5 }`.
 * - Method call: `{ method: 'resize', nodeId, property: null, value: { width, height } }`.
 * - Creation: `{ method: 'createFrame', nodeId: <new id>, property: null, value: null }`.
 * - Plugin data: `{ method: 'setSharedPluginData', nodeId, property: 'holotype/nk', value }`.
 *
 * Every assignment is recorded, even one that stores the value already there: the no-op
 * re-sync invariant (I-2, 10 §1) is "the applier issues zero writes", not "the document is
 * unchanged". Reads, font loading, `notify`, `commitUndo` and page switches are not writes.
 */
export interface Op {
  readonly method: string;
  readonly nodeId: string | null;
  readonly property: string | null;
  readonly value: JsonValue;
}

/** The ordered operation log of one fake document. */
export class OpLog {
  #ops: Op[] = [];

  record(method: string, nodeId: string | null, property: string | null, value: unknown): void {
    this.#ops.push(Object.freeze({ method, nodeId, property, value: toJson(value) }));
  }

  list(): readonly Op[] {
    return Object.freeze([...this.#ops]);
  }

  clear(): void {
    this.#ops = [];
  }
}
