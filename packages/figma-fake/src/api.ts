import type { FigmaPort } from '@holotype/plugin/port';
import { FakeContext } from './context';
import { newState } from './defaults';
import { figmaError } from './errors';
import { DEFAULT_FONTS } from './fonts';
import { FakeImage } from './image';
import { MIXED, type Mixed } from './mixed';
import { checkLoaded, stateOf } from './nodes/children';
import {
  FakeComponentNode,
  FakeComponentSetNode,
  FakeDocumentNode,
  FakeEllipseNode,
  FakeFrameNode,
  FakePageNode,
  FakeRectangleNode,
  FakeSectionNode,
  FakeTextNode,
  FakeVectorNode,
} from './nodes/classes';
import { parseVariantName } from './nodes/component';
import { attachNode } from './nodes/tree';
import type { Op } from './ops';
import { type FakeTree, snapshotTree } from './snapshot';
import type { FakeNodeType, NodeState } from './state';
import { parseSvg } from './svg';
import { deepFreeze } from './values';

/** Options for {@link createFakeFigma}. */
export interface FakeFigmaOptions {
  /** Fonts the editor offers (`listAvailableFontsAsync`). Default: Inter and Roboto styles. */
  readonly fonts?: readonly FontName[];
  /**
   * Names of the pages the file starts with. Default `['Page 1']`. The first is the current
   * page and is loaded; the others start unloaded, as under `documentAccess: "dynamic-page"`.
   */
  readonly pages?: readonly string[];
  /** `figma.fileKey`. Readable because the manifest sets `enablePrivatePluginApi` (typings:74-79). */
  readonly fileKey?: string | undefined;
  /** The file name, readable as `figma.root.name`. Default `Untitled`. */
  readonly fileName?: string;
  /** The plugin id that scopes private plugin data. Default `holotype`. */
  readonly pluginId?: string;
  /** The session part of new node ids (`<session>:<n>`). Default 1. */
  readonly sessionId?: number;
}

/** Test controls on top of the port. */
export interface FakeControls {
  /** Canonical JSON of the document (BUILD §8.1). */
  snapshot(): FakeTree;
  /** Every document write since creation or the last `reset()`, in order. */
  ops(): readonly Op[];
  /**
   * Simulates closing and re-opening the plugin on the same document: clears the operation log
   * and notifications, forgets loaded fonts, unloads every page except the current one and
   * restores `skipInvisibleInstanceChildren`. The document and `clientStorage` are kept.
   */
  reset(): void;
  /** Messages passed to `notify()`, in order. */
  notifications(): readonly string[];
  /**
   * Present on the real API but throws under `documentAccess: "dynamic-page"` (typings:422-427),
   * so code that bypasses the port's async getters fails here too.
   */
  getNodeById(id: string): BaseNode | null;
}

/** The fake: the `FigmaPort` surface plus test controls. */
export type FakeFigma = FigmaPort & FakeControls;

/** `figma.clientStorage` (typings:2660-2683): values are copied in and out, like serialisation. */
class FakeClientStorage implements ClientStorageAPI {
  readonly #values = new Map<string, unknown>();

  async getAsync(key: string): Promise<unknown> {
    const value = this.#values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  async setAsync(key: string, value: unknown): Promise<void> {
    if (typeof key !== 'string') throw figmaError('clientStorage.setAsync', 'Expected "key" to be a string');
    this.#values.set(key, structuredClone(value));
  }

  async deleteAsync(key: string): Promise<void> {
    this.#values.delete(key);
  }

  async keysAsync(): Promise<string[]> {
    return [...this.#values.keys()];
  }
}

const COMPONENT_SET_NAME = 'Component Set';

class FakeFigmaApi implements FakeFigma {
  readonly #ctx: FakeContext;
  readonly #root: FakeDocumentNode;
  readonly #fileKey: string | undefined;
  readonly clientStorage = new FakeClientStorage();
  /** Defaults to false in Figma Design (typings:80-109). */
  skipInvisibleInstanceChildren = false;

  constructor(options: FakeFigmaOptions) {
    const ctx = new FakeContext({
      pluginId: options.pluginId ?? 'holotype',
      sessionId: options.sessionId ?? 1,
      fonts: options.fonts ?? DEFAULT_FONTS,
    });
    this.#ctx = ctx;
    this.#fileKey = 'fileKey' in options ? options.fileKey : 'FAKEFILEKEY0000000000000';
    const document = newState(ctx, 'DOCUMENT', ctx.nextId('DOCUMENT'), options.fileName ?? 'Untitled');
    this.#root = new FakeDocumentNode(document);
    ctx.root = document;
    const names = options.pages ?? ['Page 1'];
    if (names.length === 0) throw new Error('figma-fake: a document has at least one page');
    names.forEach((name, i) => {
      const page = this.#newPage(name);
      page.loaded = i === 0;
      if (i === 0) ctx.currentPage = page;
    });
    ctx.ops.clear();
  }

