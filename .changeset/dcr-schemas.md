---
'@holotype/dcr': minor
---

DCR schemas (15 §3.3, §4, §6): TypeBox schemas and types for `DesignChangeRequest` and all its parts (one union member per item kind), `FigmaSnapshot`, `BaselineSnapshot`, `NodeGroups`, `FieldChange`, `DcrScope`, reviewer answers and agent decisions; compiled validators and `checkDcrIntegrity`; stable item ids, the core hash `dcrHash` (provenance and CLI-added fields excluded, D-50), request ids, canonical order (`sortDcr`, `sealDcr`, `serializeDcr`); `LATEST-<branch-slug>` and `parent` chaining (D-56). The build emits `schema/{dcr,figma-snapshot,baseline,answers,decisions}.v1.json`.
