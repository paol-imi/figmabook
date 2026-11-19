import { syncDependents } from './components/instances';
import { InstanceRegistry } from './components/registry';
import { FontStore } from './fonts';
import type { FakeImage } from './image';
import { relayout } from './layout/relayout';
import { OpLog } from './ops';
import type { DocumentContext, FakeNodeType, NodeState } from './state';
import type { TextOracle } from './text-metrics';
import { refreshBindings, unbindLiteral } from './variables/bindings';
import { VariableStore } from './variables/store';

/** Settings shared by every node of one fake document. */
export interface ContextOptions {
  readonly pluginId: string;
  readonly sessionId: number;
  readonly fonts: readonly FontName[];
  readonly textOracle: TextOracle | null;
}

/** Rounds of layout and instance sync after one write before the fake reports a loop. */
const MAX_SETTLE_ROUNDS = 64;

/**
 * The document-wide state of one fake: node registry and id allocation, the operation log,
 * fonts, images, variables and instances, and the engine that keeps derived state current.
 *
 * Ids look like Figma's: `0:0` for the document, `0:1` for the first page, then
 * `<session>:<counter>` for every node created in the session (typings:6366-6372, "For example,
 * `1:3`"). They are opaque strings to plugin code, but a stable sequence keeps snapshots
 * deterministic.
 *
 * **Derived state.** Figma updates layout, text size and instance contents synchronously after
 * every write (09 §11 "Figma lays out synchronously, so reads right after writes are valid").
 * Every write ends in {@link record}, which settles the nodes it touched: text sizes and auto
 * layout (`layout/relayout.ts`), then the instances of changed main components
 * (`components/instances.ts`), until nothing changes.
 */
export class FakeContext implements DocumentContext {
  readonly nodes = new Map<string, NodeState>();
  readonly ops = new OpLog();
  readonly fonts: FontStore;
  readonly images = new Map<string, FakeImage>();
  readonly notifications: string[] = [];
  readonly instances = new InstanceRegistry<NodeState>();
  readonly variables: VariableStore;
  readonly pluginId: string;
  readonly sessionId: number;
  skipInvisibleInstanceChildren = false;
  textOracle: TextOracle | null;
  #counter = 1;
  #pageCounter = 1;
  #propertyCounter = 0;
  #root: NodeState | null = null;
  #currentPage: NodeState | null = null;
  #dirty = new Set<NodeState>();
  #settling = false;
  #silent = 0;

  constructor(options: ContextOptions) {
    this.pluginId = options.pluginId;
    this.sessionId = options.sessionId;
    this.fonts = new FontStore(options.fonts);
    this.textOracle = options.textOracle;
    this.variables = new VariableStore({
      pluginId: this.pluginId,
      sessionId: this.sessionId,
      recordEntity: (id, method, property, value) => this.recordEntity(id, method, property, value),
      refreshBindings: () => {
        refreshBindings(this.nodes.values(), this.variables);
        this.settle();
      },
    });
  }

  /** The next node id for a node of `type`. */
  nextId(type: FakeNodeType): string {
    if (type === 'DOCUMENT') return '0:0';
    if (this.nodes.size === 1 && type === 'PAGE') return '0:1';
    this.#counter += 1;
    return `${this.sessionId}:${this.#counter}`;
  }

  /** The `#id` suffix of a new component property (typings:9719): `<session>:<n>`, like Figma's. */
  nextPropertyId(): string {
    this.#propertyCounter += 1;
    return `${this.sessionId}:${this.#propertyCounter}`;
  }

  /** The default name of the next page: "Page 1", "Page 2", … */
  nextPageName(): string {
    return `Page ${this.#pageCounter++}`;
  }

  register(state: NodeState): void {
    this.nodes.set(state.id, state);
  }

  nodeById(id: string): NodeState | null {
    return this.nodes.get(id) ?? null;
  }

  get root(): NodeState {
    if (!this.#root) throw new Error('figma-fake internal error: no document');
    return this.#root;
  }

  set root(state: NodeState) {
    this.#root = state;
  }

  get currentPage(): NodeState {
    if (!this.#currentPage) throw new Error('figma-fake internal error: no current page');
    return this.#currentPage;
  }

  set currentPage(state: NodeState) {
    this.#currentPage = state;
  }

  get silent(): boolean {
    return this.#silent > 0;
  }

  silently<T>(fn: () => T): T {
    this.#silent += 1;
    try {
      return fn();
    } finally {
      this.#silent -= 1;
    }
  }

  touch(state: NodeState): void {
    this.#dirty.add(state);
  }

  /**
   * Records a write to `node` (or a document-level write when `node` is null), then settles
   * derived state. A literal write to a bound field unbinds it (`variables/bindings.ts`).
   */
  record(node: NodeState | null, method: string, property: string | null = null, value: unknown = null): void {
    if (!this.silent) {
      this.ops.record(method, node?.id ?? null, property, value);
      if (node) unbindLiteral(node, method, property);
    }
    if (node) this.touch(node);
    this.settle();
  }

  /** Records a write to a variable or collection. */
  recordEntity(id: string, method: string, property: string | null, value: unknown): void {
    if (!this.silent) this.ops.record(method, id, property, value);
  }

  /** Brings layout, text sizes and instances up to date with every touched node. */
  settle(): void {
    if (this.#settling) return;
    this.#settling = true;
    try {
      const host = { oracle: this.textOracle, touch: (state: NodeState) => this.touch(state) };
      for (let round = 0; this.#dirty.size > 0; round++) {
        if (round >= MAX_SETTLE_ROUNDS) {
          throw new Error('figma-fake internal error: layout and instance sync did not settle');
        }
        const batch = [...this.#dirty];
        this.#dirty = new Set();
        const moved = relayout(batch, host);
        for (const state of syncDependents([...batch, ...moved])) this.touch(state);
      }
    } finally {
      this.#settling = false;
    }
  }
}