  get fileKey(): string | undefined {
    return this.#fileKey;
  }

  get mixed(): Mixed {
    return MIXED;
  }

  get root(): DocumentNode {
    return this.#root;
  }

  get currentPage(): PageNode {
    return this.#ctx.currentPage.pageView;
  }

  /** "If the manifest contains `"documentAccess": "dynamic-page"`, this property is read-only" (typings:461-466). */
  set currentPage(_page: PageNode) {
    throw figmaError(
      'set_currentPage',
      'Cannot call with documentAccess: dynamic-page. Use figma.setCurrentPageAsync instead.',
    );
  }

  /** Switches page and loads it (typings:467-470). Navigation is not a document write. */
  async setCurrentPageAsync(page: PageNode): Promise<void> {
    const state = stateOf('setCurrentPageAsync', page);
    if (state.type !== 'PAGE') throw figmaError('setCurrentPageAsync', 'Expected a page node');
    state.loaded = true;
    this.#ctx.currentPage = state;
  }

  /** "If the id is invalid, or the node cannot be found (e.g. removed), returns a promise containing null" (typings:417-421). */
  async getNodeByIdAsync(id: string): Promise<BaseNode | null> {
    const state = this.#ctx.nodes.get(id);
    return state && !state.removed ? state.nodeView : null;
  }

  getNodeById(_id: string): BaseNode | null {
    throw figmaError(
      'getNodeById',
      'Cannot call with documentAccess: dynamic-page. Use figma.getNodeByIdAsync instead.',
    );
  }

  // Creation. New nodes are "parented under `figma.currentPage`" (typings:911-1102).

  #state(type: FakeNodeType, name: string): NodeState {
    return newState(this.#ctx, type, this.#ctx.nextId(type), name);
  }

  #place<T>(state: NodeState, node: T, method: string): T {
    const page = this.#ctx.currentPage;
    attachNode(method, page, state, page.children.length);
    this.#ctx.record(state, method);
    return node;
  }

  createFrame(): FrameNode {
    const state = this.#state('FRAME', 'Frame');
    return this.#place(state, new FakeFrameNode(state), 'createFrame');
  }

  createComponent(): ComponentNode {
    const state = this.#state('COMPONENT', 'Component');
    return this.#place(state, new FakeComponentNode(state), 'createComponent');
  }

  createRectangle(): RectangleNode {
    const state = this.#state('RECTANGLE', 'Rectangle');
    return this.#place(state, new FakeRectangleNode(state), 'createRectangle');
  }

  createEllipse(): EllipseNode {
    const state = this.#state('ELLIPSE', 'Ellipse');
    return this.#place(state, new FakeEllipseNode(state), 'createEllipse');
  }

  createVector(): VectorNode {
    const state = this.#state('VECTOR', 'Vector');
    return this.#place(state, new FakeVectorNode(state), 'createVector');
  }

  createText(): TextNode {
    const state = this.#state('TEXT', '');
    return this.#place(state, new FakeTextNode(state), 'createText');
  }

  createSection(): SectionNode {
    const state = this.#state('SECTION', 'Section');
    return this.#place(state, new FakeSectionNode(state), 'createSection');
  }

  #newPage(name: string): NodeState {
    const state = this.#state('PAGE', name);
    new FakePageNode(state);
    attachNode('createPage', this.#ctx.root, state, this.#ctx.root.children.length);
    return state;
  }

  /** "Creates a new page, appended to the document's list of children" (typings:1121-1135). */
  createPage(): PageNode {
    const state = this.#newPage(this.#ctx.nextPageName());
    this.#ctx.record(state, 'createPage');
    return state.pageView;
  }

  /**
   * Imports an SVG as a frame of vector layers (typings:1731-1734). The frame takes the SVG's
   * size; each `<path>` becomes a vector filling the frame (B-54 computes real path bounds).
   */
  createNodeFromSvg(svg: string): FrameNode {
    const parsed = parseSvg(svg);
    const state = this.#state('FRAME', 'svg');
    state.fills = deepFreeze([]);
    state.clipsContent = false;
    state.width = parsed.width;
    state.height = parsed.height;
    const frame = this.#place(state, new FakeFrameNode(state), 'createNodeFromSvg');
    for (const path of parsed.paths) {
      const vector = this.#state('VECTOR', 'Vector');
      new FakeVectorNode(vector);
      vector.width = parsed.width;
      vector.height = parsed.height;
      vector.vectorPaths = deepFreeze([{ windingRule: path.windingRule, data: path.data }]);
      vector.fills = path.fill
        ? deepFreeze([
            { type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color: path.fill, boundVariables: {} },
          ])
        : deepFreeze([]);
      attachNode('createNodeFromSvg', state, vector, state.children.length);
    }
    return frame;
  }

