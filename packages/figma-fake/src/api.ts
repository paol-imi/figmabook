import type { FigmaPort } from '@holotype/plugin/port';
import { copyNode, PLACEMENT } from './components/mirror';
import { parseVariantName } from './components/properties';
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
import { MIN_SIZE } from './nodes/layout';
import { attachNode, detachNode } from './nodes/tree';
import type { Op } from './ops';
import { type FakeTree, snapshotTree } from './snapshot';
import type { FakeNodeType, NodeState } from './state';
import { parseSvg } from './svg/document';
import { serializePath, transformSegments } from './svg/path';
import type { TextOracle } from './text-metrics';
import { deepFreeze, normalizePaints } from './values';
import { FakeVariablesApi } from './variables/api';

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
  /**
   * Oracle mode (BUILD §8.1): the line count of each text node, typically the Scene IR
   * `text.lines.length`; `undefined` falls back to the approximate metrics. See {@link TextOracle}.
   */
  readonly textOracle?: TextOracle;
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
  /** Switches oracle mode on (an oracle) or off (`null`); text is re-measured on its next write. */
  setTextOracle(oracle: TextOracle | null): void;
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
  readonly variables: FakeVariablesApi;

  constructor(options: FakeFigmaOptions) {
    const ctx = new FakeContext({
      pluginId: options.pluginId ?? 'holotype',
      sessionId: options.sessionId ?? 1,
      fonts: options.fonts ?? DEFAULT_FONTS,
      textOracle: options.textOracle ?? null,
    });
    this.#ctx = ctx;
    this.variables = new FakeVariablesApi(ctx.variables);
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

  /**
   * "The file key of the current file … Only private plugins … have access to this" (typings:74-79).
   * The default is a stable placeholder; pass `fileKey: undefined` to model a plugin without access.
   */
  get fileKey(): string | undefined {
    return this.#fileKey;
  }

  /**
   * "Skips over invisible nodes (and their descendants) inside instances"; defaults to false in
   * Figma Design (typings:80-109).
   */
  get skipInvisibleInstanceChildren(): boolean {
    return this.#ctx.skipInvisibleInstanceChildren;
  }

  set skipInvisibleInstanceChildren(value: boolean) {
    if (typeof value !== 'boolean') throw figmaError('set_skipInvisibleInstanceChildren', 'Expected a boolean');
    this.#ctx.skipInvisibleInstanceChildren = value;
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
    if (!state || state.removed) return null;
    // Invisible instance sublayers are out of reach with skipInvisibleInstanceChildren (typings:95).
    if (this.#ctx.skipInvisibleInstanceChildren && state.hiddenInInstance) return null;
    return state.nodeView;
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
   * Imports an SVG as a frame of vector layers (typings:1731-1734, 09 §6.3). The frame takes the
   * SVG's size; each shape becomes a vector placed at its path bounds, with its path data relative
   * to the vector (see `svg/document.ts` for the supported SVG).
   */
  createNodeFromSvg(svg: string): FrameNode {
    const api = 'createNodeFromSvg';
    const parsed = parseSvg(svg);
    const state = this.#state('FRAME', 'svg');
    const frame = new FakeFrameNode(state);
    state.fills = deepFreeze([]);
    state.clipsContent = false;
    state.width = parsed.width;
    state.height = parsed.height;
    for (const shape of parsed.shapes) {
      const vector = this.#state('VECTOR', shape.name);
      new FakeVectorNode(vector);
      const { x, y, width, height } = shape.bounds;
      vector.setPosition(x, y);
      vector.width = Math.max(width, MIN_SIZE);
      vector.height = Math.max(height, MIN_SIZE);
      const local = transformSegments(shape.segments, [1, 0, 0, 1, -x, -y]);
      vector.vectorPaths = deepFreeze([{ windingRule: shape.windingRule, data: serializePath(local) }]);
      vector.fills = normalizePaints(api, shape.fills);
      vector.strokes = normalizePaints(api, shape.strokes);
      for (const side of ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'] as const) {
        vector[side] = shape.strokeWeight;
      }
      vector.strokeCap = shape.strokeCap;
      vector.strokeJoin = shape.strokeJoin;
      vector.opacity = Math.min(1, Math.max(0, shape.opacity));
      attachNode(api, state, vector, state.children.length);
    }
    const page = this.#ctx.currentPage;
    attachNode(api, page, state, page.children.length);
    this.#ctx.record(state, api);
    return frame;
  }

  /**
   * "Creates a component from an existing node, preserving all of its properties and children"
   * (typings:1104-1120). "The node cannot be a component or component set and cannot be inside a
   * component, component set, or instance"; otherwise it throws `Cannot create component from
   * node`. A frame becomes the component (with a new id); any other layer is wrapped in a new
   * component of its size, at its place.
   */
  createComponentFromNode(node: SceneNode): ComponentNode {
    const api = 'createComponentFromNode';
    const source = stateOf(api, node);
    const refuse = () => figmaError(api, 'Cannot create component from node');
    const banned = new Set<FakeNodeType>(['COMPONENT', 'COMPONENT_SET', 'SECTION', 'PAGE', 'DOCUMENT']);
    if (banned.has(source.type) || source.inInstance) throw refuse();
    for (let p = source.parent; p; p = p.parent)
      if (p.type === 'COMPONENT' || p.type === 'COMPONENT_SET' || p.type === 'INSTANCE') throw refuse();
    if (source.descendants().some((d) => d.type === 'COMPONENT' || d.type === 'COMPONENT_SET')) throw refuse();
    const parent = source.parent;
    if (!parent) throw refuse();
    checkLoaded(api, parent);
    const index = parent.children.indexOf(source);
    const component = this.#state('COMPONENT', source.name);
    const view = new FakeComponentNode(component);
    if (source.type === 'FRAME') {
      copyNode(component, source);
      attachNode(api, parent, component, index);
      for (const child of [...source.children]) attachNode(api, component, child, component.children.length);
      detachNode(source);
      source.removed = true;
    } else {
      component.transform = deepFreeze([
        [1, 0, source.x],
        [0, 1, source.y],
      ]);
      component.width = source.width;
      component.height = source.height;
      for (const field of PLACEMENT) Reflect.set(component, field, Reflect.get(source, field));
      attachNode(api, parent, component, index);
      attachNode(api, component, source, 0);
      source.setPosition(0, 0);
      source.layoutGrow = 0;
      source.layoutAlign = 'INHERIT';
      source.layoutPositioning = 'AUTO';
    }
    this.#ctx.record(component, api, null, source.id);
    return view;
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
    // "… and not inside an instance" (09 §6.2): an instance's layers come from its main component.
    if (parentState.type === 'INSTANCE' || parentState.inInstance) {
      throw figmaError(api, 'Cannot combine variants inside an instance');
    }

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
    this.#ctx.settle();
    return snapshotTree(this.#ctx);
  }

  setTextOracle(oracle: TextOracle | null): void {
    this.#ctx.textOracle = oracle;
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
