# @holotype/dcr

Design Change Requests ([15](../../internal/plan/15-change-requests.md)): the deterministic request
a designer's branch-file edits become, for a coding agent to implement. Pure and isomorphic
(D-35): no clock, no randomness, no network, no Node built-ins. It runs in the CLI and in the
plugin UI. TypeBox is the source of truth (D-07); the build emits JSON Schema 2020-12 to
`schema/`.

It holds the schemas and the id, hash and order rules every producer and consumer shares
(B-64), and the extraction core (B-65): identification, field diff and classification.
Screens and nearest-component scoring (B-66) and the renderers (B-67) are not built yet.

## Scripts

| Command                                                                   | Does                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm -F @holotype/dcr build`                                             | `dist/`, then `schema/*.v1.json` (works without other builds) |
| `pnpm -F @holotype/dcr build && git diff --exit-code packages/dcr/schema` | the committed-schema drift check (a test checks it too)       |
| `pnpm -F @holotype/dcr test`                                              | corpus, worked example, determinism and unit tests            |

## Documents

| Schema / type                                       | File                     | Where it lives                                  |
| --------------------------------------------------- | ------------------------ | ----------------------------------------------- |
| `DesignChangeRequestSchema` / `DesignChangeRequest` | `dcr.v1.json`            | `.holotype/requests/<id>/dcr.json`, `request:*` |
| `FigmaSnapshotSchema` / `FigmaSnapshot`             | `figma-snapshot.v1.json` | extractor input (15 §4.1)                       |
| `BaselineSnapshotSchema` / `BaselineSnapshot`       | `baseline.v1.json`       | variant plugin data `base:*` (15 §3.3)          |
| `DcrAnswersSchema` / `DcrAnswers`                   | `answers.v1.json`        | `branch:meta.answers`, `answers.json` (D-56)    |
| `DcrDecisionsSchema` / `DcrDecisions`               | `decisions.v1.json`      | `decisions.json`, written by the agent (15 §8)  |

All are open documents (06 §7): unknown fields are ignored within a major. Parts are exported
too: `DcrHeader`, `DcrItem` (one union member per kind, `DcrItemOf<K>`), `DcrChange`,
`Acceptance`, `DcrQuestion`, `DcrSummary`, `DcrScope`, `DcrTargets`, `UsageNode`,
`UsageInstance`, `UsageDelta`, `UsageSnippet`, `ScreenVariant`, `DcrInteraction`,
`A11yAnnotation`, `InstanceVersionRef`, `SnapNode`, `SnapVariable`, `NodeGroupsSchema`,
`FieldChange`, `SetPropsSnapshot`.

## Extraction (15 §4)

`extractDcr(snapshot, baselines)` → a sealed `DesignChangeRequest` (the plugin's core: no
provenance, `DCR_PROVENANCE_MISSING` when it has items). `normalizePlugin(readback)` turns the
plugin's read-back (`PluginReadback`) into the `FigmaSnapshot` it takes.

1. **Read** `branch:meta` (`DCR_NOT_BRANCH_FILE` without it) and the registry; take the scope
   (`changed`: managed components plus top-level frames absent from `baseFrames`; `all`,
   `page:<name>`, `selection:<ids>`, `ready`).
2. **Identify** (15 §4.2): managed sets by `sid`; a variant whose name values equal its `vk`'s
   baseline values is managed, another node with that `vk` is a new variant derived from it, a
   baseline `vk` with no managed node was removed; inside a variant, the first node with an `nk`
   keeps it, later copies and nodes without one are added, baseline `nk`s with no node were
   removed. Locked subtrees are skipped.
3. **Diff** (15 §4.3): only the groups whose `ah` sub-hash differs, walked down to atomic values
   (`layout.paddingLeft`, `paint.fills[0].color`, `text.lineHeight`). Noise filter: sizes on
   hugging or filling axes and auto-resized text are derived and dropped. Bindings fold into the
   value they bind (`token.before/after`); a value bound to the same variable before and after
   moved with the variable and is reported once, as `token.changed`. Child order changes are
   `layout.children.order`.
4. **Classify** (15 §4.4): `component.modified` (one item per node), `variant.added` (args
   inferred with the inverse Title Case rule), `variant.removed`, `property.added` /
   `property.changed` (same `#id` = same property), `node.added` (with its usage tree) /
   `node.removed`, `component.new` (structure, API, suggested files), `token.changed` (the value
   before recovered from the variable's `ah` when one alias reproduces it) / `token.added`;
   everything else, including frames until screens land, is `unknown` with `DCR_UNKNOWN_CHANGE`.
5. **Tokens** (15 §4.7): a raw value is matched against the variables of the same type whose
   Figma `scopes` allow the field (a padding after removing its border, D-16):
   `DCR_VALUE_UNTOKENIZED` with candidates, else `DCR_VALUE_NO_TOKEN`; plus
   `DCR_FIELD_UNMAPPABLE` and `DCR_PROPERTY_UNMAPPED`. One question per phrase, numbered `q1…`.
6. **Seal**: stable item ids, canonical order, `dcrHash`, request id.

Titles use code words (`Button · variant=secondary, size=md · padding-left/right 16 → 20`),
designer titles Figma words and variable names, headlines (≤ 8 lines) the designer words.

## Ids and the core hash

- **Item id** `dcrItemId` / `computeItemId`: `h16(canonical([kind, identity, sorted field paths]))`.
  The identity (`itemIdentity`) is the target without the CLI-added `code`; `figmaNodeId` counts
  only when no `nk` or `key` names the node (and never for `instance.outdated`/`deprecated`,
  named by `sid` + `vk`).
- **Core** `dcrCore`: the request without `id`, `dcrHash`, `header.generated`,
  `header.figma.fileVersion`, `header.headCommit`, `target.code`, `nearest[].code`, and on each
  change `origin`, `css`, `reach`, `varDefinition`, plus the provenance diagnostics in
  `CLI_ENRICHMENT_CODES`. Answers, approval and decisions are never in a request.
- **`dcrHash`** `computeDcrHash`: `h16(canonicalDcr(dcrCore(sortDcr(dcr))))`. The plugin and the
  CLI get the same value for the same snapshot and config.
- **Request id** `dcrId`: `h16(canonical([repo, branch, fileKey, dcrHash]))`.
- **Order** `sortDcr`: items by `(kindOrder, sid, vk, nk/key, id)`, and every array whose order
  has no meaning (changes, candidates, questions, diagnostics, …). Frame children, screen
  variants, deltas and headline lines keep their order.

## Public API

- **Extraction:** `extractDcr`, `DCR_EXTRACTOR_VERSION`; `normalizePlugin` with `PluginReadback`,
  `PluginNodeRead`, `PluginVariableRead` and `SnapshotReadError`; `canonicalSnapshot`,
  `snapshotHash` (`header.figma.snapshotHash`).
- **Validation:** `validateDcr`, `validateFigmaSnapshot`, `validateBaselineSnapshot`,
  `validateDcrAnswers`, `validateDcrDecisions`; `checkDcrIntegrity` (ids, hash, references,
  summary, order); `checkDcrVersion` (`APPLY_IR_VERSION_UNSUPPORTED` for another major).
- **Hashing:** `canonicalDcr`, `dcrItemId`, `itemIdentity`, `computeItemId`, `dcrCore`,
  `computeDcrHash`, `dcrId`, `sealDcr` (sort + stamp hash and id), `serializeDcr` (the bytes of
  `dcr.json`), `checkDcrHash` (`DCR_SNAPSHOT_PARITY` with both hashes), `CLI_ENRICHMENT_CODES`.
- **Order:** `sortDcr`, `compareItems`, `itemOrderKey`, `cloneJson`, `DCR_ITEM_KINDS`,
  `SLICE_ITEM_KINDS`.
- **Scope:** `parseDcrScope`, `formatDcrScope` (`changed | ready | page:<name> | selection:<ids> | all`).
- **Requests on a branch (D-56):** `REQUESTS_DIR`, `branchSlug`, `latestPointerName`
  (`LATEST-<branch-slug>`), `resolveChain` (orders requests by `header.parent`),
  `bindAnswers` (answers hold only for their `dcrHash`).
- **Schema files:** `dcrJsonSchemaFiles`, `DCR_PUBLISHED_SCHEMAS`; versions `DCR_VERSION`,
  `SUPPORTED_DCR_MAJORS`, `SNAPSHOT_VERSION`.

## Corpus

`test/corpus/valid/<doc>/` holds complete documents, including the worked example of 15 §6.1
as the CLI writes it (`worked-example.json`) and as the plugin submits it
(`worked-example-plugin.json`, same `dcrHash`). `invalid/<doc>/` and `integrity/dcr/` are
JSON patches on a valid base with the issues they must produce.
