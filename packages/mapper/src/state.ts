import type {
  CaptureDoc,
  CNode,
  MapperInput,
  PlannedVariant,
  Rect,
  SceneComponent,
  SceneNode,
  SceneNodeKind,
  ScenePropertyDef,
} from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';

/** The Scene fields the visual, text and layout stages fill in, copied as-is at emission. */
export type NodeFields = Partial<
  Pick<
    SceneNode,
    | 'fills'
    | 'strokes'
    | 'radius'
    | 'effects'
    | 'opacity'
    | 'blendMode'
    | 'clipsContent'
    | 'text'
    | 'svg'
    | 'vector'
    | 'child'
  >
>;

/**
 * Layers the mapper adds that no element generates (07 §10, §7): their key is the owner's key
 * plus the role, and their name is the role's label (07 §12 rule 9).
 */
export type SyntheticRole = 'bg' | 'border-t' | 'border-r' | 'border-b' | 'border-l' | 'outline' | 'shadow' | 'clip';

/** Where a hoisted layer was before stage 2 moved it (07 §7.3); its key keeps that path. */
export interface HoistOrigin {
  readonly parent: WorkNode;
}

/**
 * One layer being mapped. It starts as a 1:1 lift of a capture node; stages prune and
 * restructure the tree and fill in its fields, and the emission stage turns it into a
 * `SceneNode`.
 */
export interface WorkNode {
  /**
   * The capture node this layer draws (never mutated). For a synthetic layer, the element it
   * belongs to; for a collapsed text wrapper (07 §11 rule 3), the text block.
   */
  readonly capture: CNode;
  kind: SceneNodeKind;
  /** The layer's border box in page space: the capture rect, or the box a stage gave it. */
  box: Rect;
  children: WorkNode[];
  visible: boolean;
  /** `visibility: hidden`: the node's own paint is dropped, its visible descendants stay (07 §2). */
  paintHidden: boolean;
  /** Set on layers the mapper made (07 §10, §7.3); `capture` is then their owner element. */
  synthetic?: SyntheticRole;
  /**
   * The element a text layer replaced (07 §11 rule 3): keys, names and `source` come from it,
   * and `box` is its border box.
   */
  wrapper?: CNode;
  /** Set when stage 2 moved the layer up the tree (07 §7.3). */
  hoistedFrom?: HoistOrigin;
  /** Node key, set by the naming stage (07 §13.3, 10 §4). */
  nk: string;
  /** Layer name, set by the naming stage (07 §12). */
  name: string;
  fields: NodeFields;
  /** Facts about this node; their `nodeKey` is filled in at emission, once `nk` is final. */
  readonly diagnostics: Diagnostic[];
}

/** One planned variant and its capture. */
export interface VariantState {
  readonly planned: PlannedVariant;
  readonly capture: CaptureDoc;
  root: WorkNode;
  /** Variant-level facts (not about one node). */
  readonly diagnostics: Diagnostic[];
}

/** The whole component being mapped. */
export interface ComponentState {
  readonly input: MapperInput;
  /** In plan order. */
  readonly variants: readonly VariantState[];
  /** Property definitions, in display order (stage 11). */
  properties: ScenePropertyDef[];
  /** Set by the emission stage; hashed and validated by the last stages. */
  scene: SceneComponent | undefined;
  /** Component-level facts. */
  readonly diagnostics: Diagnostic[];
}

function initialKind(node: CNode): SceneNodeKind {
  if (node.type === 'text') return 'text';
  switch (node.replaced?.kind) {
    case 'svg':
      return 'svg';
    case 'img':
    case 'raster':
      return 'image';
    default:
      return 'frame';
  }
}

/** Lifts a capture subtree into work nodes, unchanged. */
export function liftNode(node: CNode): WorkNode {
  return {
    capture: node,
    kind: initialKind(node),
    box: node.borderBox,
    children: node.children.map(liftNode),
    visible: true,
    paintHidden: false,
    nk: '',
    name: '',
    fields: {},
    diagnostics: [],
  };
}

/** Lifts a variant's capture root; the root is always the variant's component node. */
export function liftRoot(capture: CaptureDoc): WorkNode {
  return { ...liftNode(capture.root), kind: 'component' };
}

/** A layer the mapper adds for `owner` (07 §10, §7.3). */
export function syntheticNode(
  owner: WorkNode,
  role: SyntheticRole,
  kind: SceneNodeKind,
  box: Rect,
  fields: NodeFields,
  children: WorkNode[] = [],
): WorkNode {
  return {
    capture: owner.capture,
    kind,
    box,
    children,
    visible: true,
    paintHidden: false,
    synthetic: role,
    nk: '',
    name: '',
    fields,
    diagnostics: [],
  };
}

/** The element a layer stands for: the wrapper it replaced, else its capture node. */
export const sourceElement = (node: WorkNode): CNode => node.wrapper ?? node.capture;

/** Visits a work tree depth-first, parents before children. */
export function* walkWork(root: WorkNode): Generator<WorkNode> {
  yield root;
  for (const child of root.children) yield* walkWork(child);
}
