import { figmaError } from './errors';
import type { FontStore } from './fonts';
import { TextModel } from './text-model';
import { deepFreeze } from './values';

/** The node types the fake can create (BUILD §8.1). */
export type FakeNodeType =
  | 'DOCUMENT'
  | 'PAGE'
  | 'FRAME'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'SECTION'
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'VECTOR'
  | 'TEXT';

/** Types that carry `AutoLayoutMixin` and `BaseFrameMixin` (typings:9430-9485, 11175, 11200). */
export const FRAME_LIKE: ReadonlySet<FakeNodeType> = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET']);

/**
 * Container parents: the nodes `relativeTransform` is relative to. "canvas nodes, frame nodes,
 * component nodes, and instance nodes" (typings:7350-7352); sections position their children too.
 */
const CONTAINERS: ReadonlySet<FakeNodeType> = new Set(['PAGE', 'FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION']);

const IDENTITY: Transform = [
  [1, 0, 0],
  [0, 1, 0],
];

/**
 * What a node needs from its document: fonts, the plugin id that scopes private plugin data,
 * the current page, node registration and the operation log. `FakeContext` implements it.
 */
export interface DocumentContext {
  readonly fonts: FontStore;
  readonly pluginId: string;
  currentPage: NodeState;
  register(state: NodeState): void;
  record(node: NodeState | null, method: string, property?: string | null, value?: unknown): void;
}

/** The public objects that represent one node, set by each concrete node class. */
export interface NodeViews {
  node: BaseNode | null;
  scene: SceneNode | null;
  container: (BaseNode & ChildrenMixin) | null;
  page: PageNode | null;
  component: ComponentNode | null;
  document: DocumentNode | null;
}

/**
 * All state of one node. Node classes are thin typed views over this record; the record is
 * internal and never reachable through the Plugin API surface.
 */
export class NodeState {
  readonly views: NodeViews = { node: null, scene: null, container: null, page: null, component: null, document: null };
  removed = false;
  parent: NodeState | null = null;
  children: NodeState[] = [];

  // BaseNodeMixin / PluginDataMixin (typings:6364-6580)
  pluginData = new Map<string, string>();
  sharedPluginData = new Map<string, Map<string, string>>();
  relaunchData: Readonly<Record<string, string>> = deepFreeze({});

  // SceneNodeMixin
  visible = true;
  locked = false;

  // DimensionAndPositionMixin / LayoutMixin (typings:7296-7541)
  transform: Transform = IDENTITY;
  width = 100;
  height = 100;
  minWidth: number | null = null;
  maxWidth: number | null = null;
  minHeight: number | null = null;
  maxHeight: number | null = null;
  constrainProportions = false;
  targetAspectRatio: Vector | null = null;
  constraints: Constraints = deepFreeze({ horizontal: 'MIN', vertical: 'MIN' });
  layoutAlign: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'INHERIT' = 'INHERIT';
  layoutGrow = 0;
  layoutPositioning: 'AUTO' | 'ABSOLUTE' = 'AUTO';

  // AutoLayoutMixin (typings:7694-8201)
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID' = 'NONE';
  paddingLeft = 0;
  paddingRight = 0;
  paddingTop = 0;
  paddingBottom = 0;
  itemSpacing = 0;
  counterAxisSpacing: number | null = null;
  primaryAxisSizingMode: 'FIXED' | 'AUTO' = 'AUTO';
  counterAxisSizingMode: 'FIXED' | 'AUTO' = 'FIXED';
  primaryAxisAlignItems: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN' | 'SPACE_EVENLY' | 'SPACE_AROUND' = 'MIN';
  counterAxisAlignItems: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE' = 'MIN';
  counterAxisAlignContent: 'AUTO' | 'SPACE_BETWEEN' = 'AUTO';
  layoutWrap: 'NO_WRAP' | 'WRAP' = 'NO_WRAP';
  itemReverseZIndex = false;
  strokesIncludedInLayout = false;

