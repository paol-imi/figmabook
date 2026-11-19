# @holotype/mapper

Pure Capture IR → Scene IR mapping ([07](../../docs/plan/07-mapping.md), D-08). Isomorphic and
deterministic: no I/O, no clock, no randomness, no environment. Input and output types come
from `@holotype/ir` (`MapperInput`, `MapperOutput`, 06 §1.1).

## Public API

| Export                                                                                                | What it does                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mapComponent(input: MapperInput): MapperOutput`                                                      | Maps one component's captures to a `SceneComponent` plus its diagnostics. Throws only a `HolotypeError`: `PLAN_MAPPER_FAILED` for input it cannot map, `PLAN_INVARIANT_VIOLATION` when the output breaks a 06 §9 invariant. Either way the CLI skips the component |
| `DEFAULT_MAPPER_SETTINGS`                                                                             | The 16 §3 defaults as resolved `MapperSettings`, frozen                                                                                                                                                                                                            |
| `settingsProblem(settings)`                                                                           | Why settings cannot be meant (e.g. a negative `layout.tolerancePx`), or `undefined`                                                                                                                                                                                |
| `STAGES`                                                                                              | The stage registry (07 §1), each stage with its 07 §1 `step` number                                                                                                                                                                                                |
| `Stage`, `VariantStage`, `ComponentStage`, `ComponentState`, `VariantState`, `WorkNode`, `NodeFields` | Types for writing stages                                                                                                                                                                                                                                           |
| `mapTokens(captures)`                                                                                 | Not built yet (Phase 5); throws `NotImplementedError`                                                                                                                                                                                                              |

## Pipeline (v0, B-12)

`src/stages/index.ts` lists the stages, one line each, in 07 §1 order; the runner sorts by
`step`, so a stage appended later still runs in its place. Variant stages run once per variant
in plan order, component stages once.

| Step | Stage      | v0 behaviour                                                                                                                                                                                                                                                                                          |
| ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | normalize  | drops screen-reader-only, `display: none`, whitespace-only and zero-size text, and empty boxes that paint nothing; splices `display: contents`; `visibility: hidden` drops the box's own paint; `opacity: 0` keeps the layer hidden (`mapper.keepInvisible`); portals become the root's last children |
| 6    | text       | one TEXT node per text block; runs → ranges, identical neighbours merged; px line height; font requests with style candidates (07 §8.6); auto-resize and truncation; `locked-lines` inserts U+2028 at browser breaks                                                                                  |
| 7    | visuals    | SOLID fills, borders as an INSIDE stroke with per-side weights, corner radii with the CSS overlap reduction, opacity, blend mode, clipping, SVG and image content                                                                                                                                     |
| 11   | properties | VARIANT properties from the plan's axes (sets only); other planned properties are dropped with `PLAN_PROPERTY_UNBOUND` until alignment exists (B-50)                                                                                                                                                  |
| 13   | naming     | `nk` path keys (10 §4) and unique sibling names (07 §12)                                                                                                                                                                                                                                              |
| 14   | emit       | absolute layout: `xy` relative to the parent, `size`, `expect` relative to the variant root; variants, set grid and metadata                                                                                                                                                                          |
| 15   | hash       | `irh` bottom-up (`withSceneHashes`)                                                                                                                                                                                                                                                                   |
| 16   | validate   | Scene schema plus `checkSceneInvariants`; violations throw `PLAN_INVARIANT_VIOLATION`                                                                                                                                                                                                                 |

CSS that has no Scene form yet (gradients, background images, shadows, outlines, filters,
clip paths, masks, transforms, text shadows, overlines, native control appearance) is reported
with `CAP_CSS_UNSUPPORTED` (`property` names it) rather than dropped silently.

## Tests

`pnpm -F @holotype/mapper test`: golden Capture IR → Scene IR snapshots from the hand-built
fixtures in `test/fixtures/` (regenerate with `-u` and review the diff), property tests for
absolute geometry and no silent drops, and unit tests per module.
