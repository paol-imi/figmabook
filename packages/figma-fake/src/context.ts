import { FontStore } from './fonts';
import type { FakeImage } from './image';
import { OpLog } from './ops';
import type { DocumentContext, FakeNodeType, NodeState } from './state';

/** Settings shared by every node of one fake document. */
export interface ContextOptions {
  readonly pluginId: string;
  readonly sessionId: number;
  readonly fonts: readonly FontName[];
}

/**
 * The document-wide state of one fake: node registry and id allocation, the operation log,
 * fonts and images.
 *
 * Ids look like Figma's: `0:0` for the document, `0:1` for the first page, then
 * `<session>:<counter>` for every node created in the session (typings:6366-6372, "For example,
 * `1:3`"). They are opaque strings to plugin code, but a stable sequence keeps snapshots
 * deterministic.
 */
export class FakeContext implements DocumentContext {
  readonly nodes = new Map<string, NodeState>();
  readonly ops = new OpLog();
  readonly fonts: FontStore;
  readonly images = new Map<string, FakeImage>();
  readonly notifications: string[] = [];
  readonly pluginId: string;
  readonly #sessionId: number;
  #counter = 1;
  #pageCounter = 1;
  #root: NodeState | null = null;
  #currentPage: NodeState | null = null;

  constructor(options: ContextOptions) {
    this.pluginId = options.pluginId;
    this.#sessionId = options.sessionId;
    this.fonts = new FontStore(options.fonts);
  }

  /** The next node id for a node of `type`. */
  nextId(type: FakeNodeType): string {
    if (type === 'DOCUMENT') return '0:0';
    if (this.nodes.size === 1 && type === 'PAGE') return '0:1';
    this.#counter += 1;
    return `${this.#sessionId}:${this.#counter}`;
  }

  /** The default name of the next page: "Page 1", "Page 2", … */
  nextPageName(): string {
    return `Page ${this.#pageCounter++}`;
  }

  register(state: NodeState): void {
    this.nodes.set(state.id, state);
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

  /** Records a write to `node` (or a document-level write when `node` is null). */
  record(node: NodeState | null, method: string, property: string | null = null, value: unknown = null): void {
    this.ops.record(method, node?.id ?? null, property, value);
  }
}
