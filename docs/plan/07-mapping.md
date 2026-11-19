# 07 — Mapping & inference (packages `mapper`, `layout-sim`)

> This chapter specifies the pure transformation **Capture IR → Scene IR** ([06](06-ir.md)). It is governed by these decisions:
>
> - **D-08:** the mapper is CLI-side, pure and isomorphic.
> - **D-15:** absolute layout is the baseline; auto layout is emitted only when verified; fallbacks are embedded.
> - **D-16:** borders.
> - **D-17:** text.
> - **D-18:** token bindings.
> - **D-21:** nested instances.
>
> It builds on the [DOM→Figma research brief](../research/dom-to-figma-brief.md). The most rigorous prior art is figit's verify-then-emit design ([figitdesign/web-to-figma](https://github.com/figitdesign/web-to-figma), `converter/layout/infer.ts`). We adopt that design and extend it in three ways: we verify a second time in the plugin, we align nodes across variants, and we emit component properties.

## 0. Contract

```ts
// packages/mapper/src/index.ts
export interface MapperInput {
  sid: string;
  meta: ComponentMetaInput;                 // from storybook adapter (03)
  plan: VariantPlan;                        // from planner (04): variants, axes, arg classifications, set grid
  captures: Map<string /* vk */, CaptureDoc>;
  tokens: TokenResolution;                  // from token resolver (08): cssName -> variable key, per-node var chains
  components: ComponentCatalog;             // sids + variant property maps of components available for instancing (D-21)
  config: MapperConfig;                     // resolved per-component config (README §7 precedence)
}
export interface MapperOutput { scene: SceneComponent; diagnostics: Diagnostic[] }
export function mapComponent(input: MapperInput): MapperOutput;   // pure, deterministic, no I/O, no Date, no Math.random
```

The mapper never touches `figma`, the DOM or the filesystem. It runs in Node (CLI), and it can run unchanged in a worker or in the plugin UI if that ever becomes useful. Asset bytes are referenced by `sha` only.

## 1. Pipeline (ordered stages)

| # | Stage | Per | Output |
|---|---|---|---|
| 1 | **Normalize** | variant | cleaned `CNode` tree (§2) |
| 2 | **Paint-order sort and hoisting** | variant | children in paint order; z-escapes hoisted (§7) |
| 3 | **Classify containers** | variant | `ContainerKind` per element (§3) |
| 4 | **Infer layout + simulate** | variant | candidate `SceneLayout` + `LayoutVerification`, or absolute (§4–§6) |
| 5 | **Sizing** | variant | `SceneChild.sizingH/V`, min/max (§4.4) |
| 6 | **Text** | variant | `SceneText` (§8) |
| 7 | **Visuals** | variant | fills, strokes, radius, effects, decompositions, rasters (§10) |
| 8 | **Simplify** | variant | collapsed tree (§11) |
| 9 | **Nested instance substitution** | variant | `instance` nodes (§15) |
| 10 | **Cross-variant alignment** | component | identical `nk` and names across variants, superset trees (§13) |
| 11 | **Component property binding** | component | `propRefs`, `slot`, property defs (§14) |
| 12 | **Token binding** | component | `bind` / `VarRef`s (§16) |
| 13 | **Naming finalization** | component | unique sibling names (§12) |
| 14 | **Fallback + expect emission** | variant | `fallback`, `expect` on every node (§6) |
| 15 | **Hashing** | component | `irh` bottom-up (06 §6) |
| 16 | **Invariant validation** | component | throws `PLAN_INVARIANT_VIOLATION` (06 §9) |

**Ordering constraints:**

- Stage 9 runs before 10: instances align as opaque leaves.
- Stage 10 runs before 11–13: bindings and names must be consistent across variants.
- Stage 14 runs last among the geometry-related stages: simplification changes parents, so relative positions are recomputed afterwards.

## 2. Tree normalization

Rules are applied top-down. Each rule that drops or changes content records an `info` diagnostic only when content is lost.