  /** PNG, JPEG or GIF up to 4096 px; equal bytes give the same hash (typings:1735-1742). */
  createImage(data: Uint8Array): Image {
    if (!(data instanceof Uint8Array)) throw figmaError('createImage', 'Expected a Uint8Array');
    const image = new FakeImage(data);
    const existing = this.#ctx.images.get(image.hash);
    this.#ctx.record(null, 'createImage', null, { hash: image.hash });
    if (existing) return existing;
    this.#ctx.images.set(image.hash, image);
    return image;
  }

  /** "If there is no image with this hash, returns null" (typings:1779-1782). */
  getImageByHash(hash: string): Image | null {
    return this.#ctx.images.get(hash) ?? null;
  }

  /**
   * Combines components into a new component set under `parent` (typings:1835-1857). The list
   * must be non-empty and hold only components, all on the same page (09 §6.2). The set is
   * placed at the components' bounding box; variants keep their place inside it.
   */
  combineAsVariants(
    nodes: ReadonlyArray<ComponentNode>,
    parent: BaseNode & ChildrenMixin,
    index?: number,
  ): ComponentSetNode {
    const api = 'combineAsVariants';
    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw figmaError(api, 'Cannot combine 0 nodes: a component set needs at least one component');
    }
    const parentState = stateOf(api, parent);
    checkLoaded(api, parentState);
    const states = nodes.map((node: ComponentNode) => stateOf(api, node));
    if (states.some((state) => state.type !== 'COMPONENT'))
      throw figmaError(api, 'Only components can be combined as variants');
    const pages = new Set(states.map((state) => state.page()));
    if (pages.size !== 1 || pages.has(null)) throw figmaError(api, 'All components must be on the same page');
    // "not inside an instance" (09 §6.2) is checked once instances exist (B-54).

    const set = this.#state('COMPONENT_SET', COMPONENT_SET_NAME);
    const setNode = new FakeComponentSetNode(set);
    const origin =
      parentState.type === 'PAGE'
        ? [0, 0]
        : [parentState.absoluteTransform()[0][2], parentState.absoluteTransform()[1][2]];
    const boxes = states.map((state) => {
      const [[, , x], [, , y]] = state.absoluteTransform();
      return { state, x: x - (origin[0] ?? 0), y: y - (origin[1] ?? 0) };
    });
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    set.width = Math.max(0.01, Math.max(...boxes.map((b) => b.x + b.state.width)) - minX);
    set.height = Math.max(0.01, Math.max(...boxes.map((b) => b.y + b.state.height)) - minY);
    set.setPosition(minX, minY);
    attachNode(api, parentState, set, index ?? parentState.children.length);
    for (const { state, x, y } of boxes) {
      attachNode(api, set, state, set.children.length);
      state.setPosition(x - minX, y - minY);
      // Combining components with plain names gives `Property 1=<name>` variants, as in the editor.
      if (!parseVariantName(state.name)) state.name = `Property 1=${state.name}`;
    }
    this.#ctx.record(set, api, null, { nodes: states.map((s) => s.id), parent: parentState.id, index: index ?? null });
    return setNode;
  }

  // Fonts.

  async loadFontAsync(fontName: FontNameInput): Promise<void> {
    if (typeof fontName !== 'object' || fontName === null || typeof fontName.family !== 'string') {
      throw figmaError('loadFontAsync', 'Expected a font name object');
    }
    this.#ctx.fonts.load(fontName);
  }

  async listAvailableFontsAsync(): Promise<Font[]> {
    return this.#ctx.fonts.list();
  }

  // Session.

  notify(message: string, _options?: NotificationOptions): NotificationHandler {
    if (typeof message !== 'string') throw figmaError('notify', 'Expected "message" to be a string');
    this.#ctx.notifications.push(message);
    return { cancel: () => undefined };
  }

  /** Undo history is not modelled; the call is accepted (typings:272-294). */
  commitUndo(): void {}

  // Controls.

  snapshot(): FakeTree {
    return snapshotTree(this.#ctx);
  }

  ops(): readonly Op[] {
    return this.#ctx.ops.list();
  }

  reset(): void {
    const ctx = this.#ctx;
    ctx.ops.clear();
    ctx.notifications.length = 0;
    ctx.fonts.unloadAll();
    for (const page of ctx.root.children) page.loaded = page === ctx.currentPage;
    this.skipInvisibleInstanceChildren = false;
  }

  notifications(): readonly string[] {
    return Object.freeze([...this.#ctx.notifications]);
  }
}

/**
 * Creates an in-memory Figma document behind the plugin's `FigmaPort` (BUILD §8, 09 §18).
 * The result satisfies `FigmaPort` structurally, with Figma's own typings, and adds test
 * controls ({@link FakeControls}).
 */
export function createFakeFigma(options: FakeFigmaOptions = {}): FakeFigma {
  return new FakeFigmaApi(options);
}
