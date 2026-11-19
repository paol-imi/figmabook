# @holotype/ir

Schemas and hashes for every Holotype document ([06](../../docs/plan/06-ir.md), D-07, D-52).
TypeBox is the source of truth; the build emits JSON Schema 2020-12 to `schema/`. Pure and
isomorphic: no clock, no randomness, no Node built-ins.

## Scripts

| Command                                                                 | Does                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm -F @holotype/ir build`                                            | `dist/`, then `schema/*.v<major>.json` (works without other builds) |
| `pnpm -F @holotype/ir build && git diff --exit-code packages/ir/schema` | the committed-schema drift check                                    |
| `pnpm -F @holotype/ir test`                                             | unit, property and corpus tests                                     |

## Documents

| Schema / type                                  | File                         | Open or strict             |
| ---------------------------------------------- | ---------------------------- | -------------------------- |
| `CaptureDocSchema` / `CaptureDoc` (`CNode`, …) | `capture.v0.json`            | open (06 §7)               |
| `SceneComponentSchema` / `SceneComponent`      | `scene.v0.json`              | open                       |
| `TokensDocSchema` / `TokensDoc`                | `tokens.v0.json`             | open                       |
| `BundleManifestSchema` / `BundleManifest`      | `bundle.v0.json`             | open; `BranchBlock` inside |
| `BundleReportSchema` / `BundleReport`          | `report.v0.json`             | open                       |
| `ApplyReportSchema` / `ApplyReport`            | none (holds bytes)           | open                       |
| `ProvenanceDocSchema` / `ProvenanceDoc`        | `provenance.v1.json`         | open                       |
| `HolotypeConfigSchema` / `HolotypeConfig`      | `config.v0.json` (JSON form) | strict (16 §2)             |
| `HolotypeParamsSchema` / `HolotypeParams`      | inside `config.v0.json`      | strict (04 §9)             |

Open documents ignore unknown fields within a major; strict ones report them as `unknown-key`.
Shared pieces are exported too (`SourceLocSchema`, `FieldOriginSchema`, `CodeRefSchema`,
`DiagnosticSchema`, `JsonValueSchema`, `Enum`, `RefTo`, `KeyedRecord`) so the DCR schemas
(15 §6, package `dcr`) build on them.

## Public API

- **Canonical JSON:** `canonicalJSON`, `normalizeNumber`, `sceneNumKind`, `captureNumKind`.
- **Hashes:** `sha256Hex`, `h16`, `hash`, `fnv1a64`.
- **Content hashes (06 §6):** `variantKey`, `sceneNodeIrh`, `sceneVariantIrh`, `sceneComponentIrh`,
  `withSceneHashes`, `checkSceneHashes`, `tokensIrh`, `bundleFingerprint`, `dcrConfigHash`.
- **`ah` normalizer:** `normalizeGroups`, `appliedHash`, `groupHashes`, `splitAppliedHash`, `changedGroups`,
  `APPLIED_GROUPS`.
- **Validation:** `validateCaptureDoc`, `validateSceneComponent`, `validateTokensDoc`, `validateBundleManifest`,
  `validateBundleReport`, `validateApplyReport`, `validateProvenanceDoc`, `validateHolotypeConfig`,
  `validateHolotypeParams`, `createValidator`.
- **Invariants (06 §9):** `checkSceneInvariants`, `checkManifestInvariants`, `invariantDiagnostics`.
- **Config helpers:** `resolveDcrConfig`, `DEFAULT_DCR_CONFIG`, `normalizeConfigInput`, `parsePattern`,
  `patternToString`.
- **Versions:** `*_VERSION`, `SUPPORTED_*_MAJORS`, `parseMajor`, `checkVersion`, `migrateScene`, `SCENE_MIGRATIONS`.
- **Schema files:** `jsonSchemaFiles`, `toJsonSchema`, `PUBLISHED_SCHEMAS`.
- **Pipeline types (07 §0):** `ComponentPlan`, `ComponentMetaInput`, `TokenResolution`, `ComponentCatalog`,
  `MapperInput`, `MapperOutput`, `MapperSettings`, `sourceLocKey`.

## Entries

| Import              | Contains                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `@holotype/ir`      | everything above                                                                                |
| `@holotype/ir/core` | versions, canonical JSON, number kinds, hashes and the `ah` normalizer: no schema, no validator |

The Figma plugin main thread imports values from `@holotype/ir/core` only (types may come from the
root entry): create-figma-plugin `require`s the main entry, which defeats tree shaking of the root
entry, so one value import from it puts every TypeBox schema into `build/main.js` (D-04).

## Changing a schema

After B-01, each schema change is its own small PR titled `ir: <change>` (BUILD §2.3). Edit the
TypeBox source, run the build to regenerate `schema/`, add a valid and an invalid case to
`test/corpus/`, and bump the document's version (a minor for additive fields, 06 §7).
