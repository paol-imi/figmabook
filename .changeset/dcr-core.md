---
'@holotype/dcr': minor
---

DCR extraction core (15 §4.1–§4.4, §4.7, §4.9): `extractDcr(snapshot, baselines)` identifies managed components, variants and layers, diffs them field by field against the embedded baselines (derived geometry and variable-driven values filtered out, bindings folded into tokens) and classifies `component.modified`, `variant.added`/`variant.removed`, `property.added`/`property.changed`, `node.added`/`node.removed`, `component.new`, `token.changed`/`token.added` and `unknown`, with token candidates by variable scope, open questions and a sealed, shuffle-invariant request. `normalizePlugin(readback)` builds the `FigmaSnapshot` from the plugin read-back with the `ah` normalizer.
