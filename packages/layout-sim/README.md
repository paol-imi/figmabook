# @holotype/layout-sim

A pure, deterministic model of Figma auto layout ([07 §6.1](../../internal/plan/07-mapping.md#verification)).
It takes frames with their children's intrinsic sizes and returns every child's box. Three users:

- the mapper checks an auto-layout hypothesis against the captured geometry within `TOL_SIM`
  (D-15, [07 §6.2](../../internal/plan/07-mapping.md#verification));
- `figma-fake` computes geometry in tests;
- the plugin estimates sizes before it builds.

It is isomorphic: no Node APIs, no DOM, no `figma` global, no clock, no randomness. It runs in
the plugin's main-thread bundle (a test bundles it for es2017 and runs it in a bare VM).

**v0 scope (B-47):** HORIZONTAL and VERTICAL stacks: padding, `itemSpacing` (negative too),
`MIN`/`CENTER`/`MAX`/`SPACE_BETWEEN` (and `SPACE_EVENLY`/`SPACE_AROUND`, pending S-10),
`MIN`/`CENTER`/`MAX`/`BASELINE` counter alignment, FIXED/HUG/FILL, min/max, the padding floor,
`strokesIncludedInLayout`, hidden and ABSOLUTE children, nested frames. Wrap (B-111) and grid
(B-112, S-10) are reported as unsupported, never guessed.

## Public API

| Export                                                                         | What it does                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simulate(root, options?)`                                                     | Simulates a `SimNode` tree. `Result` with `{ size, rects, assumptions }` or `SimIssue[]`                                                                                                                                                                                                     |
| `simulateAutoLayout(spec, children, frame?, options?)`                         | One stack frame around `children` (02 §6.1); the frame key defaults to `DEFAULT_FRAME_KEY`                                                                                                                                                                                                   |
| `measureHug(spec, children, frame?)`                                           | The size the frame takes when it hugs both axes                                                                                                                                                                                                                                              |
| `simulateGrid(spec, children, frame?)`                                         | Always `unsupported-grid` until B-112                                                                                                                                                                                                                                                        |
| `simulateScene(node, options?)` / `toSimNode(node, options?)`                  | Simulate a Scene IR subtree / convert it to `SimNode` (`nk` → key, `child.*` → sizing, bounds, positioning; `strokes` → stroke box; `relativeTransform` → `transformed`)                                                                                                                     |
| `fallbackRects(node)`                                                          | A container's `fallback` as rects relative to it, ready for `compareRects`                                                                                                                                                                                                                   |
| `compareRects(actual, expected)`, `withinTolerance(comparison, tol = TOL_SIM)` | Max single-field delta, where it is, missing keys                                                                                                                                                                                                                                            |
| `TOL_SIM`                                                                      | 0.6 px (D-15)                                                                                                                                                                                                                                                                                |
| `SIMULATOR_VERSION`                                                            | Model version for `SceneLayout.verified.simulator`; bumped whenever simulated geometry changes                                                                                                                                                                                               |
| `ASSUMPTIONS`, `ASSUMPTION_IDS`                                                | The rule catalog below, with Figma doc links                                                                                                                                                                                                                                                 |
| Types                                                                          | `SimNode`, `StackSpec` (a Scene IR stack layout is assignable to it), `Simulation`, `SimResult`, `SimIssue`, `SimIssueCode`, `Sizing`, `SizeBounds`, `StrokeBox`, `StackFrame`, `SimulateOptions`, `SceneSimOptions`, `RectComparison`, `RectDelta`, `Assumption`, `AssumptionId`, `SpikeId` |

Verifying a container in the mapper:

```ts
const result = simulateScene(container, { baselines });
const comparison = result.ok ? compareRects(result.value.rects, fallbackRects(container)!) : undefined;
if (comparison && withinTolerance(comparison)) {
  // emit layout with verified: { simulator: SIMULATOR_VERSION, maxDelta: comparison.maxDelta, tolerance: TOL_SIM, … }
}
```

## Input

`SimNode` (07 §6.1, adapted to Scene IR names): `key`, `size`, `sizingH`/`sizingV`, `positioning`,
`visible`, `xy`, `min`/`max`, `stroke`, `baseline`, `transformed`, `layout` (a `StackSpec`, or
`{ mode: 'GRID' }`), `children`.

- **Leaves** (text, vectors, images, instances) keep `size`. Text is not reflowed (07 §8.5).
- **Stack frames** recompute their HUG axes from their children, bottom-up: a HUG child uses its
  simulated size, not its measured one (07 §6.2).
- **Sizing defaults:** without `sizingH`/`sizingV`, a stack frame takes them from its own modes
  (AUTO → HUG, FIXED → FIXED), anything else is FIXED. When both are given they must agree.
- **Frames without auto layout** place their children at `xy`.
- **Baselines** are not in Scene IR: `BASELINE` rows need `baseline` on their children
  (`SceneSimOptions.baselines` by key), e.g. text `lines[0].baseline` from the capture.
- **The root** is placed at (0, 0) whatever its `xy` and visibility. A FILL root needs
  `options.outer` on that axis.

## Algorithm

1. **Validate** the whole tree; any issue stops the run (all issues are returned, in tree order).
2. **Natural sizes**, bottom-up and memoized: HUG axes = content + insets, where the primary
   content is the sum of in-flow children plus `itemSpacing × (n − 1)` (0 with an auto gap), and
   the counter content is the largest child (or the baseline extent). Then min/max, then the
   padding floor.
3. **Placement**, top-down. Per stack: FILL children share `inner − fixed − gaps` equally from
   a zero basis, never below 0, with the flexbox freeze loop for min/max; counter FILL stretches
   to the inner size within min/max. Primary offsets follow the alignment; the auto gaps ignore
   `itemSpacing` and never go below 0. ABSOLUTE children sit at `xy`. Each child's subtree is
   then laid out in its final box.

Insets are the padding, plus the frame's INSIDE stroke when `strokesIncludedInLayout` is true.
Without wrap or reflow a node's natural size does not depend on its parent, so the run is
linear in the tree size. Output order is pre-order (root, then each subtree in layer order).

## Figma behaviour assumptions

Every rule the model relies on, from `src/assumptions.ts`. **documented** rules are stated by the
Plugin API reference or the help center. **calibrate** rules follow the closest documented or
CSS behaviour and are checked by the nightly T1 read-back calibration ([12](../../internal/plan/12-quality.md)).
**S-xx** rules wait for that spike. A result lists in `assumptions` every non-documented rule
it used, so a read-back mismatch can be traced to a rule.

| Rule                             | Status     | Summary                                                                            |
| -------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `flow-order`                     | documented | layer order along the primary axis; `itemReverseZIndex` only changes painting      |
| `hidden-skipped`                 | documented | hidden children take no space                                                      |
| `absolute-out-of-flow`           | documented | ABSOLUTE children at `xy` from the frame corner; no effect on flow or HUG          |
| `padding`                        | documented | children inside the padding box                                                    |
| `item-spacing`                   | documented | gap between consecutive children, may be negative                                  |
| `primary-align`                  | documented | MIN/CENTER/MAX on the primary axis                                                 |
| `auto-gap-between`               | documented | SPACE_BETWEEN ignores `itemSpacing`, ends flush with the padding                   |
| `auto-gap-floor`                 | documented | auto gaps stop at 0 when children overflow                                         |
| `auto-gap-single-child`          | documented | a single child in an auto-gap stack sits at the start                              |
| `counter-align`                  | documented | one MIN/CENTER/MAX counter alignment for all children                              |
| `baseline-horizontal-only`       | documented | BASELINE only on HORIZONTAL frames                                                 |
| `hug`                            | documented | HUG = content + padding                                                            |
| `fill-breaks-hug`                | documented | a frame cannot hug an axis on which a child fills                                  |
| `fill-needs-auto-layout-parent`  | documented | FILL only for in-flow children of stacks                                           |
| `fill-counter-stretch`           | documented | counter FILL stretches to the inner size                                           |
| `min-max`                        | documented | min/max bound frames and their children in any sizing mode                         |
| `padding-floor`                  | documented | a frame is never smaller than its padding (+ included inside stroke)               |
| `stroke-excluded`                | documented | strokes excluded from layout take no space                                         |
| `stroke-included-inside`         | documented | an included uniform INSIDE stroke adds to the padding                              |
| `stroke-self-contained`          | documented | a child's stroke never changes the parent's layout                                 |
| `fill-equal-share`               | calibrate  | FILL children share equally from a zero basis (`flex: 1 0 0`)                      |
| `fill-min-max`                   | calibrate  | flexbox freeze loop for FILL min/max                                               |
| `fill-no-space`                  | calibrate  | FILL gets 0 when nothing is left                                                   |
| `overflow-alignment`             | calibrate  | CENTER overflows both sides, MAX the start                                         |
| `auto-gap-hug`                   | calibrate  | a HUG primary axis with an auto gap has 0 gaps                                     |
| `min-max-before-floor`           | calibrate  | the padding floor wins over a smaller max                                          |
| `no-pixel-snapping`              | calibrate  | no rounding anywhere (global: never listed per result)                             |
| `baseline-alignment`             | S-04       | first baselines line up, the deepest at the top inset; HUG spans ascent + descent  |
| `baseline-synthesized`           | S-04       | a child without a baseline uses its bottom edge                                    |
| `baseline-fill`                  | S-04       | a counter-FILL child under BASELINE stretches from the top                         |
| `stroke-included-per-side`       | S-05       | per-side INSIDE weights add to their own side                                      |
| `stroke-included-center-outside` | S-05       | CENTER/OUTSIDE strokes add nothing even when included                              |
| `auto-gap-evenly-around`         | S-10       | SPACE_EVENLY / SPACE_AROUND formulas (Scene IR never emits them; `figma-fake` may) |

Not modelled (07 §6.1): wrap, grid, constraint-driven resizing of ABSOLUTE children (only the
initial placement), `layoutGrow` other than 0/1, rotation inside layout, text metrics and reflow.

## Issues

`layout-sim` is a leaf package and emits no catalog diagnostics. It returns `SimIssue`s with a
plain-language `message`; the caller maps them:

| `SimIssueCode`              | Meaning                                                                               | Mapper diagnostic                                              |
| --------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `unsupported-wrap`          | `wrap: true` (B-111)                                                                  | LAYOUT_WRAP_REVERSE_UNSUPPORTED (unverifiable wrap → absolute) |
| `unsupported-grid`          | `layoutMode: GRID` (B-112)                                                            | LAYOUT_SIM_MISMATCH                                            |
| `unsupported-transform`     | rotated/skewed/scaled in-flow child                                                   | LAYOUT_SIM_MISMATCH                                            |
| `baseline-vertical`         | BASELINE on a VERTICAL stack                                                          | LAYOUT_SIM_MISMATCH                                            |
| `fill-in-hug-parent`        | FILL child on an axis its parent hugs                                                 | LAYOUT_SIM_MISMATCH                                            |
| `fill-without-stack-parent` | FILL outside a stack's flow, or a FILL root without `outer`                           | LAYOUT_SIM_MISMATCH                                            |
| `sizing-mode-conflict`      | `sizingH/V` disagrees with the frame's own sizing mode                                | LAYOUT_SIM_MISMATCH                                            |
| `missing-xy`                | an ABSOLUTE child or a child of a non-stack frame without `xy`                        | LAYOUT_SIM_MISMATCH                                            |
| `duplicate-key`             | two nodes share a key                                                                 | (a mapper bug)                                                 |
| `invalid-number`            | negative or non-finite size, padding, bound, stroke weight, `xy`, baseline or `outer` | (a mapper bug)                                                 |
| `invalid-bounds`            | min > max on one axis                                                                 | (a mapper bug)                                                 |

Programmer errors are issues too: `simulate` never throws on any input.

## Scripts

| Command                              | Does                                                      |
| ------------------------------------ | --------------------------------------------------------- |
| `pnpm -F @holotype/layout-sim test`  | unit tables, L2 properties (fast-check), the bundle check |
| `pnpm -F @holotype/layout-sim build` | `dist/` for a neutral es2022 target                       |