  // Fills, strokes, corners, blend (typings:8706-9036, 9494-9545)
  fills: readonly Paint[] = deepFreeze([]);
  strokes: readonly Paint[] = deepFreeze([]);
  strokeTopWeight = 1;
  strokeRightWeight = 1;
  strokeBottomWeight = 1;
  strokeLeftWeight = 1;
  strokeAlign: 'CENTER' | 'INSIDE' | 'OUTSIDE' = 'INSIDE';
  strokeJoin: StrokeJoin = 'MITER';
  strokeCap: StrokeCap = 'NONE';
  strokeMiterLimit = 4;
  dashPattern: readonly number[] = deepFreeze([]);
  topLeftRadius = 0;
  topRightRadius = 0;
  bottomRightRadius = 0;
  bottomLeftRadius = 0;
  cornerSmoothing = 0;
  opacity = 1;
  blendMode: BlendMode = 'PASS_THROUGH';
  isMask = false;
  maskType: MaskType = 'ALPHA';
  effects: readonly Effect[] = deepFreeze([]);

  // BaseFrameMixin / ContainerMixin
  clipsContent = true;
  expanded = true;
  guides: readonly Guide[] = deepFreeze([]);
  layoutGrids: readonly LayoutGrid[] = deepFreeze([]);

  // ExportMixin, DevStatusMixin, AnnotationsMixin
  exportSettings: readonly ExportSettings[] = deepFreeze([]);
  devStatus: DevStatus = null;
  annotations: readonly Annotation[] = deepFreeze([]);

  // PublishableMixin (components, sets)
  description = '';
  descriptionMarkdown = '';
  documentationLinks: readonly DocumentationLink[] = deepFreeze([]);

  // Shapes
  vectorPaths: VectorPaths = deepFreeze([]);
  handleMirroring: HandleMirroring = 'NONE';
  arcData: ArcData = deepFreeze({ startingAngle: 0, endingAngle: 2 * Math.PI, innerRadius: 0 });

  // Sections
  sectionContentsHidden = false;

  // Pages
  loaded = true;
  pageBackgrounds: readonly Paint[] = deepFreeze([]);
  prototypeBackgrounds: readonly Paint[] = deepFreeze([]);
  selection: readonly SceneNode[] = Object.freeze([]);
  flowStartingPoints: ReadonlyArray<{ nodeId: string; name: string }> = deepFreeze([]);

  // Text (typings:9767-10460, 11002-11070)
  readonly text: TextModel | null;
  textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' = 'LEFT';
  textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM' = 'TOP';
  textAutoResize: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE' = 'WIDTH_AND_HEIGHT';
  textTruncation: 'DISABLED' | 'ENDING' = 'DISABLED';
  maxLines: number | null = null;
  autoRename = true;
  paragraphIndent = 0;
  paragraphSpacing = 0;
  listSpacing = 0;
  hangingPunctuation = false;
  hangingList = false;
  leadingTrim: LeadingTrim = 'NONE';
  textWrapStyle: TextWrapStyle = 'AUTO';

  constructor(
    readonly ctx: DocumentContext,
    readonly type: FakeNodeType,
    readonly id: string,
    public name: string,
  ) {
    this.text = type === 'TEXT' ? new TextModel() : null;
  }

  get isFrameLike(): boolean {
    return FRAME_LIKE.has(this.type);
  }

  /** Frame-like with `layoutMode` HORIZONTAL or VERTICAL. */
  get isStack(): boolean {
    return this.isFrameLike && (this.layoutMode === 'HORIZONTAL' || this.layoutMode === 'VERTICAL');
  }

  /** Frame-like with any auto layout (stack or grid). */
  get isAutoLayout(): boolean {
    return this.isFrameLike && this.layoutMode !== 'NONE';
  }

  /** Direct child of an auto-layout frame. */
  get inAutoLayout(): boolean {
    return this.parent?.isAutoLayout ?? false;
  }

