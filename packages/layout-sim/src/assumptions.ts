/**
 * Every Figma auto-layout behaviour the simulator relies on, with its source.
 *
 * - `documented`: stated by the Plugin API reference (`@figma/plugin-typings`) or the Figma
 *   help center. Not reported per result.
 * - `calibrate`: not documented precisely; the simulator follows the closest documented or
 *   CSS-flexbox behaviour. Confirmed or corrected by the nightly T1 read-back calibration
 *   (12 §4, 07 §6.1). Reported in `Simulation.assumptions` when a result depends on it.
 * - `spike`: decided by a Figma spike (14 Phase 0). Reported like `calibrate`.
 */
export type AssumptionStatus = 'documented' | 'calibrate' | 'spike';

/** A spike whose result confirms or changes an assumption (BUILD §9). */
export type SpikeId = 'S-04' | 'S-05' | 'S-10';

export interface Assumption {
  /** The rule, in one or two plain sentences. */
  readonly rule: string;
  readonly status: AssumptionStatus;
  /** Set when `status` is `spike`. */
  readonly spike?: SpikeId;
  /** Figma documentation the rule is based on (at least one link). */
  readonly sources: readonly string[];
}

const API = 'https://developers.figma.com/docs/plugins/api';
const HELP_PROPERTIES = 'https://help.figma.com/hc/en-us/articles/360040451373-Explore-auto-layout-properties';
const HELP_FLOWS =
  'https://help.figma.com/hc/en-us/articles/31289464393751-Use-the-horizontal-and-vertical-flows-in-auto-layout';

