---
'@holotype/mapper': minor
---

`mapComponent(input: MapperInput): MapperOutput` maps captures to an absolute-positioned Scene IR (B-12): tree normalization, SOLID fills, INSIDE strokes, radii, opacity, blend and clip, SVG and image content, TEXT nodes with ranges and font requests, `nk` keys, unique names, `expect`, `irh` hashes and the 06 §9 invariant check. Out-of-scope CSS is reported with catalog diagnostics. New: `DEFAULT_MAPPER_SETTINGS`, `settingsProblem`, `STAGES` and the stage types. Removed: `MapperOptions`, `DEFAULT_MAPPER_OPTIONS`, `resolveMapperOptions` and `MapInput` (use `MapperSettings` and `MapperInput` from `@holotype/ir`). `mapTokens` now returns `TokensDoc`.
