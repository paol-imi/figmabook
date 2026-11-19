---
'@holotype/layout-sim': minor
---

Stack auto-layout simulator v0 (B-47): `simulate` over `SimNode` trees, `simulateAutoLayout`, `measureHug`, `simulateScene` / `toSimNode` for Scene IR subtrees, `fallbackRects`, `compareRects` / `withinTolerance` with `TOL_SIM` (0.6 px, D-15) and `SIMULATOR_VERSION`. Models HORIZONTAL and VERTICAL stacks: padding, negative spacing, MIN/CENTER/MAX/SPACE_BETWEEN (SPACE_EVENLY/SPACE_AROUND pending S-10), BASELINE (pending S-04), FIXED/HUG/FILL, min/max, the padding floor, `strokesIncludedInLayout` (per-side and non-inside strokes pending S-05), hidden and ABSOLUTE children. Every Figma behaviour rule is in `ASSUMPTIONS` with its documentation link, and each result lists the unconfirmed rules it used. Wrap and grid return `unsupported-*` issues; `simulateGrid` no longer throws. The previous `AutoLayoutSpec`, `LayoutChild`, `LayoutResult` and `GridSpec` types are replaced by `StackSpec`, `SimNode`, `Simulation` and `SceneGridLayout`.
