# @holotype/mapper

Pure Capture IR → Scene IR mapping ([07](../../docs/plan/07-mapping.md), D-08). Isomorphic and
deterministic: no I/O, no clock, no randomness, no environment. Input and output types come
from `@holotype/ir` (`MapperInput`, `MapperOutput`, 06 §1.1).

## Public API

| Export                                                                                                                                | What it does                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mapComponent(input: MapperInput): MapperOutput`                                                                                      | Maps one component's captures to a `SceneComponent` plus its diagnostics. Throws only a `HolotypeError`: `PLAN_MAPPER_FAILED` for input it cannot map, `PLAN_INVARIANT_VIOLATION` when the output breaks a 06 §9 invariant. Either way the CLI skips the component |
| `DEFAULT_MAPPER_SETTINGS`                                                                                                             | The 16 §3 defaults as resolved `MapperSettings`, frozen                                                                                                                                                                                                            |
| `settingsProblem(settings)`                                                                                                           | Why settings cannot be meant (e.g. a negative `layout.tolerancePx`), or `undefined`                                                                                                                                                                                |
| `STAGES`                                                                                                                              | The stage registry (07 §1), each stage with its 07 §1 `step` number                                                                                                                                                                                                |
| `Stage`, `VariantStage`, `ComponentStage`, `ComponentState`, `VariantState`, `WorkNode`, `NodeFields`, `SyntheticRole`, `HoistOrigin` | Types for writing stages                                                                                                                                                                                                                                           |
| `mapTokens(captures)`                                                                                                                 | Not built yet (Phase 5); throws `NotImplementedError`                                                                                                                                                                                                              |

## Pipeline (slice core, B-12 and B-48)

`src/stages/index.ts` lists the stages, one line each, in 07 §1 order; the runner sorts by
`step`, so a stage appended later still runs in its place. Variant stages run once per variant
in plan order, component stages once. Steps 3–5 (layout, B-49), 9–10 (instances, alignment,
B-50) and 12, 17 (tokens, provenance, B-51) are not built yet.

| Step | Stage      | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | normalize  | drops screen-reader-only, `display: none`, whitespace-only and zero-size text, and empty boxes that paint nothing; splices `display: contents`; `visibility: hidden` drops the box's own paint; `opacity: 0` keeps the layer hidden (`mapper.keepInvisible`); portals become the root's last children                                                                                                                                                                       |
| 2    | order      | paint order (CSS 2.1 Appendix E) between overlapping siblings; other siblings keep DOM (flow) order. A z-indexed box that paints across its parent's siblings is hoisted to its stacking context (`LAYOUT_ZINDEX_HOIST`), inside a `…/clip` frame when it leaves a clipping ancestor; it keeps the key of its original path                                                                                                                                                 |
| 6    | text       | one TEXT node per text block; runs → ranges, identical neighbours merged; px line height; font requests with style candidates (07 §8.6); auto-resize and truncation; `locked-lines` inserts U+2028 at browser breaks; `text-shadow` → node DROP_SHADOW effects (`TEXT_SHADOW_RANGE_APPROX` when ranges differ)                                                                                                                                                              |
| 7    | visuals    | fills `[background-color, …url() layers]` (FILL, FIT, TILE, CROP); padding/content-box backgrounds → `…/bg` rectangle; borders → INSIDE stroke, or `…/border-{t,r,b,l}` vectors for per-side colors on square boxes; outlines → OUTSIDE stroke or `…/outline` frame; box shadows → effects, spread via clipping or a `…/shadow` backing rectangle, rings → OUTSIDE stroke; radii, opacity, blend, clipping, SVG and image content (`object-fit` incl. `none`, `scale-down`) |
| 8    | simplify   | 07 §11 rule 3: an element that only holds its text, draws nothing, has no padding or border and is no anchor is replaced by the TEXT layer, which takes its box, key, name and `source`                                                                                                                                                                                                                                                                                     |
| 11   | properties | VARIANT properties from the plan's axes (sets only); other planned properties are dropped with `PLAN_PROPERTY_UNBOUND` until alignment exists (B-50)                                                                                                                                                                                                                                                                                                                        |
| 13   | naming     | `nk` path keys (10 §4; DOM order, hoisted layers under their original parent, synthetic layers as `<owner>/<role>`) and unique sibling names (07 §12; synthetic layers "Background", "Border top", "Shadow", "Outline", "Clip"); Vite CSS-module classes count by their local name                                                                                                                                                                                          |
| 14   | emit       | absolute layout: `xy` relative to the parent, `size`, `expect` relative to the variant root; variants, set grid and metadata; capture diagnostics re-keyed to the layer's `nk`; variant diagnostics sorted by `(code, nodeKey, message)`                                                                                                                                                                                                                                    |
| 15   | hash       | `irh` bottom-up (`withSceneHashes`)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 16   | validate   | Scene schema plus `checkSceneInvariants`; violations throw `PLAN_INVARIANT_VIOLATION`                                                                                                                                                                                                                                                                                                                                                                                       |

Writing a stage: a `WorkNode` carries `box` (its page-space rect; a collapsed text takes its
element's), `synthetic` (the role of a layer the mapper added; such layers keep exact geometry
and must be ABSOLUTE children under auto layout), `wrapper` (the element a text replaced) and
`hoistedFrom`. `fields` holds the Scene fields, including `child` for the layout stages.

CSS that has no Scene form yet (gradients, filters, clip paths, masks, transforms, text
overlines, native control appearance, unplaceable image sizes) is reported with
`CAP_CSS_UNSUPPORTED` (`property` names it) rather than dropped silently.

## Tests

`pnpm -F @holotype/mapper test`: golden Capture IR → Scene IR snapshots from the hand-built
fixtures in `test/fixtures/`, from the real capture goldens of `@holotype/capture` (copied to
`test/fixtures/capture/`, scenes in `test/__golden__/`) and from a built kitchen sink of the
synthetic layers; property tests for absolute geometry through normalization and
simplification and for no silent drops; and unit tests per rule. Regenerate with `-u`, review
the diff, and copy changed `test/__golden__/*.scene.json` to
`packages/plugin/test/apply/mapper-scenes/`: the plugin applies them to `figma-fake`, and a
mapper test fails while the copies are stale.
