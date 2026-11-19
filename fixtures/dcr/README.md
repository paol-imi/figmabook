# `@holotype/fixture-dcr`

The DCR golden cases ([12 §2.4](../../docs/plan/12-quality.md#dcr-fixtures), BUILD B-68). Each case is
a designer's edit to a branch file of [`fixtures/ds-react`](../ds-react), hand-built as the plugin would
read it, together with the request ([15 §6](../../docs/plan/15-change-requests.md#dcr-ir)) the pipeline
must produce from it, byte for byte. Private: never published.

## Scripts

Run from the repo root with `pnpm -F @holotype/fixture-dcr <script>`.

| Script         | Does                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| `test`         | validates every case now; runs the extraction, prompt and snippet goldens once they exist  |
| `seal [case…]` | derives hashes, ids and counts of the named cases (all without arguments), then runs Biome |
| `typecheck`    | `tsc`                                                                                      |

`seal` runs on built workspace packages: run `pnpm build` first.

## A case

```
<case>/
  baseline.json        BaselineSnapshot[]: every embedded baseline in scope (`base:*`, 15 §3.3)
  branch.json          FigmaSnapshot: the plugin read-back after the designer's edit (15 §4.1)
  provenance.json      optional: what the CLI's capture cache knows (CodeRefs, side files, token sites, 15 §5)
  config.json          the resolved `dcr` config (16 §15); equal to `branch:meta.dcrConfig`
  expected/dcr.json    the expected request, as `holotype dcr import` writes it
  expected/prompt.md   the expected prompt, or a placeholder whose first line is `<!-- holotype:pending … -->`
snippet/<row>.json     a `renderSnippet` input for one row of the snippet table (15 §7.3)
snippet/<row>.jsx-sketch   its expected sketch: import lines, a blank line, the sketch
```

`expected/dcr.json` is the canonical document (`serializeDcr`) pretty-printed; tests compare it after
re-serializing, so formatting never matters. `header.generated` is never in a golden. With a
`provenance.json` the golden carries the CLI-added fields (`target.code`, `origin`, `css`, `reach`,
`varDefinition`); without one it is the plugin's core plus the `DCR_PROVENANCE_MISSING` warning.

## Cases

| Case                 | The designer…                                                        | Expected                                                                                 |
| -------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `modified-padding`   | types padding 21 on Button Secondary/Md (was 17 = 16px + 1px border) | `component.modified`, D-16 arithmetic, `--space-5` question, provenance and blast radius |
| `modified-color`     | rebinds Button Primary/Md fill `button/bg` → `color/primary-active`  | `component.modified`, token before/after, provenance, blast radius                       |
| `modified-radius`    | rebinds Card Default radius `card/radius` (10) → `radius/md` (6)     | `component.modified`, four corners                                                       |
| `modified-text`      | rebinds Button Primary/Lg label font size and line height            | `component.modified` on `root/label`; HUG growth dropped                                 |
| `variant-added`      | duplicates Button Primary/Md as Variant=Danger, fill `color/danger`  | `variant.added` derived from the duplicated `vk`, inferred args                          |
| `variant-removed`    | deletes Button Ghost/Lg                                              | `variant.removed`                                                                        |
| `property-added`     | adds TEXT property "Title" to Card, bound to the title layers        | `property.added` (the layer references are part of it)                                   |
| `property-renamed`   | renames Button "Show icon" → "Icon" (same `#id`)                     | `property.changed` keyed `arg:showIcon`                                                  |
| `node-added`         | puts a Badge instance into Card Default's content                    | `node.added` with its usage                                                              |
| `node-removed`       | deletes Card Default's body text                                     | `node.removed`                                                                           |
| `component-new`      | builds "Product card" from Badge and Button instances                | `component.new`: structure, API, snippet, nearest Card, radius question                  |
| `screen-usage-basic` | draws a Checkout frame with Card, Badge and two Buttons              | `screen`: reverse-mapped props, defaults, snippet                                        |
| `instance-detached`  | detaches a Button in a Settings frame and recolors it                | `screen` + `instance.detached`                                                           |
| `token-changed`      | points `color/tone-success-bg` at `color/green-50`                   | `token.changed`; the Badge fill it recolors is not a change                              |
| `unknown`            | renames the Button component set                                     | `unknown` with `DCR_UNKNOWN_CHANGE`                                                      |
| `no-change`          | nothing (scope `all`)                                                | an empty request                                                                         |
| `noise-only`         | nothing; Figma re-measured two HUG texts by 0.002px                  | an empty request                                                                         |
| `injection`          | writes instructions into an annotation, a text and a label           | `screen` with the text kept raw, escaped in the snippet, `DCR_NOTE_SUSPICIOUS`           |

Snippet goldens: `snippet/variant`, `snippet/boolean`, `snippet/text` (escaping included).

## The case runner and its stages

`test/cases.test.ts` runs each case three times: as is, and with two seeded shuffles. Every run must
give the same bytes (sha256 of `serializeDcr`), equal to `expected/dcr.json`, with the same `dcrHash`
and id. A second check extracts at two file versions and expects the same `dcrHash` and item ids.

The pipeline is called in one place, `src/pipeline.ts`. Each stage is `pending` until its item lands,
and its tests are skipped until then:

| Stage        | Function              | Item       | While pending                                  |
| ------------ | --------------------- | ---------- | ---------------------------------------------- |
| `extract`    | `extractDcr`          | B-65, B-66 | extraction goldens skipped                     |
| `provenance` | CLI provenance attach | B-70       | goldens compared on the core only (`dcrCore`)  |
| `prompt`     | `renderPrompt`        | B-67       | `expected/prompt.md` is a placeholder; skipped |
| `snippet`    | `renderSnippet`       | B-67       | `snippet/*.jsx-sketch` skipped                 |

A guard test fails as soon as a stage's function exists (for `extract`, as soon as `extractDcr` stops
throwing `NotImplementedError`), so the flag is never left behind. To wire one: call it in
`src/pipeline.ts`, set `STAGES.<stage> = 'ready'`, run the tests, and update the goldens that disagree
with reviewer sign-off (12 §1.2). What runs now, before any stage: schema validation of every input and
expected file, the realism checks, `checkDcrIntegrity` of every golden, and the shuffle invariants.

### What a shuffle changes

The key order of every object, plus these arrays, whose order carries no meaning: the baselines,
`pages`, `pages[].topLevel`, `annotations`, `instance.overrides` and their `fields`, and the provenance
components. Everything else keeps its order because it means something: `children` (layer and
auto-layout order), baseline `order`, axes and their values, paints, and every JSON string in plugin
data (Holotype writes it canonical, 10 §2.2). `config.json` is not shuffled: `screens.states` key order
is the render order. `canonicalSnapshot` sorts the same arrays; `header.figma.snapshotHash` is
`h16(canonicalDcr(canonicalSnapshot(branch)))`, which leaves out `fileVersion`.

## How the snapshots are built

They follow `fixtures/ds-react` as the mapper and applier would produce it: Button (Variant × Size, 9
variants, TEXT `Label`, BOOLEAN `Show icon`), Badge (Tone, BOOLEAN `Dot`, TEXT `Label`) and Card
(`Story` axis), every ds-react token as a variable in one `Tokens` collection, root `branch:meta` and a
one-chunk registry. The read-back conventions they assume, until B-58 fixes `readGroups`:

- **Groups** use Figma property names (06 §6): `layout.paddingLeft`, `paint.fills`, radii per corner in
  `paint`, single-segment text flattened into `text` (`fontSize`, `lineHeight`, `fills`, …).
- **`bind`** is flat: bound fields map to variable ids (`bind.paddingLeft`, `bind.fills: [id]`), plus
  `componentPropertyReferences`. A rebinding is reported on the value field with `token.before/after`.
- **D-16:** padding includes the 1px border and is not bound (`TOKEN_PADDING_BORDER_OFFSET`).
- **`ah`** of every managed node is the applied hash of its baseline groups, so an edit shows as a
  sub-hash mismatch. **Set baselines** carry `props` and `nodes.set`, and reuse the default variant's `vk`.
- **Variables** carry Figma `scopes` (an open field, not in 15 §4.1). Candidates for a raw value are the
  variables of the same type, scope and value; for a padding the CSS value after removing the stroke.
- **Nearest** scores read 15 §4.8 as: shingles are root-to-node paths of `TYPE[:layoutMode]` up to depth
  4, names compare as word lists. The scores, titles, headlines and question texts are provisional
  goldens: B-65…B-67 may change them, with sign-off.

## Adding a case

1. Copy the closest case directory to `fixtures/dcr/<new-case>/` and give `branch:meta.branch` a new name.
2. Edit `branch.json` the way the designer would have changed the file. Keep it real: change values,
   bindings, names or the tree, never plugin data a designer cannot touch. Leave `baseline.json` as
   applied, unless the case is about the baseline.
3. Write `expected/dcr.json`: the items, questions and summary you expect. Ids may be placeholders (any
   16 hex characters, used consistently); the header's hashes and the summary counts are derived.
4. Run `pnpm build && pnpm -F @holotype/fixture-dcr seal <new-case>`. It fills in `ah` values,
   `branch:meta.dcrConfig` and `configHash`, item ids and every reference to them, the counts, the
   `dcrHash` and the request id, adds the pending `expected/prompt.md`, and refuses a request that fails
   `checkDcrIntegrity` or disagrees with the inputs.
5. Run `pnpm -F @holotype/fixture-dcr test`, and list the case in the table above.

## Public API

`src/index.ts` exports what the runner uses, for other packages' tests too: `listCases`, `loadCase`,
`loadCaseInput`, `listSnippets`, `loadSnippet`, `readCaseJson`, `readCaseText`, `parsePromptGolden`,
`CaseFileError`; `checkCaseInput`, `checkExpected`; `shuffleInput`, `shuffleKeys`, `permute`,
`seededRandom`, `SHUFFLE_SEEDS`; `canonicalSnapshot`, `canonicalBaselines`, `canonicalProvenance`,
`snapshotHash`, `configHash`, `appliedHashOf`, `readBranchMeta`, `readRegistry`; `requestBytes`,
`coreBytes`, `formatGolden`, `pendingPrompt`; `sealCase`, `sealInput`, `sealExpected`; `STAGES`,
`runPipeline`, `extract`, `comparedBytes`, `renderPrompt`, `renderSnippet`, `formatSketch`; and the
schemas of `config.json`, `branch:meta`, the registry, `provenance.json` and the snippet goldens.
