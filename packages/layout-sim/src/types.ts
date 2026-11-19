import type { Point, Rect, SceneLayout, SceneStroke, Size } from '@holotype/ir';
import type { Result } from '@holotype/shared';
import type { AssumptionId } from './assumptions';
import type { SimIssue } from './issues';

/** A HORIZONTAL or VERTICAL Scene IR layout (06 §3.3 `SceneLayout`). */
export type SceneStackLayout = Extract<SceneLayout, { mode: 'HORIZONTAL' | 'VERTICAL' }>;

/** A GRID Scene IR layout. Not simulated in v0 (B-112, spike S-10). */
export type SceneGridLayout = Extract<SceneLayout, { mode: 'GRID' }>;

/**
 * `primaryAxisAlignItems`. Scene IR never emits `SPACE_EVENLY` / `SPACE_AROUND` (07 §4.1),
 * but the Plugin API accepts them, so `figma-fake` may hand them over (spike S-10).
 */
export type PrimaryAxisAlign = SceneStackLayout['primaryAxisAlignItems'] | 'SPACE_EVENLY' | 'SPACE_AROUND';

/**
 * Auto-layout settings of one stack frame, named after the Plugin API properties. A Scene IR
 * stack layout (`SceneStackLayout`) is assignable to it as is.
 */
export interface StackSpec {
  readonly mode: 'HORIZONTAL' | 'VERTICAL';
  readonly padding: { readonly t: number; readonly r: number; readonly b: number; readonly l: number };
  /** Gap between consecutive in-flow children; may be negative. Ignored by the auto-gap modes. */
  readonly itemSpacing: number;
  readonly primaryAxisAlignItems: PrimaryAxisAlign;
  readonly counterAxisAlignItems: SceneStackLayout['counterAxisAlignItems'];
  readonly primaryAxisSizingMode: 'FIXED' | 'AUTO';
  readonly counterAxisSizingMode: 'FIXED' | 'AUTO';
  readonly strokesIncludedInLayout: boolean;
  /** `layoutWrap: WRAP`. Not simulated in v0 (B-111): reported as `unsupported-wrap`. */
  readonly wrap?: boolean;
}

/** A child's resizing on one axis (`layoutSizingHorizontal` / `layoutSizingVertical`). */
export type Sizing = 'FIXED' | 'HUG' | 'FILL';

/** Optional per-axis bounds (`minWidth`, `maxHeight`, …). */
export interface SizeBounds {
  readonly w?: number;
  readonly h?: number;
}

/** The stroke geometry the simulator reads: alignment and per-side weights. */
export type StrokeBox = Pick<SceneStroke, 'align' | 'weight'>;

/**
 * One node of the simulated tree (07 §6.1). Leaves (text, vectors, images, instances) keep
 * their `size`; stack frames recompute it on HUG axes from their children.
 */
export interface SimNode {
  /** Unique in the tree; the Scene IR node key (`nk`). */
  readonly key: string;
  /**
   * Current size. Used as is on FIXED axes and by leaves; the starting size on FILL axes
   * (the parent overrides it); ignored on the HUG axes of stack frames.
   */
  readonly size: Size;
  /** Defaults to the stack's sizing modes (AUTO → HUG), or FIXED for non-stack nodes. */
  readonly sizingH?: Sizing;
  readonly sizingV?: Sizing;
  /** `layoutPositioning`; defaults to `AUTO`. */
  readonly positioning?: 'AUTO' | 'ABSOLUTE';
  /** Defaults to true. Hidden children take no space and get no rect; the root is always simulated. */
  readonly visible?: boolean;
  /** Position relative to the parent's top-left corner: ABSOLUTE children and children of non-stack frames. */
  readonly xy?: Point;
  readonly min?: SizeBounds;
  readonly max?: SizeBounds;
  /** This frame's own stroke; only read when its layout has `strokesIncludedInLayout: true`. */
  readonly stroke?: StrokeBox;
  /**
   * Distance from the node's top edge to its first text baseline, for `BASELINE` alignment.
   * The caller supplies it (text `lines[0].baseline`, or the first text descendant's offset).
   */
  readonly baseline?: number;
  /** The node is rotated, skewed or scaled (`relativeTransform`); not simulated inside a stack. */
  readonly transformed?: boolean;
  /** Absent: not an auto-layout frame (children are placed by `xy`). */
  readonly layout?: StackSpec | { readonly mode: 'GRID' };
  readonly children?: readonly SimNode[];
}

/** Options shared by the simulation entry points. */
export interface SimulateOptions {
  /**
   * The root's size forced by an outer parent on its FILL axes (07 §6.1 `outerConstraint`).
   * Without it, a FILL root is reported: FILL needs an auto-layout parent.
   */
  readonly outer?: SizeBounds;
}

/** A successful simulation. */
export interface Simulation {
  /** The root's size. */
  readonly size: Size;
  /** Every visible node's box relative to the root's top-left corner, root first, in tree order. */
  readonly rects: ReadonlyMap<string, Rect>;
  /**
   * Unconfirmed model rules the result depends on (status `calibrate` or `spike`), in catalog
   * order. A read-back mismatch on this tree should be checked against these first.
   */
  readonly assumptions: readonly AssumptionId[];
}

/** Outcome of a simulation: the rects, or every issue that made the input unsimulatable. */
export type SimResult<T = Simulation> = Result<T, readonly SimIssue[]>;