  /** Positioned by its auto-layout parent: x/y writes are ignored (typings:7300-7311). */
  get isLaidOut(): boolean {
    return this.inAutoLayout && this.layoutPositioning === 'AUTO';
  }

  get x(): number {
    return this.transform[0][2];
  }

  get y(): number {
    return this.transform[1][2];
  }

  setPosition(x: number, y: number): void {
    const [[a, b], [c, d]] = this.transform;
    this.transform = deepFreeze([
      [a, b, x],
      [c, d, y],
    ]);
  }

  /** Transform relative to the containing page: the product of container transforms (typings:7369). */
  absoluteTransform(): Transform {
    let matrix = this.transform;
    for (let p = this.parent; p && p.type !== 'PAGE' && p.type !== 'DOCUMENT'; p = p.parent) {
      if (CONTAINERS.has(p.type)) matrix = multiply(p.transform, matrix);
    }
    return matrix;
  }

  /** The page this node is on, or `null` for the document and detached nodes. */
  page(): NodeState | null {
    let node: NodeState | null = this;
    while (node && node.type !== 'PAGE') node = node.parent;
    return node;
  }

  /** Whether `other` is this node or one of its ancestors. */
  hasAncestorOrSelf(other: NodeState): boolean {
    for (let node: NodeState | null = this; node; node = node.parent) if (node === other) return true;
    return false;
  }

  /** Pre-order descendants, excluding this node (typings:7120-7126). */
  descendants(): NodeState[] {
    const out: NodeState[] = [];
    const walk = (node: NodeState) => {
      for (const child of node.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  /** Detach from the parent without marking removed (used when reparenting). */
  detach(): void {
    if (!this.parent) return;
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  get nodeView(): BaseNode {
    return required(this.views.node, this, 'node');
  }

  get sceneView(): SceneNode {
    return required(this.views.scene, this, 'scene node');
  }

  get containerView(): BaseNode & ChildrenMixin {
    return required(this.views.container, this, 'container');
  }

  get pageView(): PageNode {
    return required(this.views.page, this, 'page');
  }

  /**
   * The view a child sees as `parent`. A page's parent is the document, which the typings
   * declare as `(BaseNode & ChildrenMixin) | null` (typings:6374-6380) although `DocumentNode`
   * only accepts pages as children. Figma returns the document there, so the fake does too;
   * this is the one place that needs an assertion to follow the typings.
   */
  get parentView(): BaseNode & ChildrenMixin {
    if (this.views.document) return this.views.document as unknown as BaseNode & ChildrenMixin;
    return this.containerView;
  }

  get componentView(): ComponentNode {
    return required(this.views.component, this, 'component');
  }
}

function required<T>(view: T | null, state: NodeState, what: string): T {
  if (view === null) throw new Error(`figma-fake internal error: ${state.type} ${state.id} is not a ${what}`);
  return view;
}

function multiply(m: Transform, n: Transform): Transform {
  const [[a, b, c], [d, e, f]] = m;
  const [[g, h, i], [j, k, l]] = n;
  return [
    [a * g + b * j, a * h + b * k, a * i + b * l + c],
    [d * g + e * j, d * h + e * k, d * i + e * l + f],
  ];
}

const STATES = new WeakMap<object, NodeState>();

/** Any node object of this fake. Its state lives in a side table, invisible to plugin code. */
export type HasState = object;

/** Binds a node object to its state; called once by the node constructor. */
export function bindState(node: object, state: NodeState): void {
  STATES.set(node, state);
}

/** The state of a node object, removed or not. */
export function stateOfNode(node: object): NodeState {
  const state = STATES.get(node);
  if (!state) throw new Error('figma-fake internal error: object is not a node of this fake');
  return state;
}

/**
 * The state of a node that is still in the document. Reading or writing a removed node throws,
 * as Figma does: "The node (id) does not exist" (typings:6385-6396 describe `removed`).
 */
export function live(node: object): NodeState {
  const state = stateOfNode(node);
  if (state.removed) throw figmaError('get', `The node with id "${state.id}" does not exist`);
  return state;
}