const catalog = {
  'flow-order': {
    rule: 'In-flow children are laid out in layer order along the primary axis. itemReverseZIndex changes only the painting order.',
    status: 'documented',
    sources: [`${API}/properties/nodes-itemreversezindex/`, HELP_FLOWS],
  },
  'hidden-skipped': {
    rule: 'A hidden child takes no space in the flow: the remaining children close up.',
    status: 'documented',
    sources: [HELP_FLOWS, `${API}/properties/nodes-visible/`],
  },
  'absolute-out-of-flow': {
    rule: 'An ABSOLUTE child is placed at its own x/y relative to the frame corner (padding ignored) and does not affect the flow or the HUG size.',
    status: 'documented',
    sources: [`${API}/properties/nodes-layoutpositioning/`, `${API}/properties/nodes-x/`, HELP_PROPERTIES],
  },
  padding: {
    rule: 'Children are placed inside the padding box: paddingLeft/Top offset the content, paddingRight/Bottom close it.',
    status: 'documented',
    sources: [`${API}/node-properties/#paddingleft`, HELP_PROPERTIES],
  },
  'item-spacing': {
    rule: 'itemSpacing is the gap between consecutive in-flow children and may be negative (children overlap).',
    status: 'documented',
    sources: [`${API}/properties/nodes-itemspacing/`],
  },
  'primary-align': {
    rule: 'MIN, CENTER and MAX place the whole run of children at the start, middle or end of the free space on the primary axis.',
    status: 'documented',
    sources: [`${API}/properties/nodes-primaryaxisalignitems/`],
  },
  'auto-gap-between': {
    rule: 'SPACE_BETWEEN (gap "Auto") ignores itemSpacing: the first and last child are flush with the padding edges and the free space is split equally between the gaps.',
    status: 'documented',
    sources: [`${API}/properties/nodes-primaryaxisalignitems/`, HELP_FLOWS],
  },
  'auto-gap-floor': {
    rule: 'With an auto gap, when the children are too large to fit, the gap stops at 0 instead of going negative; children sit flush from the start.',
    status: 'documented',
    sources: [HELP_FLOWS],
  },
  'auto-gap-single-child': {
    rule: 'With an auto gap and a single child, the child aligns to the start (left or top).',
    status: 'documented',
    sources: [HELP_FLOWS],
  },
  'counter-align': {
    rule: 'MIN, CENTER and MAX place each child at the start, middle or end of the inner counter axis, one alignment for all children.',
    status: 'documented',
    sources: [`${API}/properties/nodes-counteraxisalignitems/`, HELP_FLOWS],
  },
  'baseline-horizontal-only': {
    rule: 'BASELINE is valid only on HORIZONTAL frames.',
    status: 'documented',
    sources: [`${API}/properties/nodes-counteraxisalignitems/`],
  },
  hug: {
    rule: 'A HUG (sizing mode AUTO) axis takes the content size plus padding: the sum of children and gaps on the primary axis, the largest child on the counter axis.',
    status: 'documented',
    sources: [
      `${API}/properties/nodes-primaryaxissizingmode/`,
      `${API}/properties/nodes-counteraxissizingmode/`,
      HELP_PROPERTIES,
    ],
  },
  'fill-breaks-hug': {
    rule: 'A frame cannot hug an axis on which a child fills: Figma switches it to FIXED, so the simulator rejects that state.',
    status: 'documented',
    sources: [HELP_PROPERTIES, `${API}/properties/nodes-primaryaxissizingmode/`],
  },
  'fill-needs-auto-layout-parent': {
    rule: 'FILL applies only to in-flow children of auto-layout frames; a top-level frame or an ABSOLUTE child cannot fill.',
    status: 'documented',
    sources: [HELP_PROPERTIES, `${API}/properties/nodes-layoutsizinghorizontal/`],
  },
  'fill-counter-stretch': {
    rule: 'A child that fills the counter axis stretches to the inner counter size (frame minus padding).',
    status: 'documented',
    sources: [`${API}/properties/nodes-layoutalign/`, `${API}/properties/nodes-layoutsizinghorizontal/`],
  },
  'min-max': {
    rule: 'minWidth/maxWidth/minHeight/maxHeight bound the size of auto-layout frames and their direct children, whatever their resizing mode.',
    status: 'documented',
    sources: [`${API}/node-properties/#minwidth`, HELP_PROPERTIES],
  },
  'padding-floor': {
    rule: 'A frame is never smaller than its padding (plus its inside stroke when strokes are included in layout), whether it hugs or is fixed.',
    status: 'documented',
    sources: [HELP_FLOWS],
  },
  'stroke-excluded': {
    rule: 'With strokesIncludedInLayout false, strokes take no layout space: children may overlap the frame stroke.',
    status: 'documented',
    sources: [`${API}/properties/nodes-strokesincludedinlayout/`],
  },
  'stroke-included-inside': {
    rule: 'With strokesIncludedInLayout true, a uniform INSIDE stroke adds its weight to the padding on every side (CSS border-box).',
    status: 'documented',
    sources: [`${API}/properties/nodes-strokesincludedinlayout/`, HELP_FLOWS],
  },
  'stroke-self-contained': {
    rule: "The stroke setting affects only the frame it is set on: a child's stroke never changes the parent's layout.",
    status: 'documented',
    sources: [HELP_FLOWS],
  },
  'fill-equal-share': {
    rule: 'FILL children on the primary axis share the free space equally, whatever their current size (like CSS flex: 1 0 0).',
    status: 'calibrate',
    sources: [`${API}/properties/nodes-layoutgrow/`, HELP_PROPERTIES],
  },
  'fill-min-max': {
    rule: 'When min/max clamp a FILL child, it is frozen at the bound and the rest is shared again among the other FILL children (CSS flexbox §9.7).',
    status: 'calibrate',
    sources: [`${API}/node-properties/#minwidth`, HELP_PROPERTIES],
  },
  'fill-no-space': {
    rule: 'When fixed children and gaps already exceed the frame, FILL children get 0 (then min/max and padding floors apply).',
    status: 'calibrate',
    sources: [HELP_PROPERTIES],
  },
  'overflow-alignment': {
    rule: 'When children overflow the inner box, CENTER overflows both sides equally and MAX overflows the start; nothing is clipped from the layout.',
    status: 'calibrate',
    sources: [`${API}/properties/nodes-primaryaxisalignitems/`, `${API}/properties/nodes-counteraxisalignitems/`],
  },
  'auto-gap-hug': {
    rule: 'A frame that hugs its primary axis with an auto gap has no free space, so its gaps are 0.',
    status: 'calibrate',
    sources: [HELP_FLOWS],
  },
  'min-max-before-floor': {
    rule: 'min/max are applied first and the padding floor last, so the floor wins over a smaller max.',
    status: 'calibrate',
    sources: [HELP_FLOWS, HELP_PROPERTIES],
  },
  'baseline-alignment': {
    rule: 'BASELINE aligns the first baselines of the children; the child with the deepest baseline touches the top padding, and a HUG frame spans the deepest baseline plus the deepest descent.',
    status: 'spike',
    spike: 'S-04',
    sources: [`${API}/properties/nodes-counteraxisalignitems/`, HELP_FLOWS],
  },
  'baseline-synthesized': {
    rule: 'Under BASELINE, a child without a known baseline uses its bottom edge (like CSS).',
    status: 'spike',
    spike: 'S-04',
    sources: [HELP_FLOWS],
  },
  'baseline-fill': {
    rule: 'Under BASELINE, a child that fills the counter axis stretches from the top padding and does not take part in baseline alignment.',
    status: 'spike',
    spike: 'S-04',
    sources: [`${API}/properties/nodes-counteraxisalignitems/`],
  },
  'stroke-included-per-side': {
    rule: 'With strokes included in layout, each side adds its own INSIDE stroke weight to its padding.',
    status: 'spike',
    spike: 'S-05',
    sources: [`${API}/properties/nodes-strokesincludedinlayout/`, `${API}/node-properties/#stroketopweight`],
  },
  'stroke-included-center-outside': {
    rule: 'With strokes included in layout, CENTER and OUTSIDE strokes add nothing to the padding (only inside strokes are included).',
    status: 'spike',
    spike: 'S-05',
    sources: [HELP_FLOWS, `${API}/properties/nodes-strokealign/`],
  },
  'auto-gap-evenly-around': {
    rule: 'SPACE_EVENLY splits the free space equally between the edges and the gaps; SPACE_AROUND gives each edge half a gap. Both ignore itemSpacing and follow the auto-gap floor and single-child rules.',
    status: 'spike',
    spike: 'S-10',
    sources: [`${API}/properties/nodes-primaryaxisalignitems/`, HELP_FLOWS],
  },
  'no-pixel-snapping': {
    rule: 'Positions and sizes are not rounded: CENTER and the shared modes produce fractional pixels. Applies to every result, so it is not listed per result.',
    status: 'calibrate',
    sources: [`${API}/properties/nodes-x/`],
  },
} as const satisfies Record<string, Assumption>;

/** Identifier of a model rule. */
export type AssumptionId = keyof typeof catalog;

/** The rule catalog, in a stable order. */
export const ASSUMPTIONS: Readonly<Record<AssumptionId, Assumption>> = catalog;

/** Catalog order, used to sort reported assumptions deterministically. */
export const ASSUMPTION_IDS = Object.keys(catalog) as readonly AssumptionId[];

/** Records which unconfirmed rules a simulation used. */
export class AssumptionLog {
  private readonly used = new Set<AssumptionId>();

  use(id: AssumptionId): void {
    if (ASSUMPTIONS[id].status !== 'documented') this.used.add(id);
  }

  /** The used rules, in catalog order. */
  list(): readonly AssumptionId[] {
    return ASSUMPTION_IDS.filter((id) => this.used.has(id));
  }
}