| Rule | Action |
|---|---|
| `display:contents` (incl. `<slot>`) | splice children into the parent; no node (already resolved in the composed walk, [05](05-capture.md#walk)) |
| `display:none`, `<script>` and friends | already skipped by capture |
| `visibility:hidden` element | drop its own paint; keep `visibility:visible` descendants, reparented under a transparent frame at the same rect |
| `opacity:0` | keep with `visible:false` if `config.keepInvisible` (default **true** for alignment: states often toggle opacity), else drop |
| `srOnly` | drop (`CAP_SR_ONLY_DROPPED`, info) |
| zero-size element with no visible stroke, outline, shadow or overflowing children | drop |
| fully clipped by an ancestor's overflow | drop (`LAYOUT_CLIPPED_DROPPED`, info) |
| **anonymous flex/grid items**: direct non-whitespace text in a flex/grid container | wrap in a synthetic `text` node with rect from the text lines' union; `source.tag = '#anon'` |
| whitespace-only text between blocks | drop |
| pseudo `::before`/`::after` | already real nodes (`type:'pseudo'`) and treated as elements |
| `::marker` | TEXT sibling before the `li` content in a HORIZONTAL stack (synthesized wrapper `li/marker-row`) |
| native controls (`nativeAppearance:true`) | expand into synthetic subtrees per [05](05-capture.md#controls) (input → frame+text, checkbox → frame+check vector, …) |
| `nonAffine` | rasterize the subtree (§10.9) |

## 3. Container classification

```ts
type ContainerKind =
  | 'flex-row' | 'flex-col'
  | 'grid'
  | 'block-stack'        // block formatting context, only block-level in-flow children
  | 'inline-text'        // inline formatting context that merges into a single TEXT (+ overlays)
  | 'inline-row'         // exactly one line of atomic inlines (inline-block/inline-flex/img/svg)
  | 'table'
  | 'leaf'               // no children
  | 'absolute';          // anything else, or verification failed

function classify(n: CNode): ContainerKind {
  const d = n.computed!.display;
  if (!n.children.length) return 'leaf';
  if (d.endsWith('flex')) return n.computed!.flex!.direction.startsWith('column') ? 'flex-col' : 'flex-row';
  if (d.endsWith('grid')) return 'grid';
  if (d.startsWith('table')) return 'table';
  if (isInlineFormattingContext(n)) return canMergeAsText(n) ? 'inline-text' : (lineCount(n) === 1 ? 'inline-row' : 'absolute');
  const inflow = n.children.filter(c => !isOutOfFlow(c));
  if (inflow.every(c => isBlockLevel(c) && c.computed?.position !== 'float')) return 'block-stack';
  return 'absolute';
}
```

- `canMergeAsText(n)`: every inline descendant is decoration-free, or is an *overlay-able* decoration. Overlay-able means inline backgrounds or borders on `code`, `mark` or `a`, which become absolute rectangles per fragment (§8.6). No atomic inlines are allowed.
- **Out-of-flow children** (`position:absolute|fixed`) never affect classification. They become `ABSOLUTE` children of whatever layout the container gets (§4.6).
- **Floats** make the container `absolute` (`LAYOUT_FLOAT_ABSOLUTE`, info).
- **Tables:** a VERTICAL stack of HORIZONTAL rows. Each cell is a FIXED-width frame with the measured column width. Cell padding and border use the normal rules. `border-collapse` is approximated by giving shared borders to one side only (`PAINT_TABLE_BORDER_APPROX`). If verification fails, the table becomes `absolute`.

## 4. Flex / block → auto layout

### 4.1 Mapping table

| CSS | Scene (`SceneLayout`) | Condition / note |
|---|---|---|
| `flex-direction: row` / `column` | `mode: HORIZONTAL` / `VERTICAL` | |
| `row-reverse` / `column-reverse` | children emitted in reversed order; `primaryAxisAlignItems` MIN↔MAX swapped; `itemReverseZIndex: true` | keeps DOM paint order (figit) |
| `flex-wrap: wrap` (row) | `wrap: true`, `counterAxisSpacing = row-gap measured` | only if the `layout-sim` wrap packing reproduces the browser's row assignment exactly (figit `inferWrapStack`) |
| `flex-wrap: wrap` (column) | `mode: VERTICAL`, `wrap: true` | supported since typings Update 140 (verify, S-10); otherwise absolute |
| `wrap-reverse` | absolute | `LAYOUT_WRAP_REVERSE_UNSUPPORTED` |
| `gap`, margins between items | `itemSpacing` = the **measured** uniform gap between consecutive border boxes | includes collapsed margins; may be negative |
| `justify-content: flex-start/start/normal/left` | `primaryAxisAlignItems: MIN` | |
| `center` / `flex-end` / `end` / `right` | `CENTER` / `MAX` | |
| `space-between` | `SPACE_BETWEEN` | `itemSpacing` is ignored by Figma in this mode; emit 0 |
| `space-around` / `space-evenly` | `MIN` + `itemSpacing` = measured gap + padding absorbing the edge space | the typings now accept `SPACE_EVENLY`/`SPACE_AROUND` (Update 137), but rendering parity is unverified (figit saw SPACE_EVENLY render as space-between). Emit them only after S-10 confirms parity (`LAYOUT_SPACE_AROUND_APPROX`, info) |
| `align-items: flex-start/start/self-start` | `counterAxisAlignItems: MIN` | |
| `center` / `flex-end` | `CENTER` / `MAX` | |
| `baseline` / `first baseline` | `BASELINE` (HORIZONTAL only) | Figma's baseline uses Figma's metrics, so it must pass verification; otherwise MIN + per-child offsets → absolute (S-04) |
| `align-items: stretch/normal` | `counterAxisAlignItems: MIN`; children with cross size `auto` whose measured cross size equals the inner cross size → `sizing{V/H}: FILL` | |
| per-child `align-self` ≠ container's | wrap the child in a transparent FILL-on-cross frame (`nk` suffix `/align`) with its own `counterAxisAlignItems`; one wrapper per run of equal `align-self` | Figma has no per-child alignment except STRETCH (`LAYOUT_ALIGN_SELF_WRAPPED`, info) |
| `flex-grow > 0` | `sizing: FILL` only if every grower's measured main size equals `(inner − Σnon-growers − gaps) / nGrowers` (Figma FILL ≈ `flex: 1 0 0`) | otherwise FIXED at the measured size (pixels identical, resize behaviour differs; `LAYOUT_GROW_RATIO_FIXED`) |
| `flex-shrink`, `flex-basis` | — | baked into the measured size; probing (§4.5) detects responsiveness |
| `min/max-width/height` (px) | `child.min/max` (direct children of auto-layout frames, and the frames themselves) | percent → resolved px + `LAYOUT_PERCENT_RESOLVED` |
| `order` | stable sort of children by `order` | CSS paints in order-modified document order too, so paint stays consistent |
| `padding + border` | `padding = css.padding + css.border.width`, `strokesIncludedInLayout: false`, stroke INSIDE (D-16) | provably exact (figit). The alternative `strokesIncludedInLayout: true` with raw padding is `config.borderModel = 'native'` (verify, S-05) |
| `margin: auto` on main axis | 2 children → `SPACE_BETWEEN`; otherwise split into two sub-stacks at the auto margin with an outer `SPACE_BETWEEN` | `nk` suffixes `/start`, `/end` |
| `margin: 0 auto` (block child) | container `counterAxisAlignItems: CENTER` if all children agree; otherwise an align wrapper | |
| `box-sizing` | ignored | measured border boxes are always used |
| `direction: rtl` (row) | treated as `row-reverse` for emission | `LAYOUT_RTL_REVERSED`, info |

**Block stacks** (`block-stack`): `VERTICAL`. Padding is the container's padding plus border. The first child's margin-top is absorbed into the top padding, and the last child's margin-bottom into the bottom padding, unless they collapsed through the parent; measured rects decide which. The gaps are measured. Each child's width is FILL if it is `auto` and equals the inner width; otherwise FIXED, or HUG for inline-block and fit-content.

**Inline rows** (`inline-row`): `HORIZONTAL`. `counterAxisAlignItems` comes from `vertical-align` (`middle` → CENTER, `baseline` → BASELINE, `top` → MIN, `bottom` → MAX). Spacing is measured; whitespace between inline-blocks is part of the measured gap.

### 4.2 Margin strategies (Figma has no margins)

These are tried in order on every stack. The first one that passes simulation wins.

1. **Gap normalization:** all inter-child distances are equal (±0.5px) → `itemSpacing`.
2. **Padding absorption:** the leading and trailing edge margins fold into padding.
3. **Margin wrapper:** the odd child is wrapped in a transparent HUG frame whose padding equals the excess margin. It is named `‹child name› / margin` and has `nk` suffix `/m`.
4. **Sub-stack split** at the irregular gap: the container becomes a stack of two stacks with different spacing.
5. **Spacer frames** — only when `config.allowSpacers` is set (default false; designers dislike them).
6. **Absolute fallback** for this container (`LAYOUT_IRREGULAR_GAPS`).

### 4.3 Container sizing (`primaryAxisSizingMode` / `counterAxisSizingMode`)

`AUTO` (hug) means the measured size equals the content size plus padding. The container's own size intent must also be content-based on that axis:

- a keyword `auto|fit-content|max-content|min-content` in a shrink-to-fit context;
- or `height:auto` in normal flow.

Otherwise the mode is `FIXED`. Modes are **always set explicitly**: figit found that unset modes hug the primary axis and shrink.

A `SPACE_BETWEEN` container, or a container with FILL children, can never be AUTO on its primary axis. Figma would collapse it.

### 4.4 Child sizing decision

```ts
function childSizing(n: CNode, parent: ParentCtx, axis: 'h' | 'v'): 'FIXED' | 'HUG' | 'FILL' {
  const main = parent.mainAxis === axis;
  const intent = axis === 'h' ? n.authored?.width : n.authored?.height;
  const measured = axis === 'h' ? n.borderBox.w : n.borderBox.h;
  if (parent.kind === 'flex' || parent.kind === 'block-stack') {
    if (main && n.computed?.item?.grow && equalShare(n, parent)) return 'FILL';
    if (!main && isStretch(n, parent) && isAutoKeyword(intent) && near(measured, parent.innerCross)) return 'FILL';
    if (parent.kind === 'block-stack' && axis === 'h' && isAutoKeyword(intent) && near(measured, parent.innerWidth)) return 'FILL';
    if (intent?.kind === 'percent' && near(intent.resolvedPx, measured) && intent.value === 100) return 'FILL';  // intent "percent"
  }
  if (isContentSized(n, axis) && near(measured, contentSize(n, axis))) return n.kind === 'leaf-nontext' ? 'FIXED' : 'HUG';
  return 'FIXED';
}
```

- HUG is valid only on auto-layout frames and text (`@figma/plugin-typings`). Leaves such as images and vectors are always FIXED.
- FILL requires the parent to be an auto-layout frame in the final Scene. If the parent falls back to absolute (in the mapper or in the plugin), the child's sizing is rewritten to FIXED. This rewrite is embedded in `fallback` semantics: the plugin applies FIXED to every child when it applies a fallback ([09](09-plugin.md#fallback)).
- `near` uses ±0.5px.

### 4.5 Responsiveness from probes

When `CaptureDoc.probes` exists ([05](05-capture.md#probing)), the mapper refines the single-snapshot decisions. For each node and axis, take the slope `k = Δsize / ΔparentInner` across the probe widths:

| Observation | Decision |
|---|---|
| `k ≈ 1`, or equal share among growers | FILL |
| `k ≈ 0`, size equal to content | HUG |
| `k ≈ 0`, size not equal to content | FIXED |
| a plateau at the extremes | FILL + `min`/`max` taken from the plateau values |
| text reflows | text `autoResize: HEIGHT` + FILL width |
| the wrap row count or grid track count changes | confirms `wrap` / `auto-fill` |
| `structureHash` differs between probes | media-query breakpoint; probing is ignored for that node, and `LAYOUT_BREAKPOINT_IN_PROBE` is reported (breakpoints become viewport variants, [04](04-variant-model.md)) |

If probing contradicts the snapshot decision, probing wins. If they disagree in a way that breaks verification, the result is FIXED. `verified.responsive = 'probed'`.

### 4.6 Absolute children and constraints

Out-of-flow children (`position:absolute|fixed`), and hoisted nodes (§7), get `positioning: 'ABSOLUTE'` with `xy` relative to the parent's border box. This matters because a CSS containing block is the padding box, while Figma positions from the frame edge: add `border.width` to the offset.

Constraints come from which insets are non-`auto`:

| Insets set | `constraints.horizontal` |
|---|---|
| `left` only, or neither | `MIN` |
| `right` only | `MAX` |
| `left` + `right` (and width auto) | `STRETCH` |
| `left: 50%` + `translateX(-50%)` | `CENTER` |
| percent `left` + percent `width` | `SCALE` |

The vertical constraint uses `top`/`bottom` the same way.

`position: fixed` inside the story is treated as absolute relative to the variant root. `sticky` is treated as static at the current scroll position.

## 5. Grid

### 5.1 Mapping

| CSS | Scene |
|---|---|
| `display:grid` | `layout.mode: 'GRID'` |
| track count | `computed.grid.columnsPx.length` / `rowsPx.length` (resolved) |
| `fr` track (authored) | `{type:'FLEX', value: fr}` |
| `px` track | `{type:'FIXED', value: px}` |
| `auto`, `min-content`, `max-content`, `fit-content()` | `{type:'HUG'}` |
| `minmax(a, Nfr)` | `FLEX` + the children in that track get `min.w = a` |
| `minmax(a, b px)` | `FIXED` = resolved px (`LAYOUT_GRID_MINMAX_FIXED`) |
| `repeat(auto-fill/auto-fit, …)` | resolved count at the capture width, emitted as FIXED/FLEX tracks; `LAYOUT_GRID_AUTOFILL_FROZEN` unless probing shows the count is constant |
| `column-gap` / `row-gap` | `columnGap` / `rowGap` |
| child placement | snap each child's border-box left and top to the track start lines (cumulative sizes + gaps, ±0.5px) → `row`, `col`; the span is the number of tracks covered. The computed `grid-*-start` is often `auto` under auto-placement and is not trusted |
| `justify-self`/`justify-items` start/center/end | `alignH` MIN/CENTER/MAX; `stretch` → `sizingH: FILL` |
| `align-self`/`align-items` | `alignV`, same scheme |
| container sizing | plugin-created grids default to FIXED containers with FLEX tracks (typings Update 120). Emit sizing modes explicitly; a FLEX track is never allowed on a HUG axis |

### 5.2 Not representable → fallback chain

The following cannot be represented directly:

- overlapping items (several items in the same cell);
- `grid-auto-flow: dense` when it produces out-of-order placement;
- named areas with holes, when they create empty spanned regions that the Figma auto flow would fill;
- subgrid;
- masonry;
- negative implicit tracks.

For these, try in order:

1. **Uniform grid as wrap stack.** All tracks are equal, there are no spans, and the result is a row-major fill. Use HORIZONTAL `wrap` with a fixed width, as in figit's uniform-grid-as-wrap.
2. **Nested stacks.** A VERTICAL stack of HORIZONTAL row stacks with FIXED column widths. Requires no row spans.
3. **Absolute** (`LAYOUT_GRID_UNREPRESENTABLE`).

## 6. Verification, fallbacks and `expect` (D-15)

### 6.1 `layout-sim`: Figma's layout model, reimplemented

`packages/layout-sim` is a pure, deterministic model of Figma's auto layout. It is used for three things:

- (a) the mapper's capture-side verification;
- (b) `figma-fake`'s geometry, in tests ([12](12-quality.md));
- (c) estimating sizes before the plugin builds.

It is calibrated nightly against real Figma read-back ([12](12-quality.md#fidelity-harness)). Each calibration mismatch becomes a fixture.

```ts
export interface SimNode {
  nk: string; w: number; h: number;             // intrinsic/measured size used for FIXED and as HUG content proxy for leaves/text
  sizingH: 'FIXED' | 'HUG' | 'FILL'; sizingV: 'FIXED' | 'HUG' | 'FILL';
  positioning: 'AUTO' | 'ABSOLUTE'; visible: boolean;
  min?: { w?: number; h?: number }; max?: { w?: number; h?: number };
  layout?: SceneLayout; children?: SimNode[];
  grid?: SceneChild['grid'];
  absXY?: { x: number; y: number };
}
export function simulate(root: SimNode, outerConstraint?: { w?: number; h?: number }): Map<string, Rect>;   // rects relative to root
```

**What it models:**

- **HORIZONTAL and VERTICAL stacks.**
  - Padding, `itemSpacing` (including negative values), MIN/CENTER/MAX/SPACE_BETWEEN on the primary axis, MIN/CENTER/MAX on the counter axis.
  - BASELINE, approximated from text `lines[0].baseline`; marked low-confidence.
  - FILL distribution: equal share of the remainder; clamped by min/max with redistribution (iterated until stable, max 8 rounds).
  - HUG (content plus padding), FIXED.
  - Invisible children are skipped. ABSOLUTE children don't participate in flow and are placed at `absXY`.
- **Wrap.** Greedy line packing on the primary axis using the children's *outer* sizes. `counterAxisSpacing` applies between lines. Each line is aligned by `primaryAxisAlignItems`. Lines are distributed by `counterAxisAlignContent` (AUTO packs lines at the start; SPACE_BETWEEN spreads them). FILL children inside wrap are treated as their min width, or as FIXED if no min is set (verify, S-10).
- **Grid.**
  - Track sizing: FIXED → value. HUG → the max of its single-span items' sizes. FLEX → the remainder after FIXED, HUG and gaps, split by value.
  - Spanning items contribute to HUG tracks only when no single-span item exists, distributing their size evenly. This is an approximation; S-10 calibrates it.
  - Cell alignment uses `alignH/V`, and FILL stretches the item to the cell.
- **Text** is treated as a leaf with a given size. Reflow is not simulated, because text width parity is handled separately (§8.5).

**What it does not model:**

- constraints-driven resize of absolute children (only the initial placement);
- `layoutGrow` other than 0/1;
- rotation inside layout;
- `strokesIncludedInLayout: true` — stroke geometry is modelled only for INSIDE strokes with the D-16 default;
- text metrics.

### 6.2 Capture-side verification

```ts
const TOL_SIM = 0.6;     // px, capture-side (figit verifyGeometry uses 0.6)
function tryLayout(container: CNode, candidates: SceneLayout[]): { layout?: SceneLayout; maxDelta: number; reason?: string } {
  let best = { maxDelta: Infinity } as any;
  for (const cand of candidates) {                       // e.g. alignment permutations for margin:auto, alt border models
    const rects = simulate(toSimTree(container, cand));
    const maxDelta = maxAbsDelta(rects, measuredRects(container));     // x, y, w, h of every in-flow child (+ container size)
    if (maxDelta <= TOL_SIM) return { layout: { ...cand, verified: { simulator: VERSION, maxDelta, tolerance: TOL_SIM, responsive } }, maxDelta };
    if (maxDelta < best.maxDelta) best = { maxDelta, reason: describe(cand, rects) };
  }
  return { maxDelta: best.maxDelta, reason: best.reason };            // -> absolute container + LAYOUT_SIM_MISMATCH(info, data: delta)
}
```

Verification runs **bottom-up**, so a container is simulated with its children's final sizes. A child that hugs uses its own simulated HUG size, not the measured size. This catches compounding errors.

### 6.3 `fallback` and `expect`

- **`fallback`** is emitted for **every** node that has `layout`. It contains each child's `{x, y, w, h}` relative to the container and the container's own `size`. All values are taken from the browser measurement, so a fallback is pixel-correct by construction.
- **`expect`** is emitted on **every** node: its browser rect relative to the variant root. It is used for:
  - the plugin's read-back check: Figma `absoluteBoundingBox` minus the root's, compared within `TOL_READBACK = 1.0px`;
  - the fidelity harness (box deltas).
- **Plugin read-back** ([09](09-plugin.md#verify)) runs per auto-layout container, bottom-up. On a mismatch it applies relaxations in order:
  1. text width buffer (§8.5);
  2. HUG → FIXED on the offending child;
  3. FILL → FIXED;
  4. the full `fallback`: `layoutMode: NONE`, children FIXED at their fallback rects.

  Every relaxation is recorded as `APPLY_LAYOUT_RELAXED` or `APPLY_LAYOUT_FALLBACK`.

## 7. Paint order, stacking and hoisting

1. **Sort children** within each stacking context following CSS 2.1 Appendix E:
   1. negative z-index;
   2. in-flow blocks;
   3. floats;
   4. inlines;
   5. positioned elements with `auto`/0, in tree order;
   6. positive z-index.

   Use the `CPaintOrder` facts. Figma's child order is bottom → top.
2. **Flow order vs paint order.** In auto layout, child order *is* flow order. If the paint sort reorders *in-flow* children of a stack:
   - a full reversal → `itemReverseZIndex: true`;
   - otherwise → the out-of-order children become `ABSOLUTE` siblings, which can sit anywhere in the child list, if the remaining flow still verifies;
   - else the container is absolute.

   `order:` sorting is applied *before* this check, because it changes flow and paint identically.
3. **Z-index escapes.** A descendant that paints above a sibling of one of its ancestors cannot be expressed in a tree. Hoist it to the nearest common stacking-context frame as `ABSOLUTE`, with `xy` recomputed and clipping preserved. The clip is preserved only if the clipping ancestor is also the target; otherwise the node is wrapped in a clip frame with the ancestor's clip rect. Report `LAYOUT_ZINDEX_HOIST`. The hoisted node keeps its `nk` derived from the original path, so alignment and identity are stable.

## 8. Text

### 8.1 Runs → ranges

Each `CText` produces one `text` SceneNode.

- **Characters:** `characters` is taken verbatim (source characters), with `\n` for paragraph breaks and ` ` for `<br>`.
- **Ranges:** each `CText.runs[i]` becomes a `SceneTextRange` built from its `CTextStyle`. Adjacent runs whose Scene representation is identical are merged after mapping. They are compared on the canonical JSON of their Scene fields, not on their CSS.
- **Hyperlinks:** `href` maps to `hyperlink`.
- **Gradient text:** `gradientFrom` (from `background-clip:text`) produces a gradient fill on the range. Its `gradientTransform` is computed relative to the **ancestor box**, mapped into the text node's box: compose the ancestor-space matrix with the text node's offset.

### 8.2 Style mapping

| CSS | Scene range field | Notes |
|---|---|---|
| `font-size` | `fontSize` | px |
| `line-height` | `lineHeight {PIXELS, lineHeightPx}` | **always px** (D-17). `normal` uses the measured value (`lineHeightSource` normal-measured, or normal-probed for a single line); never `1.2 × size` (wrong for Inter ≈1.21, Roboto ≈1.17; satori `font.ts`) |
| `letter-spacing` | `letterSpacing {PIXELS}` | `normal` → 0 |
| `word-spacing` ≠ 0 | — | `TEXT_WORD_SPACING_DROPPED` (warn) |
| `text-transform: uppercase/lowercase/capitalize` | `textCase: UPPER/LOWER/TITLE` | the source characters stay editable. CSS `capitalize` ≠ Figma TITLE in edge cases (e.g. after apostrophes); detect by comparing the rendered `lines` widths, and if they differ, bake the transform into `characters` + `TEXT_CASE_BAKED` |
| `font-variant-caps: small-caps` | `SMALL_CAPS` | |
| `text-decoration-line` (propagates from ancestors; figit walks parents) | `decoration` UNDERLINE / STRIKETHROUGH | `overline` → absolute 1-px rect overlay + `TEXT_OVERLINE_OVERLAY` |
| `text-decoration-style/color/thickness`, `text-underline-offset` | `decorationStyle/Color/Thickness/Offset` | `double`/`dashed` → SOLID + `TEXT_DECORATION_STYLE_APPROX` |
| `color` | `fills: [SOLID]` | bound to a variable when its var chain is pure (§16) |
| `font-feature-settings`, `font-variant-numeric` | `openTypeFeatures` | `tnum`, `lnum`, `ss01`… |
| `font-variation-settings`, `font-optical-sizing` | `font.variation` | |
| `text-shadow` | node `effects: DROP_SHADOW` (spread 0) | only when uniform across ranges; otherwise the dominant shadow + `TEXT_SHADOW_RANGE_APPROX` |
| `text-align` | `alignH` | `start/end` already resolved via `direction` |
| `text-indent` | `paragraphIndent` | |
| `text-wrap: balance/pretty` | `wrapStyle: BALANCE/PRETTY` | typings Update 134 |
| `text-box-trim` / `text-box-edge: cap alphabetic` | `leadingTrim: CAP_HEIGHT` | |
| `hanging-punctuation` | `hangingPunctuation` (node) | |
| `-webkit-text-stroke` | node `strokes` CENTER | only when uniform |
| `vertical-align: super/sub` in a run | `TEXT_BASELINE_SHIFT_DROPPED` (warn); size kept | Figma has no baseline shift in ranges |

### 8.3 Auto-resize and truncation

```ts
function textSizing(t: CText, n: CNode, parent: ParentCtx): Pick<SceneText, 'autoResize' | 'truncation'> & { sizingH: Sizing } {
  const singleLine = distinctTops(t.lines, 1) === 1;
  if (t.textOverflow === 'ellipsis' && t.whiteSpace.includes('nowrap')) return { autoResize: 'NONE', truncation: { maxLines: 1 }, sizingH: 'FIXED' };
  if (t.lineClamp) return { autoResize: 'NONE', truncation: { maxLines: t.lineClamp }, sizingH: fillOrFixed(n, parent) };
  if (singleLine && (t.wrap === 'nowrap' || isContentSized(n, 'h'))) return { autoResize: 'WIDTH_AND_HEIGHT', sizingH: 'HUG' };
  return { autoResize: 'HEIGHT', sizingH: fillOrFixed(n, parent) };   // multi-line: FILL if stretches, else FIXED width
}
```

- **Truncated text:** the capture holds the *full* text; the browser draws the ellipsis itself. In Scene, set `textTruncation: ENDING` and `maxLines`, with a fixed height from the measured lines.
- **Vertical alignment:** `alignV` is TOP unless the text box is taller than its lines. That happens when the text is a flex item with stretch, or a fixed-height box. In that case `alignV` is derived from where the line block sits within the box: top, center or bottom, ±0.5px.

### 8.4 Inline decorations → overlays

Inline backgrounds and borders (`code`, `mark`, chip spans) inside a merged text node become **absolute RECTANGLE siblings placed under the TEXT node**, one per fragment. They carry the fragment's fill, radius and stroke, and have `nk` `…/text/overlay-<i>`.

When the text node's parent is an auto-layout frame, text and overlays are wrapped in a transparent frame (`nk` `…/text-wrap`). The wrapper takes the text's sizing, and its children are absolute overlays plus the text at 0,0.

This approach suits `reflow` mode badly: the overlays don't follow a reflow. When overlays exist, the mapper therefore forces `wrapMode: 'locked-lines'` for that text and reports `TEXT_OVERLAY_LOCKED`.

### 8.5 Wrap parity: reflow vs locked lines (D-17)

Figma remeasures glyph advances slightly differently from Chromium (hinting, shaping), so a fixed-width text box may wrap differently (S-04).

- **`reflow`** (default): `characters` is unchanged and the text is fully editable. The Scene carries `lines` (the browser's break offsets) and `widthBuffer.max`. The default formula is `min(4, 0.25 × fontSize)` px, tuned per weight and size by S-04; figit uses 0–5px slack.
  - **Plugin policy** ([09](09-plugin.md#text)): after setting the text, compute the line count from height. If Figma's count is greater than the browser's, widen by 0.5px steps up to `widthBuffer.max`, applied as `minWidth` where possible so the box stays FILL or HUG. If it still differs, report `TEXT_LINE_MISMATCH` (warn).
  - Fewer lines than the browser means Figma is narrower-advancing. That is accepted when the block height is equal ±1px; otherwise `TEXT_LINE_MISMATCH`.
- **`locked-lines`**: insert ` ` at the browser's break offsets (soft-hyphen breaks get a visible hyphen) and set `autoResize: WIDTH_AND_HEIGHT` or `HEIGHT` with buffer. Lines are identical, but editing reflows unnaturally. It is used by config, or forced when overlays exist (§8.4).

### 8.6 Fonts → `SceneFontRequest`

The mapper does **not** know which fonts the Figma user has. It emits a *request*, and the plugin preflight resolves it against `figma.listAvailableFontsAsync()`. The user can remap fonts there ([09](09-plugin.md#fonts), [11](11-ux.md)).

1. **Family.** Use the dominant platform font: `CTextStyle.used[0]`, sorted by `glyphCount`. If several fonts have substantial glyph counts (≥10% each), **split the run by Unicode script**, giving each sub-run its own family (CJK and emoji fallback). This avoids tofu, which is a known gap in Figma code-to-canvas.
2. **Weight to style candidates.** Prefer deriving the style from `postScriptName`. For example, `Inter-SemiBoldItalic` → `["Semi Bold Italic", "SemiBold Italic"]`. Then append synonyms from the table, matched without spaces or case:

   | CSS weight | Synonyms |
   |---|---|
   | 100 | Thin, Hairline |
   | 200 | ExtraLight, Extra Light, UltraLight |
   | 300 | Light |
   | 400 | Regular, Normal, Book, Roman |
   | 500 | Medium |
   | 600 | SemiBold, Semi Bold, DemiBold, Demi Bold |
   | 700 | Bold |
   | 800 | ExtraBold, Extra Bold, UltraBold |
   | 900 | Black, Heavy |
   | italic | "‹W› Italic", "Italic" (for 400), "Oblique" |

   After the exact weight, the order follows CSS font matching:
   - target 400–500: the target, then 500, then descending, then ascending;
   - target < 400: descending first;
   - target > 500: ascending first.

   The plugin picks the first candidate that exists.
3. **Variable fonts.** When `variation` is present, or the family is known to be variable, emit `variation: {wght, opsz, …}`. The plugin uses `FontName.variationSettings` with `style` omitted (typings Update 138), and drops axes not reported by `figma.getFontFamilyVariationAxes`.
4. **Synthetic bold or italic** (`synthetic`). Request the real style (e.g. Bold) and report `FONT_SYNTHETIC` (info). The capture drew a faux bold, and Figma will draw the real one.
5. **`fallbackFamily`.** Choose by generic class (sans/serif/mono) and closest x-height. Default `Inter`, `Roboto Mono` or `Noto Serif`; the table is configurable. Missing fonts are *not* diagnosed here: the plugin emits `FONT_MISSING` / `FONT_SUBSTITUTED` after preflight.
6. **Icon fonts** (`CFontUsage.iconFont`) are not text. Capture has already provided the outlined SVG asset ([05](05-capture.md#icon-fonts)), and the node becomes `svg` (S-09).

## 9. Colors

- Convert with **colorjs.io and gamut mapping** (`toGamut({space: 'srgb', method: 'css'})`). Raw `.srgb` conversion can produce out-of-range channels (figit). If the target file profile is `DISPLAY_P3` (`config.colorProfile`, confirmed by the plugin handshake from `figma.root.documentColorProfile`), emit P3 values instead.
- When the source was `oklch`/`lab`/`p3`, attach `sourceColor` so Figma keeps the original color space (typings Update 141; feature `source-color`).
- **SOLID alpha:** the color carries `a = 1`, and the CSS alpha goes into `paint.opacity`. Gradient stops and effects carry `color.a` (typings convention).
- **`transparent` stops:** replace them with the neighbour stop's RGB at alpha 0 to avoid grey fringes, because CSS interpolates in premultiplied space.
- **`in oklch` and other interpolation spaces:** pre-sample 8 intermediate stops per segment.

## 10. Visuals

### 10.1 Backgrounds → fills

- **Order.** Figma fills run bottom → top, while CSS lists the topmost layer first. Fills are therefore `[background-color, ...layers.reverse()]`.
- **Clip.** `background-clip: padding-box | content-box` → the fill moves to an absolute inner RECTANGLE (`nk` `…/bg`), inset by border or by border + padding, with the inner radius (radius − inset, floored at 0).
- **`background-clip: text`** → gradient text (§8.1); the element's own fill is removed.

**Image layers** (`url`):

| `background-size` / `repeat` | Scene |
|---|---|
| `cover` | IMAGE `FILL` |
| `contain` | `FIT` |
| `repeat` (any size) | `TILE`, `scalingFactor = tileW / naturalW` |
| explicit size or position | `CROP` with `imageTransform` mapping the drawn image rect into the box: `[[bw/iw, 0, -ix/iw], [0, bh/ih, -iy/ih]]` with box size `(bw, bh)` and image rect `(ix, iy, iw, ih)` in box px |

Two cases fall back to a raster (§10.9): a CROP whose image extends beyond the box *and* whose position is not representable, and `background-attachment: fixed`.

**`<img>`** follows the same table using `object-fit`/`object-position`. `none` and `scale-down` map to CROP. The frame radius is kept.

### 10.2 Gradients → `gradientTransform`

Figma's `gradientTransform` maps **normalized node space (0..1)** to **gradient space**. In gradient space, a linear gradient runs from (0, 0.5) to (1, 0.5), and a radial gradient has centre (0.5, 0.5) and radius 0.5. The direction of this convention and the identity behaviour must be confirmed by S-03. The code assumes `t = m00·x + m01·y + m02`.

```ts
type M = [[number, number, number], [number, number, number]];
const inv = (m: M): M => { /* 2x3 affine inverse */ };

// LINEAR — CSS angle θ (0deg = to top, clockwise). Gradient line length L = |w·sinθ| + |h·cosθ|.
export function linear(thetaDeg: number, w: number, h: number): M {
  const t = (thetaDeg * Math.PI) / 180, dx = Math.sin(t), dy = -Math.cos(t);
  const L = Math.abs(w * dx) + Math.abs(h * dy) || 1;
  const s = { x: w / 2 - (dx * L) / 2, y: h / 2 - (dy * L) / 2 }, e = { x: w / 2 + (dx * L) / 2, y: h / 2 + (dy * L) / 2 };
  const q = { x: -(e.y - s.y), y: e.x - s.x };            // perpendicular (px)
  const G2N: M = [[(e.x - s.x) / w, q.x / w, s.x / w - (0.5 * q.x) / w],
                  [(e.y - s.y) / h, q.y / h, s.y / h - (0.5 * q.y) / h]];   // gradient space -> normalized node space
  return inv(G2N);
}
// "to top right" etc.: the angle such that the 50% line passes through the other two corners: θ = atan2(w, h) variants.
// Stop px offsets are already normalized to [0,1] along L by capture.

// RADIAL — ellipse radii (rx, ry) px centred at (cx, cy) px.
export function radial(cx: number, cy: number, rx: number, ry: number, w: number, h: number): M {
  return [[w / (2 * rx), 0, 0.5 - cx / (2 * rx)], [0, h / (2 * ry), 0.5 - cy / (2 * ry)]];
}
// size keywords resolved by capture: farthest-corner ellipse rx = √2·max(cx, w−cx), ry = √2·max(cy, h−cy); circle r = dist to farthest corner.

// CONIC (→ GRADIENT_ANGULAR) from φ at (cx, cy). Figma's angular origin is 3 o'clock, CSS 12 o'clock → rotate by ψ = 90° − φ.
export function conic(phiDeg: number, cx: number, cy: number, w: number, h: number): M {
  const p = ((90 - phiDeg) * Math.PI) / 180, c = Math.cos(p), s = Math.sin(p), k = 1 / Math.max(w, h);
  return [[k * c * w, -k * s * h, 0.5 - k * (c * cx - s * cy)], [k * s * w, k * c * h, 0.5 - k * (s * cx + c * cy)]];
}
```

Verify the conic origin and direction in S-03 (`PAINT_CONIC_APPROX` until then).

- **Repeating gradients.** Tile one period of stops across 0..1, capped at 256 stops (figit `tileRepeatingStops`, `PAINT_REPEATING_CAPPED`).
- **Hard stops.** Nudge coincident stop positions by 1e-5, because Figma reorders equal offsets (figit `separateCoincidentStops`).
- **Elliptical-radial with non-uniform scale.** Representable by the matrix above.
- **`radial-gradient` with `closest-side` and friends.** Resolved in capture; the mapper only sees px radii.

### 10.3 Borders, outline, radius (D-16)

| Case | Scene |
|---|---|
| uniform color & style, any widths | `strokes {paints:[SOLID], align: INSIDE, weight {t,r,b,l}}`; layout padding includes the border (§4.1) |
| `dashed` | `dashPattern: [2w, w]` (Chrome draws dashes about 2× the width) + `PAINT_DASH_APPROX` (info), because Figma phases dashes around corners continuously |
| `dotted` | `dashPattern: [0, 2w]`, `cap: ROUND` |
| per-side **colors or styles** differ, no radius | decompose into four absolute VECTOR siblings (mitered trapezoids, figit `border-decomposition.ts`), `nk` `…/border-{t,r,b,l}`; node `strokes` removed; `PAINT_BORDER_DECOMPOSED` (info) |
| per-side differ, with radius | rounded-path decomposition (figit `rounded-dash-border.ts`) when `config.exactBorders`; else dominant color + `PAINT_BORDER_DOMINANT` (warn) |
| `double`, `groove`, `ridge`, `inset`, `outset` | decomposition (figit `border-3d.ts`) or solid approximation + `PAINT_BORDER_STYLE_APPROX` |
| `outline`, no border | stroke `align: OUTSIDE`, weight = outline-width (only if `outline-offset` = 0) |
| `outline`, with border or offset ≠ 0 | absolute sibling FRAME (no fill) inflated by `offset + width`, radius + offset, INSIDE stroke; `nk` `…/outline` |
| `border-radius` | corner px with the CSS overlap reduction `f = min(1, w/(tl+tr), w/(bl+br), h/(tl+bl), h/(tr+br))`; `smoothing: 0` |
| elliptical radii (`h ≠ v`) | `config.exactRadii` → vector path (`kind: 'vector'`, mask for children if needed); else `min(h, v)` + `PAINT_ELLIPTICAL_RADIUS_APPROX` |
| percent radius | resolved by capture (the computed value is px or %; resolve against w/h) |

### 10.4 Shadows and effects

**`box-shadow`** (already parsed, CSS order with the first shadow on top):

- outer → `DROP_SHADOW {offset, radius: blur (1:1), spread, color}`;
- `inset` → `INNER_SHADOW`;
- the array is reversed into Figma order (bottom → top) (verify, S-03).

**Spread.** It is honoured only on rectangles and ellipses, or on frames with a visible fill *and* `clipsContent` (`plugin-api.d.ts` around L4369). For a frame with spread ≠ 0 that does not qualify:

- If the frame has a fill and no overflowing children, set `clipsContent: true`. This is only safe when the subtree has nothing outside the frame bounds: check the children's `expect` against the frame.
- Otherwise move the shadow onto an absolute backing RECTANGLE (`nk` `…/shadow`) as the first child, with the same size and radius and a fill equal to the element background (or 1% alpha black when there is no background, with `showShadowBehindNode: false`). Report `PAINT_SPREAD_BACKING_RECT` (info).

**Ring shadows** (`0 0 0 Npx c`, Tailwind `ring-*`) on fill-less frames render as nothing in Figma (figit):

- no border → promote the widest ring to an OUTSIDE stroke;
- otherwise use the backing-rect rule.

**`showShadowBehindNode: false`** for shadows under translucent fills, emulating CSS (verify, S-03).

**Filters:**

| Filter | Scene |
|---|---|
| `filter: drop-shadow()` | `DROP_SHADOW` (alpha-based, a semantic match) |
| `filter: blur(σ)` | `LAYER_BLUR` with `radius = 2σ` (figit `blur.ts` measured Chrome falloff) |
| `backdrop-filter: blur(σ)` | `BACKGROUND_BLUR` with `radius = 2σ` (verify, S-03) |
| other filters (`grayscale`, `brightness`, `contrast`, `hue-rotate`, `saturate`, `sepia`, `invert`) | image fill: `ImagePaint.filters`; otherwise raster (§10.9) + `PAINT_FILTER_RASTERIZED` |

### 10.5 Opacity, blend, clip, masks

| CSS | Scene |
|---|---|
| `opacity` | node `opacity` |
| `mix-blend-mode` | `blendMode` 1:1 (`plus-lighter` → raster) |
| `isolation: isolate` | frame `blendMode: NORMAL` (not PASS_THROUGH) |
| `overflow` ≠ visible (either axis) | `clipsContent: true` (respects radius). Figma clips both axes, so `overflow-x:hidden; overflow-y:visible` becomes a clip on both axes + `LAYOUT_OVERFLOW_AXIS_APPROX` |
| scroll containers | children offset by −scroll; clip |
| `clip-path: inset(... round r)` | wrapper frame with that rect and radius + `clipsContent` |
| `clip-path: circle/ellipse/polygon/path()` | VECTOR mask (`isMask: true`, `maskType: VECTOR`) as the first child of a wrapper frame (`nk` `…/clip`) |
| `mask-image` single SVG/PNG over a solid background (the icon pattern) | tinted `svg` or image node (web2ui) |
| `mask-image` gradient | rectangle mask `maskType: ALPHA` with a gradient fill |
| other `mask-image` | raster |

### 10.6 Transforms

Use the capture's page-space affine to compute `relativeTransform = inverse(parentPageMatrix) · nodePageMatrix`.

- A pure translation becomes `xy`.
- A node with rotation, scale or skew inside an auto-layout parent becomes `ABSOLUTE`, unless it is a leaf whose AABB matches its flow slot. In that case it stays AUTO and gets its rotation (Figma lays out rotated children by their bounding box (verify, S-10)).
- Skew is expressible only via `relativeTransform`.
- `transform3d` is in beta in typings Update 142 and is not used in v1. `nonAffine` content is rasterized.

### 10.7 SVG

`replaced.kind === 'svg'` becomes a `svg` SceneNode with `unwrap: true`: the plugin unwraps `createNodeFromSvg`'s single-child frame. Capture inlines computed styles, resolves `currentColor` and `<use>` (searching all shadow roots, as in modern-screenshot `embed-svg-use.ts`), and serializes the result.

SVGs with `hasFilter` or `hasForeignObject` are rasterized (`SVG_RASTERIZED`, warn). Masks and clipPaths are attempted, and verification flags failures (S-09).

Repeated SVGs (same normalized hash) are candidates for icon componentization, which is a planner and plugin concern ([04](04-variant-model.md), [09](09-plugin.md#icons)). The mapper only marks them: `source.component` plus `svgHash` in diagnostics data.

### 10.8 Native controls

The synthesized subtrees from §2 are mapped like any other nodes:

- checkbox and radio checks become vectors filled with `accent-color`;
- the range thumb is positioned by `(value − min) / (max − min)`.

These nodes carry `CAP_NATIVE_CONTROL_SYNTHESIZED` (info).

### 10.9 Rasterization criteria

A subtree is replaced by an `image` node holding the capture's clip screenshot (`replaced.kind: 'raster'`, requested by the mapper in a *second capture pass*, [05](05-capture.md#raster-requests)) when **any** of these hold:

- non-affine transform;
- an unsupported `filter` on a non-image;
- `mix-blend-mode: plus-lighter`;
- a complex `mask-image`;
- an SVG with filter or foreignObject;
- `<canvas>` or `<video>`;
- `background-attachment: fixed`;
- `config.rasterize` selectors.

Rasterized nodes keep their `nk` and name, add the `rasterized-subtrees` feature, and report `PAINT_SUBTREE_RASTERIZED` (warn). Raster requests are **batched per variant**: the mapper returns `needsRaster: nodeId[]`, the CLI recaptures those clips, and the mapper re-runs. The output stays deterministic because raster assets are content-hashed.

## 11. Tree simplification

These rules run bottom-up after layout and visuals, and before alignment. A node carrying `source.testId`, `figmaName`, `figmaKey` or a component boundary is **never collapsed away**: it is an alignment anchor.

1. **Pass-through wrapper.** No fills, strokes, effects, clip or opacity, no own layout semantics (or the same layout as its single child), and a single child with an equal rect. The node is replaced by its child, which inherits the wrapper's `child` sizing and keeps the better name (§12).
2. **Same-direction nesting.** A stack inside a stack with the same `mode`, where the inner stack is FILL on the primary axis, has 0 padding and no visuals → merge, if the merged `itemSpacing` is uniform.
3. **Text-only element.** A block with a single text child and no visuals → the TEXT node takes the element's place, name and `child` props (figit `isPlainTextElement`).
4. **Adjacent text siblings** with identical style on the same line, in a non-auto-layout parent → merge.
5. **Leaf frame.** A leaf frame with only fills, strokes or radius and no children → `rectangle`. It stays a `frame` if it has spread shadows (§10.4) or `config.preferFrames`.
6. **Groups.** Emitted only for transparent absolute wrappers in absolute parents. Never inside auto layout.
7. **Zero-size nodes** are dropped unless they carry a visible stroke or effect.

## 12. Naming

Each node is named by the first match in this list:

1. `source.figmaName` (`data-figma-name`)
2. `source.testId`, humanized (`btn-label` → "Btn label")
3. component boundary `displayName` (React fiber / Vue / Angular / custom-element tag, [05](05-capture.md#boundaries))
4. root only: `"Variant=…, Size=…"`, the Figma variant name built from property values
5. ARIA: `aria-label`, or `role` → `"Button"`, `"Icon"`, …
6. semantic tag map: `nav` → Navigation, `ul` → List, `li` → Item, `img` → Image, `svg` → Icon, `input` → Input, `label` → Label, `h1`–`h6` → Heading, `p` → Paragraph, `a` → Link (figit `naming.ts`)
7. BEM or class heuristic: the first class that is not a utility class. Skip Tailwind-like tokens (`/^(m|p|w|h|flex|grid|text|bg|border|rounded|gap|items|justify)-/`), CSS-module hashes (`/_[a-z0-9]{5,}$/`) and CSS-in-JS classes (`/^(css|sc|emotion)-/`). Then BEM `block__elem--mod` → "Elem"
8. text nodes: their characters, truncated to 40 characters, whitespace-collapsed
9. synthetic nodes: role suffix: "Background", "Border top", "Outline", "Shadow", "Overlay 1"

**Uniqueness.** Figma matches overrides by **layer name and hierarchy** during swaps and variant switches (Help Center 360039150413). Sibling names therefore must be unique and stable:

- duplicates get suffixes ` 2`, ` 3` in paint order;
- the suffix comes from the *aligned* index (§13), not from per-variant order, so "Item 2" is the same node in every variant.

Names are finalized after alignment, and **identical across all variants** for the same `nk`. The only exception is text-derived names when the text differs between variants. Those take the default variant's name.

## 13. Cross-variant alignment {#alignment}

**Why.**

- Instances keep overrides when the user switches variants only if the corresponding layers have the same name and hierarchy.
- A component property (TEXT or BOOLEAN) defined on the set must bind to the corresponding layer in **every** variant.
- Sync identity (`nk`) must be stable across variants and runs ([10](10-sync.md)).

The mapper therefore computes one **aligned tree** per component. It is the structural union of all variants, and every variant's tree is a projection of it.

### 13.1 Algorithm

```ts
interface ANode { nk: string; members: Map<string /* vk */, MNode /* mapped node in that variant */>; children: ANode[] }

function alignComponent(variants: Array<{ vk: string; root: MNode }>, def: string /* default vk */): ANode {
  const order = [def, ...variants.map(v => v.vk).filter(v => v !== def).sort()];   // deterministic
  const aRoot: ANode = { nk: 'root', members: new Map(), children: [] };
  for (const vk of order) mergeInto(aRoot, variantRoot(vk), vk);
  assignKeys(aRoot);           // nk paths from anchors + slugs (13.3)
  return aRoot;
}

function mergeInto(a: ANode, m: MNode, vk: string) {
  a.members.set(vk, m);
  const pairs = matchChildren(a.children, m.children);      // 13.2
  const used = new Set<ANode>();
  for (const [ac, mc] of pairs) { if (ac) { mergeInto(ac, mc, vk); used.add(ac); } else { const n = newANode(); insertAtAlignedPosition(a, n, mc, pairs); mergeInto(n, mc, vk); } }
}
```

### 13.2 Child matching

Matching is order-preserving, at the cost of being optimal-plus-ordered rather than globally optimal. Within each parent, existing aligned children `A[0..p)` are matched against a variant's children `M[0..q)` in two passes.

**Pass 1: anchors.** These are exact matches, removed first. Anchors cannot cross each other, and conflicting anchors (for example, the same testId on two nodes) trigger `PLAN_ALIGNMENT_ANCHOR_CONFLICT` (warn) and fall back to pass 2.

| Anchor | Equal when |
|---|---|
| `figmaKey` | equal |
| `testId` | equal |
| component boundary | same `displayName` and the same index among same-name siblings |
| pseudo role | `::before` ↔ `::before` |
| synthetic role | `/border-t` ↔ `/border-t` |

**Pass 2: ordered DP alignment.** On the unanchored segments between anchors, run a sequence alignment (Needleman–Wunsch / weighted LCS) with gap cost `G = 1.0` and match cost:

```
cost(a, m) = 0.35·[tag/kind differ]
           + 0.20·(1 − jaccard(classesSig(a), classesSig(m)))      // utility/hashed classes removed
           + 0.15·[role/aria differ]
           + 0.10·textDistance(a, m)                               // normalized Levenshtein on first 40 chars; 0 if either has no text
           + 0.10·rectDistance(a, m)                               // |Δx|+|Δy|+|Δw|+|Δh| relative to parent size, capped at 1
           + 0.10·(1 − childSigSimilarity(a, m))                   // multiset of child kinds
match allowed iff cost < 0.6
```

Here `a` is represented by its default-variant member (or its first member). Ties are broken by lower index. The DP is O(p·q) per parent, which is trivial for components.

Kinds are compatible as follows:

- `text` ↔ `text`;
- `frame` ↔ `frame`/`rectangle`/`component` (a promotion is allowed; the aligned node takes the *richest* kind, frame);
- `svg` ↔ `svg`;
- `instance` ↔ `instance` only when the sid is the same. A different sid is allowed only if the parent property is INSTANCE_SWAP (§14).

### 13.3 Keys

`nk` is a path of slugs from the root, for example `root/leading/icon` or `root/label`:

- **Slug source:** in the order `figmaKey` → testId → boundary name → role-derived name → tag. Slugs are kebab-cased.
- **Disambiguation:** duplicate slugs among siblings get `-2`, `-3` in aligned order.
- **Synthetic nodes:** the slugs `/bg`, `/border-t`, `/outline`, `/shadow`, `/align`, `/m`, `/clip`, `/text-wrap`, `/overlay-<i>`.

**Stability across runs** ([10](10-sync.md#node-keys)): for the same DOM structure the key is identical, because nothing depends on rect values. Rect similarity affects only *matching*, never the slug.

### 13.4 Projection: superset trees per variant

For every variant, the Scene tree contains **every aligned node**. Nodes the variant lacks are emitted as **hidden placeholders**:

- `visible: false`;
- the kind, name and size of the nearest member (by the order in §13.1);
- the position from that member's `fallback`.

Hidden children in auto layout take no space, so geometry is unchanged. Placeholders are what make BOOLEAN `visible` bindings and variant switching preserve overrides.

Limits:

- Placeholder emission is capped by `config.alignment.maxPlaceholdersRatio` (default 0.5 of the variant's real node count).
- If the variants of a component are structurally unrelated, more than 50% of nodes would be unmatched. Alignment then stops at that subtree: the per-variant subtrees are kept under one aligned container node with distinct `nk`s, as `…/alt-<vk8>`. The result is `PLAN_ALIGNMENT_DIVERGENT` (warn), which tells the user that these variants might be better as separate components ([04](04-variant-model.md)).

**Order.** Aligned children are ordered by first appearance in the default variant, then by insertion position (`insertAtAlignedPosition` puts a new node after its aligned left neighbour). This is deterministic.

**Paint-order conflicts.** Two variants can disagree on the relative order of two aligned nodes (a z-index change between states). The aligned order follows the default variant. The other variants get the moved node as `ABSOLUTE` (if verification allows); otherwise `PLAN_ALIGNMENT_ORDER_CONFLICT` and that variant's parent falls back to absolute.

## 14. Component property binding

Inputs come from the planner ([04](04-variant-model.md)): each arg's classification, with render-diff evidence that lists the capture node ids that changed between probe renders.

| Classification | Binding emitted |
|---|---|
| `VARIANT` | values encoded in the variant names; no node refs |
| `BOOLEAN` | the aligned node(s) whose presence or visibility differs between the true and false renders get `propRefs.visible = key`. If several disjoint subtrees toggle together, each gets the same ref. The *placeholder* (§13.4) carries the ref in variants where the arg is false. The default value comes from the default variant |
| `TEXT` | the single aligned `text` node whose `characters` changed between the sample-string renders gets `propRefs.characters = key`. The default value is the default variant's characters. If several text nodes changed (e.g. a label echoed into aria-hidden text), all are bound. If *non-text* geometry changed beyond auto-layout reflow, the planner demotes the arg to VARIANT or FIXED (D-13) |
| `INSTANCE_SWAP` | the aligned `instance` node gets `propRefs.mainComponent = key`; the property's `preferredValues` lists all observed `SceneComponentRef`s (e.g. every mapped icon) |
| `SLOT` | the aligned frame that wraps the slotted content (from the slot boundary, [05](05-capture.md#slots)) gets `slot: {propKey}`. Its children in the default variant become the slot's default content. Feature `slots`; downgraded to a plain frame when unsupported |
| `FIXED` / `IGNORED` | nothing |

**Constraints checked:**

- Every property has ≥1 bound node; otherwise `PLAN_PROPERTY_UNBOUND`, and the property is dropped.
- A node is bound to at most one property per field.
- TEXT and BOOLEAN refs are on the *same nk* in every variant, which alignment guarantees.

## 15. Nested component instances (D-21)

**Input.** The boundaries (`CComponentBoundary` with `matchedSid` and `props`) from capture, and the catalog of components in this run or already in the file, each with its **property value map** (`PropSource.valueMap`: arg value → Figma value).

For each boundary whose `matchedSid` is in the catalog and is not the component being mapped (no self-instancing):

1. **Props to properties.** Map the boundary props to the target's properties: VARIANT values through the value map, TEXT and BOOLEAN directly. Props that the target classified as FIXED must equal the target's fixed args; otherwise the result is `PLAN_INSTANCE_PROPS_UNMAPPED` and the node stays a frame.
2. **Find the target variant.** Choose the variant `vk` whose VARIANT values match.
3. **Verify.** The boundary's subtree rect must equal the target variant's root size (±1px). The subtree's structural hash must equal the target's aligned projection, ignoring text characters and visibility controlled by properties. Two other routes exist:
   - `confidence: 'structural'` comes from capture-side subtree-hash matching alone (no framework info); it is accepted only if the hash equality is exact.
   - Name-only matches are never auto-substituted.
4. **Emit.** On success, replace the subtree with a `kind: 'instance'` leaf:
   - `instance.component = {kind: 'local', sid, vk}`;
   - `properties` set from the mapped props;
   - `overrides` only for visible-only differences not covered by properties (last resort);
   - `match` = evidence.

   The node's own `child` sizing comes from its slot in the parent.
5. **Fail.** On failure, keep the expanded frames and report `PLAN_INSTANCE_MISMATCH` (info, data: delta). The structure still aligns, and a later phase can retry after the dependency is imported.

`dependencies` lists the referenced sids. The plugin builds in topological order and breaks cycles by expanding (`PLAN_INSTANCE_CYCLE`).

## 16. Token binding emission

The token resolver ([08](08-tokens.md)) gives, per capture node and CSS property, the pure var chain (`CVarChain.pure`) and the variable key of the chain's **first** custom property. The first property is used because it is the most semantic: `--btn-bg`, not `--blue-500`. Aliases preserve the chain in `tokens.json`.

| CSS property | Scene field |
|---|---|
| `background-color` | `fills[0].bind` (the SOLID bottom fill) |
| gradient stop color | `gradientStops[i].bind` |
| `color` | text range `fills[0].bind` |
| `border-*-color` (uniform) | `strokes.paints[0].bind` |
| `border-*-width` | `strokes.bindWeight.{t,r,b,l}` |
| `padding-*` | `bind.padding{Top,Right,Bottom,Left}`. Bound only when the Scene padding equals the CSS padding, i.e. border 0 or `borderModel: 'native'`; otherwise `TOKEN_BINDING_SKIPPED_COMPOSITE` (info) |
| `gap` / `column-gap` / `row-gap` | `bind.itemSpacing` / `counterAxisSpacing` / `gridColumnGap` / `gridRowGap`; bound only when the measured spacing equals the token value |
| `border-*-radius` | `bind.{topLeft,…}Radius` |
| `width`/`height`/`min-*`/`max-*` (px intent) | `bind.width/height/minWidth/…`, only for FIXED sizing |
| `opacity` | `bind.opacity` |
| `font-size`, `line-height` (px), `letter-spacing`, `font-weight`, `font-family` | range `bind.*` |
| `box-shadow` parts (when a var produces a single component) | effect `bind.{color,radius,spread,offsetX,offsetY}` |

**Rules:**

- **Pure chains only.** A value from `calc()`, `color-mix()` or a used var fallback is not bound: `TOKEN_NOT_PURE` (info).
- **Value-equality fallback** (D-18, opt-in `config.tokens.matchByValue`) emits `confidence: 'value'`. It binds only when exactly one variable of the right type has that value in the current mode; ambiguity gives `TOKEN_VALUE_AMBIGUOUS`.
- **Themes as modes.** When themes are modes ([04](04-variant-model.md), [08](08-tokens.md)), the mapper emits one variant set (not one per theme), with bindings from the default-mode capture. It then verifies that every other mode's capture resolves to the same bindings with that mode's values; a mismatch gives `TOKEN_MODE_MISMATCH` (warn), and the planner falls back to a theme VARIANT axis.

## 17. Determinism

- No clocks, randomness, environment or locale-dependent APIs (`Intl` is pinned to `en-US` where used for sorting; prefer code-unit comparison).
- All iteration over maps and sets is sorted.
- Floating-point results are rounded at emission (06 §5). Comparisons inside algorithms use fixed tolerances, never equality.
- Golden tests: the same Capture IR always maps to byte-identical canonical Scene IR. CI runs every fixture twice and compares.
- Mapper version bumps that change output are minor or major bumps of `@holotype/mapper`. The capture cache is reused; the Scene is recomputed.

## 18. Worked example: Button

**Capture** (default variant `variant=primary, size=medium, label="Button", showIcon=false`; a second render `showIcon=true` exists).

```
button.btn.btn--primary.btn--md  display:inline-flex; align-items:center; gap:8px(var(--space-2));
                                 padding:10px 16px(var(--space-4)); border:0; border-radius:8px(var(--radius-md));
                                 background:var(--btn-bg)->var(--color-primary-500)=#3b82f6; color:var(--btn-fg)=#fff
  ├─ svg.icon (only when showIcon)   16×16, boundary: <StarIcon> matchedSid=icons-star
  └─ #text "Button"                  Inter 600 14px / line-height 20px, one line, width 64
rect: 96×40 (without icon)
```

**Stages:**

1. **Normalize.** The anonymous text inside the `inline-flex` becomes a synthetic text node (§2).
2. **Classify.** The button is `flex-row`.
3. **Infer layout.**
   - HORIZONTAL, padding 10/16/10/16 (+ border 0), `itemSpacing` = measured 8 (no gap in the 1-child variant; taken from the `showIcon=true` variant through alignment: the mapper takes spacing from the variant with the most children and verifies all).
   - `align-items:center` → counter CENTER; `justify` normal → MIN. The `inline-flex` width is auto and content-sized → AUTO/AUTO.
   - Simulation: label at x=16, y=10, Δ=0.12 ≤ 0.6 ✓.
4. **Text.** Single line, content-sized → `WIDTH_AND_HEIGHT`, HUG. Font request: Inter, `Inter-SemiBold`, candidates `["Semi Bold", "SemiBold", "DemiBold"]`. The line height is 20 px.
5. **Visuals.** Fill SOLID #3b82f6; radius 8 ×4; no strokes.
6. **Instance.** In the `showIcon=true` variant, the svg boundary `StarIcon` → `icons-star` is in the catalog → `instance` leaf, structural hash equal ✓.
7. **Alignment.**
   - Default variant children: `[label]`. The `showIcon` variant: `[icon, label]`.
   - Pass 2 matches label↔label (cost 0.0). The icon is new and is inserted before label.
   - Keys: `root/icon-leading` (boundary name "StarIcon" is overridden by its role-derived slug, since `config.naming.iconSlug` maps svg/icon boundaries to `icon` and position to `-leading`), `root/label`.
   - The default variant gets a hidden `root/icon-leading` placeholder.
8. **Properties.**
   - `showIcon` → BOOLEAN; its evidence shows that only `root/icon-leading` toggled. Every variant's `root/icon-leading` gets `propRefs.visible = "arg:showIcon"`.
   - `label` → TEXT; the sample-string renders changed only `root/label` characters → `propRefs.characters = "arg:label"`.
9. **Tokens.**
   - `fills[0].bind` = `var:button/bg`, from the chain's first property `--btn-bg`.
   - Padding binds `var:space/4`, because the border is 0, so the Scene padding equals the CSS padding.
   - `itemSpacing` binds `var:space/2`.
   - Radius → `var:radius/md`.
   - Text fill → `var:button/fg`.
10. **Naming.** Root: `Variant=Primary, Size=Medium, State=Default`; children "Icon" and "Label" (role/semantic).
11. **Fallback.** `root/icon-leading {16, 12, 16, 16}`, `root/label {16, 10, 64, 20}`, size 96×40. `expect` is set on all nodes.

The result is the `root` subtree shown in [06 §10](06-ir.md#10-example-button-bundle-excerpt).

## 19. Diagnostic codes introduced here

- **Capture:** `CAP_SR_ONLY_DROPPED`, `CAP_NATIVE_CONTROL_SYNTHESIZED`.
- **Layout:** `LAYOUT_CLIPPED_DROPPED`, `LAYOUT_FLOAT_ABSOLUTE`, `LAYOUT_WRAP_REVERSE_UNSUPPORTED`, `LAYOUT_SPACE_AROUND_APPROX`, `LAYOUT_ALIGN_SELF_WRAPPED`, `LAYOUT_GROW_RATIO_FIXED`, `LAYOUT_PERCENT_RESOLVED`, `LAYOUT_RTL_REVERSED`, `LAYOUT_IRREGULAR_GAPS`, `LAYOUT_BREAKPOINT_IN_PROBE`, `LAYOUT_GRID_MINMAX_FIXED`, `LAYOUT_GRID_AUTOFILL_FROZEN`, `LAYOUT_GRID_UNREPRESENTABLE`, `LAYOUT_SIM_MISMATCH`, `LAYOUT_ZINDEX_HOIST`, `LAYOUT_OVERFLOW_AXIS_APPROX`.
- **Apply:** `APPLY_LAYOUT_RELAXED`, `APPLY_LAYOUT_FALLBACK`.
- **Text:** `TEXT_WORD_SPACING_DROPPED`, `TEXT_CASE_BAKED`, `TEXT_OVERLINE_OVERLAY`, `TEXT_DECORATION_STYLE_APPROX`, `TEXT_SHADOW_RANGE_APPROX`, `TEXT_BASELINE_SHIFT_DROPPED`, `TEXT_OVERLAY_LOCKED`, `TEXT_LINE_MISMATCH`.
- **Font:** `FONT_SYNTHETIC`. `FONT_MISSING` and `FONT_SUBSTITUTED` are emitted by the plugin.
- **Paint:** `PAINT_TABLE_BORDER_APPROX`, `PAINT_CONIC_APPROX`, `PAINT_REPEATING_CAPPED`, `PAINT_DASH_APPROX`, `PAINT_BORDER_DECOMPOSED`, `PAINT_BORDER_DOMINANT`, `PAINT_BORDER_STYLE_APPROX`, `PAINT_ELLIPTICAL_RADIUS_APPROX`, `PAINT_SPREAD_BACKING_RECT`, `PAINT_FILTER_RASTERIZED`, `PAINT_SUBTREE_RASTERIZED`.
- **SVG:** `SVG_RASTERIZED`.
- **Planner:** `PLAN_ALIGNMENT_ANCHOR_CONFLICT`, `PLAN_ALIGNMENT_DIVERGENT`, `PLAN_ALIGNMENT_ORDER_CONFLICT`, `PLAN_PROPERTY_UNBOUND`, `PLAN_INSTANCE_PROPS_UNMAPPED`, `PLAN_INSTANCE_MISMATCH`, `PLAN_INSTANCE_CYCLE`.
- **Token:** `TOKEN_BINDING_SKIPPED_COMPOSITE`, `TOKEN_NOT_PURE`, `TOKEN_VALUE_AMBIGUOUS`, `TOKEN_MODE_MISMATCH`.
