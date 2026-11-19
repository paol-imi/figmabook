import type {
  CaptureDoc,
  CNode,
  MapperInput,
  PlannedVariant,
  SceneComponent,
  SceneNode,
  SceneNodeKind,
  ScenePropertyDef,
} from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';

/** The Scene fields the visual and text stages fill in, copied as-is at emission. */
export type NodeFields = Partial<
  Pick<SceneNode, 'fills' | 'strokes' | 'radius' | 'opacity' | 'blendMode' | 'clipsContent' | 'text' | 'svg'>
>;

/**
 * One layer being mapped. It starts as a 1:1 lift of a capture node; stages prune the tree
 * and fill in its fields, and the emission stage turns it into a `SceneNode`.
 */
export interface WorkNode {
  /** The capture node this layer comes from (never mutated). */
  readonly capture: CNode;
  kind: SceneNodeKind;
  children: WorkNode[];
  visible: boolean;
  /** `visibility: hidden`: the node's own paint is dropped, its visible descendants stay (07 §2). */
  paintHidden: boolean;
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

/** Visits a work tree depth-first, parents before children. */
export function* walkWork(root: WorkNode): Generator<WorkNode> {
  yield root;
  for (const child of root.children) yield* walkWork(child);
}
