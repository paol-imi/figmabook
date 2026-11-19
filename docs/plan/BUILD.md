# BUILD: executable build plan

> **Status:** v0.2 (2026-11-19). Companion to the master plan ([README](README.md)). It keeps every binding decision (D-01…D-58). It **re-sequences** the roadmap of [14](14-roadmap.md) around a *Loop slice*: a thin but real end-to-end loop (branch → design → DCR → AI → verify) on a React + Vite Storybook 10 repo, reached in about 16–20 weeks. Fidelity and scale hardening come after the slice. Where chapters disagree, [§11](#plan-gaps) records the choice made here.
>
> **Reader:** a coordinator that dispatches coding subagents, one work item at a time, often in parallel git worktrees.

---

## Contents

1. [How to use this file](#how-to-use)
2. [Conventions](#conventions)
3. [Definition of done](#dod)
4. [The Loop slice](#loop-slice)
5. [Phase 0 work items](#phase-0-items)
6. [Loop slice work items](#slice-items)
7. [Hardening track](#hardening)
8. [`figma-fake`: the API surface](#figma-fake)
9. [Figma spike kit](#spike-kit)
10. [Merge and ordering plan](#ordering)
11. [Plan gaps and choices made here](#plan-gaps)

---

<a id="how-to-use"></a>

## 1. How to use this file

1. Pick the next item whose **Depends** are all merged. [§10](#ordering) lists the waves. Prefer **slice** items over **hardening** items until the loop demo (B-72) is done.
2. Create a worktree and branch: `git worktree add ../wt/B-xx -b build/B-xx-<slug>`.
3. Give the subagent: the item text, the linked plan sections, [§2](#conventions) and [§3](#dod).
4. One PR per item, titled `B-xx: <title>`. The coordinator merges in wave order.
5. Items marked **needs Figma desktop** end with a step for the user. Send the short instructions from the item or from [§9](#spike-kit), then wait for the pasted result.

---

<a id="conventions"></a>

## 2. Conventions

### 2.1 Labels

| Label | Meaning |
|---|---|
| **slice** | On the path to the first end-to-end loop. Built to the plan's contracts, but with the smallest scope that makes the loop real |
| **hardening** | Fidelity, scale, compatibility and UX depth. Starts after the slice item it extends, never blocks the loop demo |
| **container** | Runs fully in the agent container: Linux, Node 22, pnpm, Playwright with headless Chromium preinstalled. No Figma |
| **needs Figma desktop** | The user (or their boss) runs something in the Figma desktop app and pastes a result back |
| **S** | ≤300 changed lines, one agent session |
| **M** | 300–1,000 lines, one or two sessions |
| **L** | 1,000–2,500 lines, two or three sessions. Split into sub-PRs if it grows |
| **XL** | Not allowed. Split before dispatch |

Sizes are for dispatch planning, not the engineer-week estimates of [14](14-roadmap.md).

**Slice does not mean throwaway.** A slice item ships the final module and contract with a narrower input range. Hardening items extend it; they do not replace it.

### 2.2 Commands

B-00 provides the root scripts in the first rows (names as in the root `package.json`). Later items add the scripts marked with their item id. Every acceptance line below uses them.

| Command | Does |
|---|---|
| `pnpm i --frozen-lockfile` | install |
| `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | the PR gate (L0–L3 of [12 §1](12-quality.md#pyramid)); `lint` is Biome at the root, the others run through Turborepo |
| `pnpm check:deps` | package boundary rules (dependency-cruiser, [02 §6.2](02-architecture.md#monorepo)) |
| `pnpm -F <pkg> test` | one package's Vitest suite |
| `pnpm -F <pkg> test:e2e` | one package's Playwright suite (Chromium); added by the first item with e2e tests in that package |
| `pnpm -F @holotype/ir build && git diff --exit-code packages/ir/schema` | committed JSON Schema check (the `ir` build emits the schemas) |
| `pnpm size` | plugin bundle budgets: `build/main.js` ≤400 KB, `build/ui.js` ≤600 KB (D-04); `pnpm -F @holotype/plugin build` runs the same check |
| `pnpm -F @holotype/plugin run pack` | the plugin zip (`run` is required: bare `pnpm pack` is pnpm's built-in tarball command) |
| `pnpm diag:check` | every used diagnostic code is registered and documented (added by B-02) |

### 2.3 Shared files and conflict rules

| Hot file | Owner | Rule for everyone else |
|---|---|---|
| `pnpm-lock.yaml`, root `package.json` | none | On rebase, run `pnpm install` and commit the new lockfile. Never hand-merge it |
| `.github/workflows/*` | B-00, then B-09 | Other items do not edit workflows; they ask for a small CI follow-up item |
| `packages/ir/src/**` (schemas) | B-01 | After B-01, each schema change is its own small PR (`ir: <change>`), merged before the item that needs it, one at a time |
| `packages/shared/src/diagnostics/**` | B-02 | Codes come from [12 §6.2](12-quality.md#diagnostics). A missing code is added to 12 first, then `pnpm diag:gen` regenerates. Never edit the generated file |
| `packages/capture/src/page/collectors/index.ts` | B-11 | One import line per collector. Append only |
| `packages/mapper/src/stages/index.ts` | B-12 | One line per stage, in [07 §1](07-mapping.md) order. Append only |
| `packages/plugin/src/apply/write/index.ts` | B-14 | One line per writer. Append only |
| `packages/plugin/src/port.ts` | B-06 | Additive only. Each fake item adds the `Pick<>` members it needs |
| `fixtures/ds-react/src/**` | B-03 | New stories go in new files. Never rename a story id: tests depend on them |

### 2.4 Source of truth for shapes

Types come from [06](06-ir.md) via `@holotype/ir`, and DCR types from [15 §6](15-change-requests.md#dcr-ir). If another chapter shows a different field name, use 06 or 15 and note it in the PR. [§11](#plan-gaps) lists the known gaps.

---

<a id="dod"></a>

## 3. Definition of done

Every item meets all of these before merge. They implement D-40 (quality bar) and [12](12-quality.md). Slice items meet the same bar as hardening items: the scope is narrower, the quality is not.

### 3.1 All items

1. **Gate green.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` and `pnpm check:deps` pass. TypeScript strict, ESM only (D-03).
2. **Tests match the pyramid.** The package has the L1/L2/L3 tests that [12 §1.1](12-quality.md#pyramid) lists, for the code this item adds. Every public function has a test.
3. **Diagnostics.** Every code emitted is registered, has a docs page with a plain-language message and a remedy, and is triggered by at least one test (`pnpm diag:check`).
4. **Determinism.** Snapshot tests give the same bytes on two runs. Pure packages (`ir`, `shared`, `layout-sim`, `mapper`, `dcr`) read no clock, no random source and no environment.
5. **Boundaries.** No dependency outside [02 §6.2](02-architecture.md#monorepo) (with the exceptions of [§11](#plan-gaps)). Isomorphic packages pass the browser-bundle check.
6. **Out-of-scope inputs are explicit.** A slice item that meets an input it does not handle yet emits the plan's diagnostic for it (for example `CAP_UNSUPPORTED_*`, `APPLY_LAYOUT_FALLBACK`, `DCR_UNKNOWN_CHANGE`) and falls back safely. It never crashes or silently drops content.
7. **Docs.** The package README lists the public API added. A changeset is included for publishable packages.
8. **No secrets, no outside network** in tests. Tests talk only to `127.0.0.1`.
9. **Acceptance.** Every command in the item's **Acceptance** passes in CI, or on the user's machine for Figma steps.

### 3.2 Extra rules by item type

| Type | Extra rule |
|---|---|
| **User-facing flow** (plugin screen, CLI command) | Implements the empty, loading, error and success states from [11](11-ux.md). Plugin: one UI test per state (`pnpm -F @holotype/plugin test:ui`). CLI: a `--json` output snapshot and an exit-code test. Copy follows [11 §6.12](11-ux.md#plugin), keyboard and contrast §6.13 |
| **Page code** (capture serializer) | Built IIFE ≤150 kB ([05 §2.1](05-capture.md#injection)); no imports outside `src/page/**` plus `ir` types |
| **Plugin main** | No `figma` global outside `src/main.ts`; all writes through `FigmaPort`; async APIs only (D-06) |
| **Fixture** | Story ids are listed in the item and checked by a snapshot of the built `index.json` |
| **DCR output** | Byte-identical over 3 runs with shuffled input ([12 §2.4](12-quality.md#dcr-fixtures)); designer text always fenced or escaped (D-38) |
| **Spike kit** | Dry-runs against `figma-fake` in CI. User instructions fit on one screen. Results JSON carries no personal data ([§9.1](#spike-kit-arch)) |
| **Demo / milestone flow** | A usability check with the user or the boss on the fixture design system (D-40). The result goes into the PR |

---

<a id="loop-slice"></a>

## 4. The Loop slice

### 4.1 Why

In [14](14-roadmap.md) the first real use of the whole loop arrives at Phase 4.5 for the DCR and Phase 7 for `holotype verify`, around weeks 33–50. The slice reaches a thin but real loop in about 16–20 weeks on `fixtures/ds-react`, so the product promise (G9) is tested with real designers and a real AI agent before fidelity and scale work.

### 4.2 Scope

| Area | In the slice | Deferred to hardening |
|---|---|---|
| Storybook | SB 10.x, react-vite, static build and dev server; channel render loop; `args`/`argTypes`/`parameters.holotype` | SB 8/9 smoke, SB 11 docgen server, other renderers, composition refs |
| Variants | stories-as-variants plus **declared** args (`parameters.holotype.args.as`, enum `argTypes`); VARIANT, BOOLEAN, TEXT; one budget check | render-and-diff classification (D-13), pairwise, dedupe, states axis and pseudo-states (D-14, D-30), huge sets, INSTANCE_SWAP, SLOT |
| Capture | light DOM + open shadow, CDP geometry, solid paints, per-side borders, radius, simple shadows, opacity, clip, Latin text with platform fonts, inline SVG, PNG/JPEG images, CDP matched styles for `var()` chains and rule locations | closed shadow, gradients, masks, blend, filters, transforms, pseudo-elements, form controls, rasters, image transcode, CJK/RTL, icon fonts, probing |
| Mapper | absolute baseline; flex row/column → auto layout with `layout-sim` verification and per-container fallback (D-15); cross-variant alignment (D-27); property bindings; exact token bindings (D-18, `confidence:'chain'`); provenance side file (D-36) | wrap, grid, simplification depth, full naming chain, text wrap modes, value matching |
| Tokens | CSS custom properties → one local collection, default mode, alias chains; bindings on fills, strokes, padding, gap, radius, text fills | modes from themes, styles, library matching, `TOKEN_MODE_LIMIT` |
| Plugin | file import (topology B); fonts preflight (exact or Inter fallback); identity keys + `irh`/`ah`; **idempotent keyed in-place apply** with Merkle skip; component sets and properties | conflict UI and policies beyond "keep mine", locks UI, renames, deprecation, doc frames, Sections/pages layout, Library tab, local server and pairing (topology A) |
| Branch file | `holotype branch start\|link\|refresh` with a file handoff; proposal mode; `branch:meta`; embedded baseline `base:*` (D-34); Changes list | automated Figma branch creation (S-17), merge handling, approval |
| DCR | `component.modified`, `variant.added`, `property.added`/`property.changed`, `component.new`, `screen` usage (instances + props, one variant per screen); questions for untokenized and unmappable values; `prompt.md` with the agent contract; plugin extraction + CLI provenance attach; Submit writes the request into the file and saves a named version (D-48, D-49); `holotype dcr import` (guaranteed) and `holotype dcr --pull` (stretch, after the S-18 root-plugin-data check) | REST source and parity (S-18), breakpoints/states grouping, interactions, content/a11y, `instance.*`, `node.*` beyond basic, `targets` split, MCP tools, follow-up DCRs, `@holotype/vite-plugin` |
| Verify | `holotype verify --dcr <id>` v1: re-capture at HEAD, re-map, compare each item against its `acceptance` | follow-up DCRs, CI comments, `verify_dcr` MCP tool |

The handoff between Figma and the CLI uses **files only** in the slice: the plugin imports bundles and exports a `request.zip`. This avoids the local server, Chrome LNA and pairing (S-01) on the critical path. Topology A (D-10) arrives in hardening.

### 4.3 The loop demo (B-72)

On a throwaway git repo created from `fixtures/ds-react`:

1. Developer: `git switch -c feat/price-tag`, then `holotype branch start` (captures from the dev server, writes `branch.holotype.zip`).
2. Designer: in a Figma branch of the library file (or a duplicated file, D-32 fallback), Holotype ▸ **Import file** ▸ "Import as branch file".
3. Designer edits:
   - Button `Size=md`: padding 12 → 16, rebound to `space/4` → `component.modified`.
   - Button: duplicates `Variant=Primary` as `Variant=Danger` and changes its fill → `variant.added`.
   - Button: renames the property "Show icon" to "Icon" → `property.changed`.
   - New local component "PriceTag" made of a Badge instance and a text → `component.new`.
   - New frame "Checkout" with Card, Button and PriceTag instances → `screen` usage.
4. Designer: **Submit** ▸ reviews the summary ▸ confirms. The plugin writes the request into the file (`request:*` + `branch:meta.lastDcr`) and saves a named version (`saveVersionHistoryAsync`). Then **Notify developer** (copies a message with the branch URL and request id) or **Download request**. Designer and developer are on different computers (D-49).
5. Developer: `holotype dcr import request.zip` (the guaranteed slice path) or `holotype dcr --pull <figma-url>` (L4/L5 stretch; needs the S-18 root-plugin-data check and a Figma token) → `.holotype/requests/<id>/prompt.md` with file:line provenance.
6. An AI agent of the user's choice implements `prompt.md`, adding stories tagged `parameters.holotype.implements`.
7. Developer: `holotype verify --dcr <id>` → every item `implemented`, or `partial` with the remaining deltas. Exit 0 when all are implemented.

### 4.4 Slice milestones

Calendar assumes one owner plus about three agents in parallel ([14](14-roadmap.md#staffing)); Figma-in-the-loop steps (spikes, demos) are owner time.

| Milestone | Weeks | Demo | Items |
|---|---|---|---|
| **L0** Skeleton | 0–4 | **D1:** a story appears in Figma as frames and text | B-00…B-15, slice spikes started |
| **L1** Components | 4–9 | **D2:** Button, Badge, Input, Card as component sets with VARIANT/BOOLEAN/TEXT properties; re-import makes 0 writes | B-40…B-50, B-52…B-59, B-61 |
| **L2** Tokens and layout | 9–12 | **D3:** auto layout and variables bound to `var()` values; the Variables panel shows the ds-react tokens | B-49, B-51, B-56, B-60 |
| **L3** Branch file | 12–14 | **D4:** a designer edit shows up in the Changes tab of a branch file | B-62, B-63 |
| **L4** DCR | 14–17 | **D5:** Submit gives a `prompt.md` with provenance. A "paper" demo on fixtures comes earlier (≈ week 13, after B-67) | B-64…B-70 |
| **L5** Loop | 17–20 | **D6:** the full loop of §4.3 with a real AI agent | B-71, B-72 |

[14](14-roadmap.md)'s exit criteria still apply, but to the hardening milestones: M1 (fidelity), M2 (structure), M3 (variants at scale), M4 (sync UX), M4.5 (full DCR). [§7](#hardening) maps each hardening group to them.

---

<a id="phase-0-items"></a>

## 5. Phase 0 work items

Goal: the skeleton, the fixtures, the spike kits, and one story flowing CLI → bundle → plugin ([14 Phase 0](14-roadmap.md#phase-0)).

### 5.1 Foundations

#### B-00 · Monorepo scaffold — **IN PROGRESS (another agent)**

**Path** repo root, `packages/*` · **Depends** — · **Track** slice · **Runs** container · **Size** L

Build:
- pnpm workspaces + Turborepo + Biome + Vitest + tsup + changesets (D-04). Node `>=22.12`, CI on 22 and 24 (D-53).
- Every `@holotype/*` package from [README §6](README.md) as a building, tested stub: `ir`, `shared`, `layout-sim`, `storybook`, `capture`, `planner`, `mapper`, `plugin`, `figma-fake`, `cli`, `storybook-addon`, `action`, `dcr`, `vite-plugin`, plus `tools/fidelity`.
- `shared`: `Diagnostic`, `defineDiagnostic()`, registry, `Result<T,E>`, `Logger` interface.
- `ir`: `canonicalJSON()` per [06 §5](06-ir.md), `h16()` (sha256 → 16 hex, `@noble/hashes`), `sha256hex()`, `fnv1a64()` for `ah` (D-31). Property tests with fast-check.
- dependency-cruiser rules from [02 §6.2](02-architecture.md#monorepo). CI: install, lint, typecheck, test, build, `check:deps`.

Acceptance: `pnpm i --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:deps`; property tests for canonical JSON (idempotent, key-order independent, `-0` → `0`, NaN throws) and both hashes (known vectors).

Checklist when B-00 lands. If a line is missing, open **B-00b** (S):
- workspace globs include `fixtures/*`, `spikes/*`, `tools/*`;
- the root scripts of [§2.2](#conventions) exist;
- `playwright-core` is pinned to the exact version preinstalled in the container (D-05);
- Biome restricts `node:*`, `process`, `Buffer`, `Date.now`, `Math.random` in `ir`, `shared`, `layout-sim`, `mapper`, `dcr`, and the `figma` global in `packages/plugin/src/apply/**`;
- dependency-cruiser applies boundary rules to `src/**` only, so tests may import `figma-fake`;
- the boundary exceptions of [§11](#plan-gaps) rows 2–4 are encoded.

#### B-01 · `ir` schemas v0

**Path** `packages/ir` · **Depends** B-00 · **Track** slice · **Runs** container · **Size** L

Build (TypeBox is the source of truth, D-07):
- `primitives.ts`, `capture.ts` (`CaptureDoc`, `CNode`, text, assets, fonts, custom properties, `styleSheets`; [06 §1–2](06-ir.md)).
- `scene.ts` (`SceneComponent`, `ScenePropertyDef`, `SceneVariant`, `SceneNode`, layout, paints, text, instance, bindings; [06 §3](06-ir.md)).
- `bundle.ts`: `BundleManifest` ([06 §4.2](06-ir.md)) plus `integrity: {algo:'sha256', files}` ([02 §5.1](02-architecture.md)) and an optional `branch` block (`BranchMeta` minus `fileKey`, [15 §2.2](15-change-requests.md#branch-model); shape in [06](06-ir.md#branch-block)). The `branch` block carries `dcrConfig` + `configHash`; the plugin copies them to `branch:meta` (D-50).
- `tokens.ts` (`TokensDoc`, [06 §4.3](06-ir.md#tokens)), `report.ts` (`BundleReport`, 06 §4.4), `provenance.ts` (`ProvenanceDoc`, `NodeProvenance`, `FieldOrigin`, `SourceLoc`, [15 §5.2](15-change-requests.md#provenance)).
- `config.ts`: `HolotypeParams` from [04 §9](04-variant-model.md#schema) (it now includes `implements`, `replacedBy`, `channelCapture`, `excludeCombos`, `split`, `grid` and `budget.hardLimit`); project-level keys from [16](16-config.md#reference) (D-51).
- `pipeline.ts`: cross-package inputs the mapper may not import from elsewhere: `VariantPlan`, `ComponentMetaInput`, `ComponentCatalog`, `TokenResolution` ([07 §0](07-mapping.md)), and `CodeRef` ([15 §5.3](15-change-requests.md#provenance)).
- Compiled validators (`TypeCompiler`) for every top-level document; `checkSceneInvariants()` ([06 §9](06-ir.md)); `migrations/scene/` (empty) and `migrateScene()`.
- Schema emitter → `packages/ir/schema/{capture,scene,tokens,bundle,report,config,provenance}.v1.json`.

Acceptance:
- `pnpm -F @holotype/ir test`: a valid/invalid corpus in `test/corpus/` passes and fails as named, including the Button excerpt of [06 §10](06-ir.md) completed into a valid document.
- Round trip `validate(parse(canonicalJSON(x)))` for every valid corpus file.
- `pnpm -F @holotype/ir build && git diff --exit-code packages/ir/schema`.

Parallel: owns `packages/ir/**`. Runs alongside B-02, B-03, B-06, B-07, B-08.

#### B-02 · Diagnostics catalog from chapter 12

**Path** `tools/diag-gen`, `packages/shared/src/diagnostics/**`, `docs/diagnostics/**` · **Depends** B-00 · **Track** slice · **Runs** container · **Size** M

Build:
- `tools/diag-gen` parses the tables of [12 §6.2](12-quality.md#diagnostics) into `catalog.generated.ts`: `{code, domain, severity, message, remedy, emittedBy, definedIn}`.
- One page per code, `docs/diagnostics/<CODE>.md`: what happened, what to do, where it is defined (D-40).
- `pnpm diag:gen` and `pnpm diag:check`. The check fails on a code literal in `packages/**/src` that is not registered, a code without a page, or per-domain row counts that differ from the catalog's header line.

Acceptance: `pnpm diag:gen && git diff --exit-code`; `pnpm diag:check`; a unit test that codes are unique and every remedy is non-empty.

Note: chapter 12 is being edited by another agent. Run after that edit lands; re-run `pnpm diag:gen` whenever 12 changes.

#### B-03 · Fixture design system `fixtures/ds-react`

**Path** `fixtures/ds-react` (private package `@holotype/fixture-ds-react`), `fixtures/fonts.lock` · **Depends** B-00 · **Track** slice · **Runs** container · **Size** L

A small React + Vite design system on Storybook 10.6.x (`@storybook/react-vite`, D-11, D-26). Capture, mapper, DCR tests and the loop demo use it.

Build:
- **Tokens** `src/tokens/tokens.css`. Primitives: `--color-<hue>-<step>`, `--space-1..8`, `--radius-sm|md|lg|full`, `--font-size-*`, `--line-height-*`, `--shadow-sm|md`. Semantic aliases: `--color-bg`, `--color-fg`, `--color-primary`, `--button-bg: var(--color-primary)`. A dark theme under `[data-theme="dark"]` (hardening uses it for modes). One `calc()` and one `color-mix()` token (unbindable cases, [12 §2.2](12-quality.md#fixtures)).
- **Font:** Inter 400/500/600/700 from `@fontsource/inter`, self-hosted. `fixtures/fonts.lock` lists each file and its sha256 ([12 §1.2](12-quality.md#pyramid)). Inter also exists in Figma, so fonts preflight passes.
- **Components**, each with a CSS module that uses only token values:

| Component | Props (args) | Exercises |
|---|---|---|
| `Button` | `variant: 'primary'\|'secondary'\|'ghost'`, `size: 'sm'\|'md'\|'lg'`, `label`, `disabled`, `loading`, `iconLeading?: IconName`, `showIcon` | VARIANT axes, BOOLEAN, TEXT, states (`:hover`, `:focus-visible`, `:active`), spinner |
| `Badge` | `tone: 'neutral'\|'info'\|'success'\|'warning'\|'danger'`, `label`, `dot` | inline box, HUG |
| `Input` | `label`, `placeholder`, `value`, `helperText`, `error?`, `disabled`, `prefixIcon?` | `::placeholder`, native input, invalid state |
| `Card` | `title`, `body`, `media` (local image), `children` (actions) | `margin-top:auto` footer, line clamp, `object-fit` |
| `Stack` | `direction`, `gap: 1..8`, `align`, `justify`, `wrap`, `children` | flex layouts |
| `Icon` | `name` (8 inline SVGs from Lucide, ISC), `size: 16\|20\|24` | inline SVG, `currentColor` |

- **Stories** (CSF3). Titles `Components/<Name>`, so `sid` = `components-<name>`. Fixed story ids:
  - `components-button--primary`, `--secondary`, `--ghost`, `--small`, `--large`, `--with-icon`, `--loading`, `--disabled`
  - `components-badge--default`, `--tones`, `--with-dot`
  - `components-input--default`, `--with-error`, `--disabled`, `--with-prefix`
  - `components-card--default`, `--with-media`, `--long-text`
  - `components-stack--row`, `--column`, `--wrap`
  - `components-icon--default`, `components-icon--gallery` (tagged `!figma`, to test opt-out)
- Every story has `args` and `argTypes` with controls.
- **`parameters.holotype` usages** (schema [04 §9](04-variant-model.md#schema)):
  1. Button meta: `args: { variant: { as: 'variant' }, size: { as: 'variant' }, label: { as: 'text' }, showIcon: { as: 'boolean' } }`, `states: { include: ['default','hover','focus-visible','active'], foldBooleans: ['disabled','loading'] }` (states are hardening; the slice reads and ignores them with `PLAN_FEATURE_DOWNGRADED`), `grid: { columns: ['Size'], rows: ['Variant'] }`.
  2. Badge meta: `args: { tone: { as: 'variant', name: 'Tone' }, dot: { as: 'boolean', name: 'Dot' }, label: { as: 'text' } }`.
  3. Stack `--wrap`: `keepLayout: true` and `width: { probe: [240, 480] }`.
  4. Card `--long-text`: `textMode: 'locked-lines'`.
  5. Card meta: `slots: { actions: { selector: '[data-slot=actions]' } }`.
- `.storybook/preview.tsx`: `globalTypes.theme` (light/dark) applied by a decorator as `data-theme` ([03 §8](03-storybook.md#themes)).

Acceptance:
- `pnpm -F @holotype/fixture-ds-react build-storybook` writes `storybook-static/` (gitignored). A snapshot checks the sorted story ids in `index.json`.
- `pnpm -F @holotype/fixture-ds-react test:smoke` (Playwright): every story renders, no console error, no request outside `127.0.0.1`, `document.fonts.check('600 14px Inter')` is true.
- `pnpm -F @holotype/fixture-ds-react dev` serves on port 6006 with CSS source maps (branch mode, S-19): the fixture's Storybook `viteFinal` sets `css.devSourcemap: true`; inline sheets resolve through `ownerNode` → `data-vite-dev-id`, ranges offset by `startLine`/`startColumn`; `DCR_PROVENANCE_NO_SOURCEMAP` otherwise.

Parallel: owns `fixtures/ds-react/**`. B-04 and B-05 add files only.

#### B-04 · Micro-fixtures, batch 1 (30 stories)

**Path** `fixtures/ds-react/src/micro/**` · **Depends** B-03 · **Track** slice · **Runs** container · **Size** M

Plain-markup stories, one feature each ([12 §2.2](12-quality.md#fixtures)). Titles `Micro/<Group>`, ids `micro-<group>--<case>`:

| Group | Cases |
|---|---|
| flex (8) | `row`, `column`, `wrap`, `gap`, `justify-between`, `align-center`, `grow`, `nested` |
| borders (7) | `uniform`, `per-side-widths`, `per-side-colors`, `dashed`, `outline-offset`, `radius-per-corner`, `radius-overflow` |
| backgrounds (8) | `solid-alpha`, `oklch`, `linear-angle`, `linear-hard-stops`, `radial`, `conic`, `multi-layer`, `image-cover` |
| text (7) | `single-line`, `wrap-paragraph`, `weights`, `line-height-px`, `letter-spacing`, `text-transform`, `mixed-inline` |

The slice must handle flex, borders, `solid-alpha`, `oklch`, `image-cover` and text. The gradient cases exist so the slice proves its fallback diagnostics.

Acceptance: covered by the B-03 smoke test; the `index.json` id snapshot includes all 30.

#### B-05 · Styling-variant fixtures

**Path** `fixtures/ds-react/src/styling/**` · **Depends** B-03 · **Track** hardening · **Runs** container · **Size** S

The same Button styled three more ways, for S-08 and the non-CSS-module half of S-19: plain global CSS (`styling-button-css--default`), emotion (`styling-button-emotion--default`), Tailwind v4 (`styling-button-tailwind--default`). Each has a `:hover` and a JS-driven hover (`onMouseEnter` → `data-state`).

Acceptance: smoke test passes; ids in the snapshot.

#### B-06 · `figma-fake` core and the `FigmaPort` type

**Path** `packages/figma-fake`, `packages/plugin/src/port.ts` · **Depends** B-00 · **Track** slice · **Runs** container · **Size** L

Build:
- `port.ts`: `FigmaPort` as a `Pick<>` of `@figma/plugin-typings@1.142.0` ([09 §4](09-plugin.md#port)), with the members of [§8.1](#figma-fake) rows "Global" to "Text".
- `createFakeFigma(opts) → FigmaPort & { snapshot(): FakeTree; ops(): Op[]; reset() }`.
- In-memory tree with real-looking ids (`<n>:<m>`), shared plugin data, `findAllWithCriteria`, a fonts list, and the throw rules of [§8.1](#figma-fake).
- `snapshot()`: canonical JSON of the document. `ops()`: an ordered log of every write (method, node id, property, value).
- A contract test per throw rule, named after its row in [09 §6.2](09-plugin.md#apply-order).

Acceptance: `pnpm -F @holotype/figma-fake test`; `typecheck` proves `createFakeFigma()` satisfies `FigmaPort` with no casts.

Parallel: owns `packages/figma-fake/**` and `port.ts`. B-00 may already have created stubs of both (it did for `port.ts`); B-06 fills them in and B-07 does not touch `port.ts`. The same applies to any B-00 stub: the item that owns the path replaces it.

#### B-07 · Plugin scaffold

**Path** `packages/plugin` (except `port.ts`) · **Depends** B-00 · **Track** slice · **Runs** container · **Size** M

Build:
- create-figma-plugin project (D-06): `src/main.ts`, `src/ui/**` (Preact), `src/protocol.ts` (the message union of [09 §3.2](09-plugin.md#protocol); slice subset `hello`, `session.open`, `unit`, `need`, `progress`, `diagnostics`, `done`, `error`, `cancel`, `ping`/`pong`, then `branch.link`, `changes.request`, `snapshot.request`, `branch.meta.patch` when B-63/B-69 need them).
- Manifest from the `figma-plugin` field ([09 §2](09-plugin.md#manifest)): `documentAccess: "dynamic-page"`, `editorType: ["figma"]`, candidate `networkAccess`, `reasoning`, and **`enablePrivatePluginApi: true`** so `figma.fileKey` is readable (needed for `branch:meta.fileKey`; see [§11](#plan-gaps)). The real manifest `id` is fixed forever; until Figma issues one, use a placeholder and say so in the PR.
- UI shell: tabs Library / Import file / Report / Settings ([11 §5](11-ux.md#plugin)); Library and Settings show "coming soon". Message catalog `ui/messages/en.json`.
- `pnpm -F @holotype/plugin build` → `manifest.json`, `build/main.js`, `build/ui.js` (shown with create-figma-plugin's `showUI()`; there is no `ui.html`). `pnpm -F @holotype/plugin run pack` (not `pnpm pack`, which is pnpm's built-in tarball command) → `holotype-plugin-<version>.zip` with fixed mtimes ([02 §6.4](02-architecture.md#monorepo)).

Acceptance: build and pack succeed; `pnpm size` within budget; UI tests render each tab's empty state; protocol tests round-trip every message type through a mocked `figma.ui`.

#### B-08 · Spike kit infrastructure (`spikes/runner`)

**Path** `spikes/runner`, `spikes/_shared`, `spikes/README.md` · **Depends** B-00 · **Track** slice · **Runs** container (build), needs Figma desktop (use) · **Size** M

One development plugin, "Holotype Spikes", that hosts every Figma spike, so the user imports it once. Details in [§9.1](#spike-kit-arch).

Acceptance: `pnpm -F @holotype/spikes build` → `spikes/dist/holotype-spikes-<version>.zip`; `pnpm -F @holotype/spikes test` dry-runs a sample spike against `figma-fake`; UI tests for the spike list, a running spike, a finished spike (Copy results) and a failed spike.

#### B-09 · CI: end-to-end jobs and artifacts

**Path** `.github/workflows/**` · **Depends** B-03, B-07, B-08 · **Track** slice · **Runs** container · **Size** S

Build: a Playwright job that builds `fixtures/ds-react` once (cached by lockfile + source hash) and runs every `test:e2e`; the plugin bundle-size check; artifacts `holotype-plugin-<version>.zip` and `holotype-spikes-<version>.zip` on every main build, so the coordinator can send the user a download link.

Acceptance: a PR shows the e2e job and both artifacts.

### 5.2 Walking skeleton (L0, demo D1)

These six items make one story appear in Figma as frames and text. The slice items of [§6](#slice-items) deepen each one.

#### B-10 · `storybook` adapter v0: discovery and URL render

**Path** `packages/storybook` · **Depends** B-01, B-03 · **Track** slice · **Runs** container · **Size** M

Build ([03 §2–3](03-storybook.md), [§5.4](03-storybook.md#render-loop-driver)):
- `connectStorybook({ source })`: a static dir (served with sirv on a free loopback port) or a dev URL. Reads `index.json` v5 and `project.json`; fills `SbCapabilities` (03 §3.1).
- `listStories()` with `figma` / `!figma` tag filtering (README §7).
- `RenderDriver.render()` via the URL path; readiness `storyFinished ?? storyRendered`, `document.fonts.ready`, two animation frames.
- Root detection `#storybook-root` ([03 §6.1](03-storybook.md#root)).
- Codes `SB_INDEX_UNREACHABLE`, `SB_VERSION_UNSUPPORTED`, `SB_STORY_ERROR`, `SB_RENDER_TIMEOUT`.

Acceptance: `pnpm -F @holotype/storybook test` (index v4/v5 parsing, tag filter); `test:e2e` renders `components-button--primary` and `micro-flex--row` from the static build and returns a root handle.

#### B-11 · `capture` v0: pool, environment, serializer skeleton

**Path** `packages/capture` · **Depends** B-01, B-10 · **Track** slice · **Runs** container · **Size** L

Build ([05 §1–2](05-capture.md#orchestration)):
- `createCapturer(opts) → Capturer` with `capture(req)` and `close()`. One Chromium, N contexts, context options and flags of D-24 and [05 §1.3](05-capture.md#orchestration), pinned clock, seeded `Math.random`.
- `src/page/**` built by esbuild into one IIFE string, exported as `serializerSource`, injected with `addInitScript`.
- Collector registry `src/page/collectors/index.ts`. v0 collectors: element rects, `background-color`, uniform border, `border-radius`, `opacity`, text runs (family, size, weight, color) with line boxes.
- Output: a `CaptureDoc` that validates (optional fields left out); a root screenshot @2x.

Acceptance: `pnpm -F @holotype/capture test` (whitespace collapse, color parse); `test:e2e`: L3 snapshots `micro-flex--row → CaptureDoc` and `components-badge--default → CaptureDoc`, byte-identical across two runs; built IIFE ≤150 kB.

#### B-12 · `mapper` v0: absolute Scene IR

**Path** `packages/mapper` · **Depends** B-01 · **Track** slice · **Runs** container · **Size** M

Build ([07 §0–1](07-mapping.md)):
- `mapComponent(input: MapperInput) → MapperOutput`, pure. Stage registry `src/stages/index.ts`.
- v0 stages: normalize (drop paint-less empty wrappers), absolute frames (`xy` + `size`), SOLID fills, uniform INSIDE stroke, radius, opacity, one TEXT node per text block with one range, `nk` path signatures ([10 §4](10-sync.md#nk)), `expect`, `irh` bottom-up ([06 §6](06-ir.md#hashing)), invariant check.
- A single-variant `kind: 'component'` scene; `vk` per [06 §6](06-ir.md#hashing).

Acceptance: `pnpm -F @holotype/mapper test`: L3 snapshots from hand-written `CaptureDoc` JSON in `test/fixtures/` (switch to B-11 snapshots once merged); property test "every node's absolute rect equals its capture rect".

#### B-13 · `cli` v0: `capture` and the bundle writer

**Path** `packages/cli`, `packages/planner` (one function) · **Depends** B-10, B-11, B-12 · **Track** slice · **Runs** container · **Size** M

Build:
- `holotype capture --storybook <dir|url> --story <id> --out <dir|file.holotype.zip> [--json]` (citty).
- `planner.planSingleStory(model, storyId)` → a one-variant `VariantPlan`.
- Bundle writer `src/bundle/**` ([02 §5.1](02-architecture.md), [06 §4](06-ir.md)): `manifest.json` first, `components/<sid>.json`, `assets/<sha>`, `report.json`, `integrity`. Zip with fflate (STORE for images, DEFLATE for JSON).
- Exit codes per [11 §3.2](11-ux.md).

Acceptance: `test:e2e`: capture `micro-flex--row` to a zip; unzip; manifest and scene validate; integrity matches; `--json` snapshot; exit code 3 for a missing Storybook dir.

#### B-14 · Plugin v0: file import and absolute applier

**Path** `packages/plugin/src/{ui/import,apply,main.ts}` · **Depends** B-01, B-06, B-07 · **Track** slice · **Runs** container (tests), needs Figma desktop (via B-15) · **Size** L

Build:
- **Import file** screen ([11 §2.3](11-ux.md), §6.11): drop zone or picker; unzip in a Web Worker with fflate; validate manifest and scenes with the compiled validators; integrity check (`APPLY_BUNDLE_CORRUPT`); IR major check (`APPLY_IR_VERSION_UNSUPPORTED`). States: empty, loading, error, success.
- Pull loop and chunking ([09 §3.3](09-plugin.md#protocol)).
- `apply/` through `FigmaPort` only: page "Components" (created if absent), one frame per variant, then children pre-order with the write order of [09 §6](09-plugin.md#apply-order) steps 0–2, 4, 5, 8, 10. `writeIdentity()` writes `nk`, `vk`, `irh`, `v`.
- Fonts: `loadFontAsync` per unique FontName; on failure fall back to Inter at the nearest weight with `FONT_MISSING`.
- Select the new frames, `notify`, `commitUndo` once per component.

Acceptance: `pnpm -F @holotype/plugin test`: L3 snapshot `Scene IR → figma-fake tree + op log` for the B-12 fixtures; no fake throw; UI tests for the four Import states.

#### B-15 · L0 smoke: CLI → bundle → plugin (demo D1)

**Path** `tests/smoke/**` · **Depends** B-04, B-13, B-14 · **Track** slice · **Runs** container + **needs Figma desktop** · **Size** S

Container: `pnpm test:smoke` captures `micro-flex--row` and `components-badge--default` into `smoke.holotype.zip`, applies it to `figma-fake`, and compares with a committed snapshot.

User steps (send as written):
1. Download `holotype-plugin-<version>.zip` and `smoke.holotype.zip` from the link I send. Unzip the plugin to a folder that stays put.
2. In the Figma desktop app, open a new design file.
3. Menu **Plugins ▸ Development ▸ Import plugin from manifest…** and pick `manifest.json` in that folder.
4. Run **Plugins ▸ Development ▸ Holotype**. Open **Import file** and drop `smoke.holotype.zip`.
5. Reply "smoke OK" if you see a row of three boxes and a badge. Otherwise copy the plugin's message and paste it here.

Acceptance: CI green; the user replies "smoke OK". This is **demo D1**, the first visible demo, and the [14](14-roadmap.md) M0 smoke criterion.

### 5.3 Container-only spikes

Each ends with `docs/spikes/S-xx.md` and a proposed README §5 update. The coordinator confirms README changes with the user (README is binding).

| ID | Spike | Track | Path | Depends | Size | Build | Acceptance |
|---|---|---|---|---|---|---|---|
| **B-16** | S-07 render loop | slice (SB 10 part), hardening (8.6/9.1/11) | `tools/sandboxes`, `spikes/S-07` | B-10 | M | Sandbox generator (react-vite on 10.6.x first; 11-beta, 8.6, 9.1 later); 200-variant channel loop with failure injection ([14 S-07](14-roadmap.md#phase-0)) | report: SB 10 quirks and throughput (slice); other versions (hardening) |
| **B-17** | S-08 pseudo-states | hardening | `spikes/S-08` | B-05, B-11 | M | CDP force vs real hover vs addon global on ds-react, the styling variants, small MUI and shadcn sandboxes | per-strategy success table; D-14 ordering proposal |
| **B-18** | S-13 detection (capture half) | hardening | `spikes/S-13` | B-11 | S | React fiber `type` ↔ Storybook `component` refs, dev and static; structural hash; a Card→Button→Icon story | precision/recall per build mode |
| **B-19** | S-19 provenance | slice (CSS modules), hardening (rest) | `spikes/S-19`, `packages/vite-plugin` (prototype) | B-11 (B-05 for the hardening half) | M | CDP `styleSheetId` + `style.range` + `CSS.styleSheetAdded` source maps on the dev server for CSS modules first, then plain CSS, Tailwind v4, emotion. The fixture's Storybook `viteFinal` sets `css.devSourcemap: true`; inline sheets resolve through `ownerNode` → `data-vite-dev-id`, ranges offset by `startLine`/`startColumn`. `data-holotype-loc` prototype for React 19 | coverage table; resolver module reused by B-45; `DCR_PROVENANCE_*` thresholds; `DCR_PROVENANCE_NO_SOURCEMAP` when a sheet has no source map |

The container halves of S-03, S-04, S-05, S-09, S-10 and S-16 (Chromium reference renders) are part of their kits in [§9](#spike-kit).

---

<a id="slice-items"></a>

## 6. Loop slice work items

All items in this section are **slice**. They start once B-15 is merged, unless noted. Each lists the hardening items that extend it later.

### 6.1 L1: components with variants in Figma

#### B-40 · `storybook` adapter v1: render loop and metadata

**Path** `packages/storybook` · **Depends** B-10, B-16 · **Runs** container · **Size** M

Build:
- Channel render loop (`setCurrentStory`, `updateStoryArgs`, `updateGlobals`, [03 §5.2–5.3](03-storybook.md#render-loop-driver)) with the URL path as fallback; settle protocol ([03 §5.5](03-storybook.md#settle-protocol)); decorator unwrap and `keepLayout` ([03 §6.2](03-storybook.md#root)); retries per [02 §1.3](02-architecture.md).
- `describe(ids)`: `args`, `initialArgs`, `argTypes` (incl. `options`), `tags`, merged `parameters.holotype` (README §7 precedence, validated with `validateParams`, `PLAN_PARAM_UNKNOWN_KEY`), and `CodeRef` (`importPath` from `index.json`; component path and export name from the SB 10 component manifest when present) ([03 §4](03-storybook.md#metadata-extraction), [15 §5.3](15-change-requests.md#provenance)).
- SB 10 only. Other versions: `SB_VERSION_UNTESTED` (warn).

Acceptance: `test:e2e`: 50 renders of different stories on one page with no reload; a throwing story gives `SB_STORY_ERROR` and the next render succeeds; `describe()` snapshot for every ds-react component.

Hardening: B-140 (SB 11 docgen server), B-141 (SB 8/9 smoke), B-118 (globals/themes, pseudo-states).

#### B-41 · `capture`: composed tree and geometry

**Path** `packages/capture/src/{page/walk,page/collectors/geometry,cdp}` · **Depends** B-11, B-40 · **Runs** container · **Size** L

Build ([05 §3](05-capture.md#walk), §3.1–3.2, §8): light DOM + open shadow roots + `display:contents`; `data-fx-id` stamping and the CDP id map ([05 §2.3](05-capture.md#injection)); CDP box model; computed-style subset diffed against defaults; stacking order. Rotated or transformed nodes: capture the quad and mark the node for rasterization in hardening (`CAP_NON_AFFINE_RASTERIZED` for 3D or perspective transforms; the mapper reports `PAINT_SUBTREE_RASTERIZED`).

Acceptance: unit tests; `test:e2e` snapshots for `micro-flex--*`, `micro-borders--uniform`, and every ds-react story; T0: every captured rect equals a live re-measure within 0.01 px.

Hardening: B-100 (closed shadow, slots), B-102 (transforms).

#### B-42 · `capture`: paint facts (subset)

**Path** `packages/capture/src/page/collectors/paint` · **Depends** B-41 · **Runs** container · **Size** M

Build ([05 §7](05-capture.md)): colors with colorjs.io (sRGB; P3/oklch gamut-mapped, `original` text kept); solid background; `background-image: url()` with size/position; per-side border widths, colors and solid/dashed styles; radius per corner; box-shadow (outer and inset); opacity; `overflow` clip. Gradients, masks, blend and filters emit their `PAINT_*` codes and are recorded raw for hardening.

Acceptance: unit tests on the shadow and color parsers; property test for in-gamut color round trips; `test:e2e` snapshots for `micro-borders--*`, `micro-backgrounds--solid-alpha|oklch|image-cover`, and every ds-react story.

Hardening: B-101.

#### B-43 · `capture`: text and fonts (Latin)

**Path** `packages/capture/src/page/collectors/text`, `packages/capture/src/cdp/fonts.ts` · **Depends** B-41 · **Runs** container · **Size** L

Build ([05 §4](05-capture.md)): inline formatting contexts → one text block with styled runs; lines from range rects; whitespace and `text-transform`; `lineHeightPx` per style; underline; CDP `CSS.getPlatformFontsForNode` ([05 §4.3](05-capture.md#fonts)); web-font inventory; `TEXT_*`, `FONT_*` codes.

Acceptance: unit tests (whitespace collapse, run splitting); `test:e2e` snapshots for `micro-text--*` and `components-card--long-text`; line counts equal the browser's on all text micro-fixtures.

Hardening: B-105 (CJK, RTL, emoji, variable fonts), B-106 (icon fonts).

#### B-44 · `capture`: inline SVG, images, placeholder

**Path** `packages/capture/src/{page/collectors/replaced,assets}` · **Depends** B-41 · **Runs** container · **Size** M

Build ([05 §5](05-capture.md#images)): inline SVG serialized with styles inlined and `currentColor` resolved; `<img>` and CSS URL images in PNG/JPEG fetched through `Network.getResponseBody` and deduped by sha256; `::placeholder` text for inputs. Other formats, pseudo-elements, controls and rasters emit their `CAP_*` code.

Acceptance: `test:e2e` snapshots for `components-icon--default`, `components-input--default`, `components-card--with-media`; dedupe test (two stories, one image, one asset).

Hardening: B-103, B-104.

#### B-45 · `capture`: matched styles, `var()` chains and rule locations

**Path** `packages/capture/src/cdp/{matched,sourcemap}.ts` · **Depends** B-41, B-19 · **Runs** container · **Size** L

One CDP pass that feeds both tokens (D-18) and provenance (D-36).

Build ([05 §6.2](05-capture.md#authored), [08 §3–5](08-tokens.md#provenance), [15 §5.1](15-change-requests.md#provenance)):
- `CSS.getMatchedStylesForNode` for elements that carry mapped properties; the winning declaration per property (paint, border, radius, padding, gap, font size, color); its `var()` chain (`CVarChain`); `rule.styleSheetId` + `style.range`.
- The custom-property table (`CCustomPropertyTable`) for `:root` and `[data-theme]` scopes.
- `CSS.styleSheetAdded` headers into `CaptureDoc.styleSheets`; the S-19 resolver maps ranges through Vite dev source maps to `SourceLoc` (repo-relative, validated inside the repo). The CLI forces `css.devSourcemap: true` through `viteFinal`; inline sheets resolve through `ownerNode` → `data-vite-dev-id`, ranges offset by `startLine`/`startColumn`; a sheet without a source map gives `DCR_PROVENANCE_NO_SOURCEMAP`. Static builds give selectors only (`DCR_PROVENANCE_MINIFIED`).
- Cost control per [08 §4.5](08-tokens.md#prov-cost).

Acceptance: `test:e2e` on the **dev server**: for `components-button--primary`, `padding-left` resolves to `--space-3` and to `Button.module.css:<line>`; `background-color` resolves through `--button-bg` → `--color-primary`; a `calc()` value has no chain; snapshot of the custom-property table.

#### B-46 · `planner` (slice): declared variants and properties

**Path** `packages/planner` · **Depends** B-40 · **Runs** container · **Size** M

Build ([04 §1–2](04-variant-model.md), §8):
- `planComponent(model, sid, config)` for the slice: variant sources per D-12 without classification renders: curated `variants` > stories-as-variants > the product of args declared `as: 'variant'` (values from `argTypes.options` or `values`).
- Arg kinds: declared `variant` / `boolean` / `text` / `fixed` / `ignore`; otherwise boolean args → BOOLEAN and string args → TEXT with `evidence: 'type-only'`; everything else FIXED. `valueMap` per [06 §3.1](06-ir.md).
- `vk` per variant, set grid (`grid.columns/rows`), the budget check (`budget.max` 256 → `PLAN_*` error naming the budget).
- Unhandled parameters (`states`, `modes`, `viewports`, `slots`) are read, validated and reported as downgraded.

Acceptance: unit tests per rule; snapshot plans for Button (3 × 3 variants, Label TEXT, Show icon BOOLEAN), Badge (5 tones, Dot, Label), Input, Card.

Hardening: B-117 (render-and-diff), B-118 (states axis), B-119 (pairwise, dedupe, large sets).

#### B-47 · `layout-sim` stack v0

**Path** `packages/layout-sim` · **Depends** B-01 · **Runs** container · **Size** M

Build ([07 §6.1](07-mapping.md#verification)): `simulateAutoLayout(spec, children)` and `measureHug()` for HORIZONTAL and VERTICAL stacks: padding, spacing (also negative), `MIN`/`CENTER`/`MAX`/`SPACE_BETWEEN`, `BASELINE` (horizontal), FIXED/HUG/FILL children, min/max, absolute children. No wrap, no grid.

Acceptance: unit tests; L2 property test `simulate(spec(rects)) == rects` for generated specs; monotonicity under FIXED sizes.

Hardening: B-111 (wrap), B-112 (grid, S-10).

#### B-48 · `mapper` core (slice)

**Path** `packages/mapper/src/stages/{normalize,order,visuals,text,replaced,naming,emit}` · **Depends** B-12 · **Runs** container · **Size** L

Build ([07 §2, §7–10, §12](07-mapping.md)): tree normalization; paint order; solid fills, image fills, borders per D-16 as provisionally specified (decided by S-05, B-24; per-side colors decomposed), radius, shadows, opacity, clip; text ranges with px line height and `reflow` wrap, `SceneFontRequest`; `svg` and `image` nodes; basic naming; `expect` on every node. Unhandled paints fall back with their codes.

Acceptance: L3 snapshots `CaptureDoc → Scene IR` for every slice micro-fixture and ds-react story (inputs: the B-41…B-44 snapshots); property test "normalization keeps every node's absolute rect".

Hardening: B-101, B-105, B-114, B-115.

#### B-49 · `mapper` auto layout v0

**Path** `packages/mapper/src/stages/layout/**` · **Depends** B-47, B-48 · **Runs** container · **Size** L

Build ([07 §3–4, §6](07-mapping.md#border-padding)): container classification; flex row/column → HORIZONTAL/VERTICAL with padding (Scene padding = CSS padding + border, `strokesIncludedInLayout:false`, D-16), gap, alignment, container and child sizing (HUG/FIXED/FILL), absolute children with constraints; a block flow of stacked boxes → VERTICAL. Emit `layout` only if `layout-sim` matches within `TOL_SIM` 0.6 px, with `fallback` always present (D-15). Margins: only the strategies of [07 §4.2](07-mapping.md) that keep exact geometry; others → absolute.

Acceptance: L3 snapshots for `micro-flex--*` (except `wrap` → absolute with `LAYOUT_*` diagnostic) and every ds-react component; T0.5 check: `layout-sim(Scene)` positions equal capture within 0.6 px on all emitted containers.

Hardening: B-111, B-112, B-113.

#### B-50 · `mapper` cross-variant alignment and properties

**Path** `packages/mapper/src/stages/{align,props}` · **Depends** B-48, B-46 · **Runs** container · **Size** L

Build ([07 §13–14](07-mapping.md#alignment)): align every variant's tree on stable `nk` and names; superset trees with hidden placeholders (D-27); `ScenePropertyDef` for VARIANT, BOOLEAN, TEXT with `valueMap`; `propRefs.visible` and `propRefs.characters`; component-level `irh`; `kind: 'component-set'`.

Acceptance: L3 snapshots for Button, Badge, Input, Card sets; invariants (`nk` sets aligned, every `propRefs` key exists); a test that toggling `showIcon` only changes `visible` on `root/icon-leading`.

#### B-51 · `mapper` exact tokens and provenance

**Path** `packages/mapper/src/stages/{tokens,provenance}` · **Depends** B-45, B-50 · **Runs** container · **Size** L

Build:
- **Tokens** ([08 §2–6, §8, §14](08-tokens.md#pipeline)): a `TokensDoc` with one collection "Tokens" and one mode (light/default); variables for every custom property that some bound field uses, with alias chains kept ([08 §5](08-tokens.md#aliases)); names `--a-b` → `a/b`; types; scopes; `codeSyntax.WEB`. `VarRef` with `confidence: 'chain'` only, on fills, strokes, padding, itemSpacing, radius and text fills. `calc()`/`color-mix()` values stay literal with their `TOKEN_*` code. No value matching (D-18).
- **Provenance** ([07 §16.1](07-mapping.md), [15 §5.2](15-change-requests.md#provenance)): `provenance/<sid>.json` with a `FieldOrigin` per emitted field (`css`, `authored`, `selector`, `rule`, `varChain`, `transform`). Excluded from `irh`.

Acceptance: L3 snapshots of `tokens.json` and `provenance/components-button.json`; tests: Button `paddingLeft` binds `space/3` with `transform: 'border-included'` when a border exists; no binding on a non-`var()` value; changing a token value changes no node `irh` ([10 §10.1](10-sync.md#merkle)).

Hardening: B-139 (modes, styles, library matching).

#### B-52 · `cli`: multi-component capture, cache, reports

**Path** `packages/cli` · **Depends** B-13, B-46, B-51 · **Runs** container · **Size** M

Build ([11 §3](11-ux.md), [02 §5.4](02-architecture.md)):
- `capture` with `--only`, `--story`, `--out`, `--storybook <dir|url>`, `--debug-capture`, `--fail-on`, `--concurrency`, `--json`, `--ndjson`; whole-component runs through the planner; per-component isolation (`status: failed` never fails the run).
- The content-addressed capture cache `.holotype/cache/` with the keys of 02 §5.4 (dev-server mode keyed by `baseCommit` + dirty-tree hash, as branch mode requires). Verify and provenance recovery use it.
- `export` from the cache; `report.json`; the human summary table; c12 config loading (`PLAN_CONFIG_*`, `SEC_SECRET_IN_CONFIG`).

Acceptance: `test:e2e`: capture all ds-react components into one bundle; a second run hits the cache for every variant; `--json` snapshot; exit codes 0, 1, 2, 3.

Hardening: B-109 (doctor, report.html), B-123 (`init`, `list`, `serve`).

#### B-53 · Fidelity scoring library and T0

**Path** `tools/fidelity` · **Depends** B-01, B-52 · **Runs** container · **Size** M

Build ([12 §4.1–4.2](12-quality.md#fidelity-harness)): T0 (Capture vs live re-measure; Scene absolute geometry vs Capture); box delta `G(v)`; SSIM (ssim.js) and pixelmatch with text masking (`S_full`, `S_masked`); composite `F(v)`. A library API used by `verify` (B-71) and a dev CLI `holotype-fidelity score --bundle <zip> --figma-export <zip>`.

Acceptance: unit tests with synthetic images (identical → 1.0; a known shift → a known score); T0 runs in CI on every PR for every slice fixture.

Hardening: B-108 (ratchet, dashboard, real-Figma runs).

#### B-54 · `figma-fake` slice surface

**Path** `packages/figma-fake` · **Depends** B-06, B-47 · **Runs** container · **Size** L

Build: every member of [§8.1](#figma-fake) not done in B-06: text metrics and oracle mode, images, SVG → vectors, `exportAsync` placeholder, stack layout via `layout-sim`, components and sets, properties, basic instances, the variables subset, `fileKey`.

Acceptance: contract tests per member and throw rule; `typecheck` against `FigmaPort`.

#### B-55 · Plugin writers: visuals, text, SVG, images

**Path** `packages/plugin/src/apply/write/**` · **Depends** B-14, B-54 · **Runs** container · **Size** L

Build ([09 §6, §6.1, §6.3](09-plugin.md#apply-order)): solid and image fills (`createImage`, a sha → hash map on root), strokes with per-side weights and dash, radii, shadows, opacity, clip; SVG via `createNodeFromSvg` + unwrap + `SVG_IMPORT_FAILED` fallback; the text writer (base font first, characters before ranges, sizing last) and the line-count check with `widthBuffer` ([09 §11.1](09-plugin.md#text-check)). New paint arrays every time; assets pulled once per sha.

Acceptance: L3 snapshots `Scene IR → fake` for every slice fixture; zero fake throws; an order-fuzz test ([09 §18](09-plugin.md#testing)).

#### B-56 · Plugin auto-layout writer, read-back and fallback

**Path** `packages/plugin/src/apply/{write/layout.ts,verify}` · **Depends** B-55, B-49 · **Runs** container · **Size** M

Build ([09 §6](09-plugin.md#apply-order) steps 3–6, [§11](09-plugin.md#verify)): layout mode before padding, size before sizing modes, child properties after attach; read-back per variant; relax HUG/FILL → FIXED, then per-container absolute fallback (`APPLY_LAYOUT_RELAXED`, `APPLY_LAYOUT_FALLBACK`).

Acceptance: fake tests: an injected 2 px layout error triggers relax then fallback on that container only; ancestors unchanged; L3 snapshots for `micro-flex--*` and ds-react.

#### B-57 · Plugin component sets and properties

**Path** `packages/plugin/src/apply/{sets,props}` · **Depends** B-56, B-50 · **Runs** container · **Size** L

Build ([09 §7–8](09-plugin.md#sets)): one `ComponentNode` per variant built in place; `combineAsVariants` on first build; variant names `Prop=Value`; the default variant at row 0, col 0; the variant grid with labels as plain text nodes ([09 §7.4](09-plugin.md#grid)); VARIANT/BOOLEAN/TEXT properties defined on the set and bound in every variant; set plugin data `sid`, `axes`, `props`, `src` ([10 §2.1](10-sync.md#keys)); description and Storybook link. All sets go on page "Components" in one Section named after the title root (D-22 layout is hardening).

Acceptance: fake L3 snapshots for the Button, Badge, Input and Card sets; property ids persisted in `props`; a test that `Show icon` toggles the icon in every variant.

Hardening: B-121 (doc frames, Sections, pages, relaunch).

#### B-58 · Shared normalizer for `ah` and baselines

**Path** `packages/ir/src/normalize.ts`, `packages/plugin/src/apply/readback.ts` · **Depends** B-01, B-54 · **Runs** container · **Size** M

One normalizer for `ah`, the baseline snapshot and the DCR snapshot (D-34, [10 §9.1](10-sync.md#designer-edits), [15 §4.1](15-change-requests.md#extraction)).

Build:
- `readGroups(node)` in plugin main: reads the 7 groups `geom`, `layout`, `paint`, `text`, `vis`, `bind`, `inst` from a node into plain JSON.
- `normalizeGroups(raw) → NodeGroups` in `ir` (pure, isomorphic): floats to 1e-3, colors to 1e-4, canonical JSON, Scene IR vocabulary.
- `ah = concat(fnv1a64 per group)` (D-31).

Acceptance: unit and property tests (idempotent; key order independent); fake test: `ah` after apply equals `ah` recomputed on an untouched node; an edited fill changes only the `paint` sub-hash.

#### B-59 · Plugin identity index and idempotent in-place apply

**Path** `packages/plugin/src/{index,apply/reconcile}` · **Depends** B-57, B-58, B-21 (S-02 report) · **Runs** container · **Size** L

Build ([10 §1–5, §10](10-sync.md#keys)), slice scope:
- Identity index with `findAllWithCriteria` on `nk`, skipping instance sublayers ([10 §3](10-sync.md#index)).
- Keyed in-place reconciliation: reuse managed nodes by `(sid, vk, nk)`, create missing ones, reorder with `insertChild`, update changed properties only; never delete and recreate (D-19, I-1); unmanaged nodes untouched (I-3).
- Merkle skip on `irh` + `ah` + `v`; a no-op re-import makes 0 writes (I-2).
- New variants appended to the existing set (`set.appendChild`, if S-02 confirms; else `APPLY_VARIANT_ADD_FAILED`). Variants gone from code stay in place with a report entry.
- Library mode, designer-edited node that code also changed: keep the designer value and emit `SYNC_CONFLICT` in the report (D-29 default). There is no conflict UI.
- Minimal root data: image map and font map (the chunked registry is hardening).

Acceptance: fake tests for scenarios T-01, T-02, T-03, T-04, T-09, T-12, T-13 (keep only) and T-16 of [10 §12](10-sync.md#test-suite); re-applying the same bundle gives an empty op log.

Hardening: B-125…B-128.

#### B-60 · Plugin variables (exact subset)

**Path** `packages/plugin/src/apply/tokens` · **Depends** B-59, B-51, B-29 (S-12 report) · **Runs** container (tests), needs Figma desktop (via demo D3) · **Size** M

Build ([09 §5.4](09-plugin.md#pipeline), [08 §7.3, §8](08-tokens.md#bindings)): create or reuse the collection and its default mode; variables in alias order (primitives first); values, scopes, `codeSyntax.WEB`; identity `tok` + `ah`; idempotent updates (a token value change writes only the variable, T-03). Bindings through `setBoundVariable` and `setBoundVariableForPaint` (the returned paint is assigned). Refused bindings → `TOKEN_BIND_FAILED`, literal kept.

Acceptance: fake tests: bindings present on Button fills and padding; re-import makes 0 writes; a changed token value writes one variable and no node.

Hardening: B-139.

#### B-61 · Plugin fonts preflight, progress and report

**Path** `packages/plugin/src/{apply/preflight,ui/fonts,ui/progress,ui/report}` · **Depends** B-14 · **Runs** container · **Size** M

Build ([09 §5.1](09-plugin.md#preflight), [§12](09-plugin.md#schedule), [11 §6.5, §6.8, §6.9, §6.11](11-ux.md)): font resolution exact → saved map (root `fontmap`) → Inter fallback, with a simple Fonts screen; time slicing, progress, cancel; the Report tab with diagnostics grouped by code and linked to their docs pages; the import error rows of 11 §6.11.

Acceptance: UI tests for every state of the three screens; fake tests for cancel (variant atomic, `APPLY_CANCELLED`) and font-map reuse.

### 6.2 L2: demo D2/D3 check (needs Figma desktop)

#### B-61b · Demo D2/D3: components, layout and tokens in Figma

**Path** PR description · **Depends** B-60, B-61 · **Runs** container + **needs Figma desktop** · **Size** S

Container: build `ds-react.holotype.zip` with all ds-react components.

User steps:
1. Unzip the new plugin zip over your Holotype folder.
2. In a new file, Holotype ▸ **Import file** ▸ drop `ds-react.holotype.zip`.
3. Check: Button, Badge, Input and Card appear as component sets; select a Button instance and try the Size, Variant, Label and Show icon properties; open the Variables panel and see the tokens.
4. Import the same file again. Reply with the message shown at the end (it should say nothing changed), plus anything that looked wrong.

Acceptance: the second import reports 0 changes; no unexpected diagnostics.

### 6.3 L3: branch file

#### B-62 · `cli` branch commands (file handoff)

**Path** `packages/cli/src/commands/branch/**` · **Depends** B-52 · **Runs** container · **Size** M

Build ([15 §2](15-change-requests.md#branch-model), [11 §3.3](11-ux.md)):
- `holotype branch start [--dev-server <url>] [--only …]`: checks the git branch and working tree (`DCR_BASELINE_DIRTY` if dirty), captures from the dev server, writes `branch.holotype.zip` whose manifest has `source.git` and the `branch` block ([06 §4.2](06-ir.md#branch-block): `repo`, `branch`, `baseCommit`, `dirty`, `dcrConfig`, `configHash`). Ensures `.gitignore` has `.holotype/` and `!.holotype/requests/`.
- `holotype branch link <figma-url> [--kind figma-branch|duplicate]`: stores `{ figmaFileKey, ...BranchMeta }` in `.holotype/branches/<slug>.json`.
- `holotype branch refresh`: re-captures from branch HEAD and writes a new branch bundle.
- `repo` is the normalized remote without credentials ([13](13-security-legal.md#secrets)).

Acceptance: `test:e2e` in a temp git repo created from ds-react: start → bundle manifest snapshot (no credentials, `dirty` correct); link → branch file JSON; refresh after a CSS edit changes only the affected `irh`.

#### B-63 · Plugin proposal mode and embedded baseline

**Path** `packages/plugin/src/{proposal,ui/changes}` · **Depends** B-59, B-60, B-62, B-33 (S-17 report) · **Runs** container (tests), needs Figma desktop (demo D4) · **Size** L

Build ([09 §20.1–20.2](09-plugin.md#proposal), [10 §9.5](10-sync.md#proposal-mode), [15 §3](15-change-requests.md#proposal-mode)):
- Import of a bundle with a `branch` block offers "Import as branch file". It writes root `branch:meta` (`fileKey` from `figma.fileKey` when available, else `null`, plus a random `fileId` at root and in `branch:meta`; `mode: 'proposal'`, `status: 'editing'`; D-53). A mismatch shows the `DCR_BRANCH_FILE_COPIED` banner.
- After read-back and fallback, write `BaselineSnapshot` per variant (and the set's props/axes snapshot): canonical JSON → fflate → base64 → `base:0..n` chunks ≤90 kB, `base:h`; budget 16 kB, over budget → `DCR_BASELINE_EXTERNAL` and the snapshot goes in the downloadable apply report; rewrite only if `base:h` changed.
- Proposal rules: an edited managed node is a proposal (never `SYNC_CONFLICT`); on refresh untouched nodes update and their baseline moves; edited nodes keep the designer value; `DCR_BASELINE_SHIFTED` when code changed underneath.
- At import as branch file, record the existing top-level frames and sections in `branch:meta.baseFrames`.
- **Changes** tab: on request, compare per-group sub-hashes with the baseline; list changed components, components without `sid`, and frames in scope. The default scope is `changed` (D-57): every managed component whose `ah` differs from its baseline, plus every top-level frame or section absent from `branch:meta.baseFrames`; refresh on `nodechange` (debounced 500 ms). States per [11 §6.14](11-ux.md#changes).

Acceptance: fake tests: baseline written once, a second import writes nothing; editing a fill shows one change; library-mode files never get `base:*`; UI tests for the Changes states.

Demo D4 (user, after merge): import `branch.holotype.zip` into a Figma branch (or a duplicated file) as a branch file, change the padding of one Button, open **Changes**, reply with what it lists.

### 6.4 L4: DCR

#### B-64 · DCR schemas

**Path** `packages/dcr/src/schema/**` · **Depends** B-01 · **Runs** container · **Size** M

Build: TypeBox for `FigmaSnapshot`, `SnapNode`, `BaselineSnapshot`, `NodeGroups`, `FieldChange`, `DesignChangeRequest` and all its parts ([15 §3.3, §4.1, §4.3, §6](15-change-requests.md#dcr-ir)); compiled validators; JSON Schema `dcr.v1.json`.

Acceptance: corpus tests including the worked example of [15 §6.1](15-change-requests.md#dcr-ir); schema no-diff check.

#### B-65 · `dcr` core: identify, diff, classify

**Path** `packages/dcr/src/{normalize-plugin,identify,diff,classify,ids}` · **Depends** B-64, B-58, B-47 · **Runs** container · **Size** L

Build ([15 §4.1–4.4, §4.7, §4.9](15-change-requests.md#extraction)):
- `normalizePlugin(raw)` → `FigmaSnapshot` (uses `normalizeGroups` from `ir`).
- Identification per 15 §4.2 (managed sets, variants, derived variants, duplicated `nk`, new components).
- Field diff against the baseline with the noise filter (re-run `layout-sim` on the baseline plus the edited fields; drop derived geometry).
- Items: `component.modified`, `variant.added`, `property.added`, `property.changed`, `component.new`, and `node.added`/`node.removed` inside managed variants. Everything else → `unknown` with `DCR_UNKNOWN_CHANGE`.
- Tokens through `codeSyntax.WEB`; questions `DCR_VALUE_UNTOKENIZED`, `DCR_VALUE_NO_TOKEN`, `DCR_FIELD_UNMAPPABLE`, `DCR_PROPERTY_UNMAPPED`.
- Stable item ids, sorted items, `dcrHash` over the core (excludes `header.generated`, `header.figma.fileVersion`, assets and provenance fields; D-35, D-50). `dcr import` recomputes it after attaching provenance; a plugin↔CLI core-hash parity case is in the goldens.

Acceptance: unit tests per rule; the B-68 golden cases for these kinds; shuffle invariance.

#### B-66 · `dcr` screens usage and new-component structure

**Path** `packages/dcr/src/{screens,reverse,structure}` · **Depends** B-65, B-32 (S-16 report) · **Runs** container · **Size** M

Build ([15 §4.5–4.6, §4.8](15-change-requests.md#extraction)): scope = `changed` by default (D-57, from `branch:meta.baseFrames`), or a page or a selection (`DcrScope`; "Ready for dev" scope needs S-18 and is hardening); the chosen scope is recorded in `lastDcr.scope`; each top-level frame in scope → one `screen` item with one variant; usage trees (`UsageNode`) of instances, frames and text; reverse mapping of instance properties to args for VARIANT, BOOLEAN, TEXT through `valueMap`; `component.new` structure, tokens used, and instances of existing components inside it. Nearest-component scoring: basic structural score only.

Acceptance: golden cases `screen-usage-basic` and `component-new`; reverse mapping round-trip test with the S-16 table.

#### B-67 · `dcr` renderers: prompt, snippet, summary

**Path** `packages/dcr/src/render/**` · **Depends** B-65, B-66 · **Runs** container · **Size** M

Build ([15 §7, §7.3, §7.4, §8, §10.3](15-change-requests.md#prompt)): `renderPrompt` (review summary first, items, rules, the agent contract with `parameters.holotype.implements` and the `holotype verify` command); `renderSnippet` → `jsx-sketch` (D-42); `DcrSummary` headlines; D-38 fencing and escaping, `DCR_NOTE_SUSPICIOUS`.

Acceptance: golden `prompt.md` for every B-68 case; the `injection` case passes; snippets parse as JSX after replacing the pseudo-elements.

After B-67: **paper demo** `holotype dcr --from-fixture fixtures/dcr/modified-padding` prints the prompt (container only).

#### B-68 · `fixtures/dcr` slice cases and the shuffle test

**Path** `fixtures/dcr/**` · **Depends** B-64 · **Runs** container · **Size** M

Cases ([12 §2.4](12-quality.md#dcr-fixtures)), with plugin-snapshot inputs (REST inputs are hardening): `modified-padding`, `variant-added`, `property-added`, `property-renamed`, `component-new`, `screen-usage-basic`, `injection`, and `snippet/*` for the VARIANT/BOOLEAN/TEXT rows. Each runs 3 times (as is and two seeded shuffles); outputs must be byte-identical.

Acceptance: `pnpm -F @holotype/dcr test` runs all cases; a second extraction of an output gives the same `dcrHash`.

#### B-69 · Plugin Submit and request download

**Path** `packages/plugin/src/{proposal/snapshot,ui/submit,ui/preview}` · **Depends** B-63, B-67 · **Runs** container (tests), needs Figma desktop (demo D5) · **Size** L

Build ([09 §20.3](09-plugin.md#proposal), [11 §6.15–6.16](11-ux.md#submit)):
- `snapshot.request` → main reads the scope read-only → snapshot chunks → UI runs `dcr.extract` (the `dcr` package in the UI bundle, see [§11](#plan-gaps)).
- Designer-view preview: summary first, plain-language items, code details behind a toggle; Exclude toggles (`branch:meta.excluded`).
- **Submit** writes the request into the file: root shared plugin data `request:0..n` (gzipped canonical DCR, ≤90 kB chunks) and `branch:meta.lastDcr`, in one `branch.meta.patch { status: 'submitted', lastDcr }` (one undo step). It then saves a named version (`figma.saveVersionHistoryAsync('Holotype request <dcrHash8>')`) and records its id in `lastDcr.versionId` (D-48, D-49).
- Actions after Submit: **Notify developer** (copies a message with the branch URL, the request id and `holotype dcr --pull <figma-url>`) and **Download request**: `request.zip` = `dcr.json`, `prompt.md`, `assets.json`, "after" PNGs @2x (the fidelity export path, [09 §14](09-plugin.md#fidelity)), and the baselines that were over budget. Also **Copy prompt**.
- Without CLI provenance the prompt carries `DCR_PROVENANCE_MISSING`; B-70 adds it.

Acceptance: fake e2e: import branch bundle → simulated edits of the §4.3 demo → Submit → `dcr.json` equals the golden output of the matching fixture; UI tests for empty, loading, error and success; snapshot + extraction ≤2 s for 200 items in the fake.

#### B-70 · `cli` `dcr import` with provenance

**Path** `packages/cli/src/commands/dcr/**` · **Depends** B-52, B-62, B-67 · **Runs** container · **Size** M

Build ([15 §5, §6, §7.1](15-change-requests.md#provenance)): `holotype dcr import <request.zip>` validates the DCR, checks `header.branch` against the current git branch (`DCR_GIT_BRANCH_MISMATCH`; `DCR_NOT_BRANCH_FILE` only when the file has no branch metadata), recomputes the core `dcrHash` (D-50), loads `provenance/<sid>.json` from the cache for `baseCommit`, attaches `CodeRef`, `FieldOrigin`, reverse arithmetic → `cssTarget` (for example Figma padding 17 with a 1 px border → CSS `padding-left: 16px`), adds "before" screenshots from the cache, re-renders `prompt.md`, and writes `.holotype/requests/<id>/`. The same input gives the same bytes. Exit codes per [11 §3.2](11-ux.md).

Stretch (L4/L5, only after the S-18 root-plugin-data check passes): `holotype dcr --pull <figma-url>` reads root shared plugin data (`request:*`, `branch:meta.lastDcr`) and images through REST at `?version=<lastDcr.versionId>`, checks the core hash, then runs the same attach path. Needs a read-only Figma token (`holotype login --figma`; `NET_FIGMA_TOKEN_MISSING` otherwise) and gives `DCR_NO_SUBMITTED_REQUEST` when `lastDcr` is absent. If it does not fit in the slice, it becomes its own hardening item.

Acceptance: `test:e2e`: the `modified-padding` request gets `Button.module.css:<line>`; a field never points to the wrong file on the fixture set; byte-identical output on two runs; a core `dcrHash` mismatch is rejected; a request from another git branch gives `DCR_GIT_BRANCH_MISMATCH`.

### 6.5 L5: verify and the loop

#### B-71 · `holotype verify` v1

**Path** `packages/cli/src/commands/verify/**` · **Depends** B-70, B-53 · **Runs** container · **Size** L

Build ([15 §9.1–9.2](15-change-requests.md#verify)):
- Capture from the dev server at HEAD: the components in `summary.components` plus every story tagged `parameters.holotype.implements` with an item id; map with the same mapper.
- Compare each item to its `acceptance` **in Scene space** through the shared normalizer (D-55): `fields` (with `tol`), `token` (binding must be exactly that variable), variant values, `structure` and fields against the designer's snapshot for `variant.added` and `component.new`, argTypes for `property.*`. `visual` (`S_masked` and box delta from B-53, against the Figma "after" PNG) is **advisory** only. `screen` items are `not-verifiable` unless a story implements them.
- Regression check: non-target variants of each touched component must keep their baseline values, else status `regressed` (`DCR_VERIFY_REGRESSED`).
- Statuses `implemented`, `partial`, `pending`, `regressed`, `not-verifiable`; `--decline <itemId> --reason`; `verify.json`; `DCR_VERIFY_*` codes; exit 0 only if every item is implemented, declined or not-verifiable, else 5.

Acceptance: `test:e2e` in a temp repo from ds-react: with no code change every item is `pending`; after a scripted CSS change for `modified-padding` the item is `implemented`; after a half change it is `partial` with the remaining field; `verify.json` snapshot.

Hardening: B-137 (follow-up DCRs, CI comment).

#### B-72 · Loop demo (demo D6)

**Path** `tools/loop-demo/**`, PR description · **Depends** B-69, B-70, B-71 · **Runs** container + **needs Figma desktop** · **Size** S

Container: `tools/loop-demo/setup.sh` creates a throwaway git repo from `fixtures/ds-react` with `feat/price-tag` checked out and the dev server running.

Steps: the script of [§4.3](#loop-slice), with the user (developer and AI agent) and the boss (designer). The user's agent of choice implements `prompt.md`.

Acceptance (D-40 usability check):
- the designer submits the five changes in ≤15 minutes without help;
- `prompt.md` names the right file:line for every `component.modified` field;
- after the agent's session, `holotype verify` reports `component.modified`, `variant.added` and `property.changed` as implemented;
- every friction point becomes an issue tagged `slice-feedback`, which re-prioritizes the hardening track.

---

<a id="hardening"></a>

## 7. Hardening track

Each row becomes a full item (same fields as above) when dispatched. All are **hardening**. **F** = needs Figma desktop. The "Milestone" column maps back to [14](14-roadmap.md).

### 7.1 H-A Fidelity (→ M1)

| ID | Package / path | Depends | What | Size |
|---|---|---|---|---|
| B-100 | `capture` | B-41 | closed shadow roots (init hook), slots with fallback, nested hosts, adopted sheets, `::part` | M |
| B-101 | `capture`, `mapper`, `plugin` | B-42, B-48, B-22 | gradients (linear, radial, conic, repeating) with the S-03 formulas; masks, blend modes, filters | L |
| B-102 | `capture`, `mapper` | B-41 | transforms → `relativeTransform`; 3D and filters rasterized | M |
| B-103 | `capture`, `mapper` | B-44 | pseudo-elements (`::before`/`::after`/`::marker`), form controls ([05 §5.3](05-capture.md#controls)) | M |
| B-104 | `capture` | B-44 | image transcode and downscale with sharp; canvas, video poster | M |
| B-105 | `capture`, `mapper`, `plugin` | B-43, B-23 | S-04 width-buffer policy; `locked-lines`; CJK, RTL, emoji; variable fonts | L |
| B-106 | `capture`, `mapper` | B-44, B-26 | icon fonts → outlines (S-09); SVG edge cases and rasterize rules | M |
| B-107 | `fixtures/ds-react/src/micro` | B-04 | micro-fixtures batch 2 (~90 stories, [12 §2.2](12-quality.md#fixtures)) | M |
| B-108 | `tools/fidelity`, `tools/harness` | B-53 | ratchet + dashboard ([12 §4.3](12-quality.md#fidelity-harness)); **F** manual real-Figma runs on the user's Mac until a runner is decided | M |
| B-109 | `cli` | B-52 | full `doctor` ([11 §3.4](11-ux.md)), `report.html` | M |
| B-110 | — | B-108 | **F** M1 check: metrics of the Phase 1 exit; fonts usability with the boss | S |

### 7.2 H-B Native structure (→ M2)

| ID | Package / path | Depends | What | Size |
|---|---|---|---|---|
| B-111 | `layout-sim`, `mapper`, `plugin` | B-47, B-49 | wrap | M |
| B-112 | `layout-sim`, `mapper`, `plugin`, `figma-fake` | B-111, B-27 | grid ([07 §5](07-mapping.md), S-10) | L |
| B-113 | `capture`, `mapper` | B-45 | Typed OM keywords; layout probing at several widths ([05 §11](05-capture.md#probing)) | L |
| B-114 | `mapper` | B-48 | simplification ([07 §11](07-mapping.md)) and the full naming chain | M |
| B-115 | `mapper` | B-105 | text sizing, truncation, wrap modes ([07 §8.3–8.5](07-mapping.md)) | M |
| B-116 | `fixtures/real` | B-112 | dogfooding on pinned MUI and shadcn sandboxes; **F** M2 run | M |

### 7.3 H-C Variants at scale (→ M3)

| ID | Package / path | Depends | What | Size |
|---|---|---|---|---|
| B-117 | `planner` | B-46 | render-and-diff classification (D-13, [04 §4](04-variant-model.md#classification)) | L |
| B-118 | `storybook`, `capture`, `planner` | B-117, B-17 | pseudo-states (D-14) and the State axis (D-30); globals and themes discovery | L |
| B-119 | `planner`, `plugin` | B-117, B-25 | matrix strategies, pairwise, render-hash dedupe, budgets from S-06, sets >500 variants | L |
| B-120 | `storybook-addon` | B-01 | typed `parameters.holotype` | S |
| B-121 | `plugin` | B-57 | doc frames, Sections and pages (D-22), relaunch buttons ([09 §9](09-plugin.md#pages)) | M |
| B-122 | `plugin` | B-121 | Library tab and Import config screen ([11 §6.3–6.4](11-ux.md)) | L |
| B-123 | `cli`, `plugin` | B-52, B-20 | `init`, `list --plan`, `serve` with pairing, Host check, streaming, Connect screen (topology A, S-01) | L |
| B-124 | — | B-122, B-123 | **F** M3 usability: first run ≤5 min | S |

### 7.4 H-D Sync UX (→ M4)

| ID | Package / path | Depends | What | Size |
|---|---|---|---|---|
| B-125 | `plugin` | B-59 | apply plan, Diff preview and Conflicts screens, policies `overwrite`/`keep`/`fork` ([10 §8–9](10-sync.md#apply-plan)) | L |
| B-126 | `plugin` | B-59 | locks, renames, deprecation (D-20), chunked root registry, leases | L |
| B-127 | `plugin` | B-59, B-21 | type change snapshot/restore ([10 §5.3](10-sync.md#reconcile)), `nkMigrations`, epochs | M |
| B-128 | `figma-fake`, tests | B-125 | override model per S-02, fault injection, the full L6 suite T-01…T-25; **F** F-layer run | L |
| B-129 | `cli` | B-123 | `serve --watch` | S |

### 7.5 H-E DCR complete (→ M4.5)

| ID | Package / path | Depends | What | Size |
|---|---|---|---|---|
| B-130 | `dcr`, `cli` | B-65, B-34 | REST normalizer + parity fixture (S-18); `holotype dcr <url>`; `login --figma`; "Ready for dev" scope | L |
| B-131 | `dcr` | B-66 | screens: breakpoint × state grouping, interactions, content and a11y ([15 §4.10–4.12](15-change-requests.md#screens)) | L |
| B-132 | `dcr`, `plugin` | B-65, B-31 | `instance.outdated`/`instance.deprecated`, cross-file instances (S-15), `instance.detached`/`deviation` | M |
| B-133 | `dcr`, `cli` | B-67 | `targets` split and prompt parts ([15 §5.5](15-change-requests.md#targets)) | M |
| B-134 | `cli`, `plugin` | B-123, B-69 | `POST /v1/dcr` over the local server; optional approval (D-44) | M |
| B-135 | `cli` | B-70 | MCP `design_changes`, `dcr_item`, `dcr_item_assets`, `list_dcrs` | M |
| B-136 | `vite-plugin`, `capture` | B-19 | JSX locations `data-holotype-loc` | S |
| B-137 | `cli` | B-71 | follow-up DCRs, CI comment, `verify_dcr` | M |
| B-138 | `cli`, `plugin` | B-33 | Figma-native branch automation and merge handling (S-17) | S |

### 7.6 H-F Tokens complete (→ M5) and H-G Compatibility

| ID | Package / path | Depends | What | Size |
|---|---|---|---|---|
| B-139 | `capture`, `mapper`, `plugin` | B-51, B-60, B-29 | modes from themes, text and effect styles, library matching (`codeSyntax.WEB` → name), opt-in value matching, `TOKEN_MODE_LIMIT`, DCR `token.*` items | L |
| B-140 | `storybook` | B-40, B-16 | SB 11 adapter (docgen server, `manifests/components.json`) | M |
| B-141 | `storybook`, CI | B-40, B-16 | SB 8.6 / 9.1 smoke cells (D-11) | S |
| B-142 | `capture`, `planner`, `mapper`, `plugin` | B-18, B-30 | nested instances (D-21), INSTANCE_SWAP, SLOT, Icons page | L |

---

<a id="figma-fake"></a>

## 8. `figma-fake`: the API surface

The fake implements exactly what the applier calls through `FigmaPort` ([09 §4](09-plugin.md#port)), plus the node members those calls return. **Rule for every member:** same name and type as `@figma/plugin-typings@1.142.0`; throw the same error class in the same situations as real Figma ([12 §1.1](12-quality.md#pyramid)); record every write in `ops()`.

### 8.1 Slice surface (B-06, B-54)

| Area | Members | Source |
|---|---|---|
| Global | `createFrame`, `createRectangle`, `createEllipse`, `createText`, `createVector`, `createNodeFromSvg`, `createImage`, `getImageByHash`, `createPage`, `createSection`, `createComponent`, `combineAsVariants`, `getNodeByIdAsync`, `loadFontAsync`, `listAvailableFontsAsync`, `commitUndo`, `notify`, `root`, `currentPage`, `setCurrentPageAsync`, `mixed`, `skipInvisibleInstanceChildren`, `fileKey`, `clientStorage.getAsync/setAsync` | [09 §4](09-plugin.md#port), [§5.1](09-plugin.md#preflight) |
| BaseNode | `id`, `type`, `name`, `parent`, `removed`, `remove()`, `getSharedPluginData`, `setSharedPluginData`, `getSharedPluginDataKeys`, `setRelaunchData` | [10 §2](10-sync.md#keys) |
| Children | `children`, `appendChild`, `insertChild`, `findAllWithCriteria({ types?, sharedPluginData })` | [10 §3](10-sync.md#index) |
| Page | `loadAsync` | [09 §5.2](09-plugin.md#index-stage) |
| Geometry | `x`, `y`, `width`, `height`, `resize`, `resizeWithoutConstraints`, `relativeTransform`, `rotation`, `absoluteTransform`, `absoluteBoundingBox`, `constraints` | [09 §6](09-plugin.md#apply-order), [§11](09-plugin.md#verify) |
| Paint | `fills`, `strokes`, `strokeAlign`, `strokeWeight`, `strokeTopWeight`/`Right`/`Bottom`/`Left`, `dashPattern`, `strokeCap`, `strokeJoin`, `topLeftRadius`…`bottomLeftRadius`, `cornerSmoothing`, `effects`, `opacity`, `blendMode`, `visible`, `clipsContent`, `isMask`, `maskType` | [09 §6](09-plugin.md#apply-order) |
| Text | `fontName`, `characters`, `fontSize`, `setRangeFontName`, `setRangeFontSize`, `setRangeLineHeight`, `setRangeLetterSpacing`, `setRangeFills`, `setRangeTextCase`, `setRangeTextDecoration`, `setRangeHyperlink`, `setRangeBoundVariable`, `getStyledTextSegments`, `textAlignHorizontal`, `textAlignVertical`, `textAutoResize`, `textTruncation`, `maxLines`, `paragraphSpacing`, `paragraphIndent`, `leadingTrim`, `textWrapStyle` | [09 §6.1](09-plugin.md#text) |
| Stack layout | `layoutMode` (`NONE`/`HORIZONTAL`/`VERTICAL`), `paddingTop/Right/Bottom/Left`, `itemSpacing`, `primaryAxisAlignItems`, `counterAxisAlignItems`, `primaryAxisSizingMode`, `counterAxisSizingMode`, `itemReverseZIndex`, `strokesIncludedInLayout`, `layoutSizingHorizontal/Vertical`, `layoutPositioning`, `minWidth`/`maxWidth`/`minHeight`/`maxHeight`; geometry from `layout-sim` | [09 §6](09-plugin.md#apply-order) |
| Components | `ComponentNode.createInstance`, `description`, `documentationLinks`, `key`, `variantProperties`, `getInstancesAsync`; `ComponentSetNode.addComponentProperty`, `editComponentProperty`, `deleteComponentProperty`, `componentPropertyDefinitions`, `defaultVariant`; `componentPropertyReferences` | [09 §7–8](09-plugin.md#sets) |
| Instances (basic) | `getMainComponentAsync`, `setProperties`, `componentProperties`, `swapComponent`; sublayer ids `I<inst>;<child>` that read the main component's plugin data | [10 §2.1](10-sync.md#keys), [15 §4.2](15-change-requests.md#extraction) |
| Variables (subset) | `variables.createVariableCollection`, `createVariable`, `createVariableAlias`, `getLocalVariablesAsync`, `getLocalVariableCollectionsAsync`, `getVariableByIdAsync`, `setBoundVariableForPaint`; `Variable.setValueForMode`, `valuesByMode`, `scopes`, `setVariableCodeSyntax`; collection `modes`, `defaultModeId`; node `setBoundVariable`, `boundVariables` | [09 §4](09-plugin.md#port), [08 §8](08-tokens.md#bindings) |
| Export | `exportAsync({format:'PNG', constraint})` → deterministic placeholder PNG | [09 §14](09-plugin.md#fidelity) |

Throw rules ([09 §6.2](09-plugin.md#apply-order)): `characters` or font fields with an unloaded font; size below 0.01; in-place mutation of a paint, effect or constraints object (frozen); `getNodeById` absent under `dynamic-page`; padding/spacing/alignment without `layoutMode`; FILL without an auto-layout parent; HUG on a non-auto-layout node; `ABSOLUTE` before append; `BASELINE` on a vertical stack; `combineAsVariants` with 0 nodes, mixed pages, or inside an instance; `setBoundVariableForPaint` returns a new paint (the old one is not bound). Behaviour rules: replacing `characters` drops range styles; text `resize()` sets a fixed width; `resize()` on an auto-layout axis forces FIXED; `x`/`y` ignored for non-absolute children.

Text metrics: deterministic advances per font and character class. "Oracle" mode takes the line count from the Scene IR `lines`, to test verification in isolation.

### 8.2 Hardening additions

| For | Members |
|---|---|
| B-111/B-112 | `layoutWrap`, `counterAxisSpacing`, `counterAxisAlignContent`; `GRID` with `gridRowCount`, `gridColumnCount`, `gridRowSizes`, `gridColumnSizes`, `gridRowGap`, `gridColumnGap`, `setGridChildPosition`; rules: `WRAP` on GRID throws, FLEX track on a HUG axis throws |
| B-125…B-128 | `overrides` and an override model following the S-02 matrix; `clone()` (fork policy); fault injection at the Nth write; conformance replay of op logs recorded in real Figma ([12 §4.4](12-quality.md#harness)) |
| B-130…B-132 | `annotations`, `figma.annotations.getAnnotationCategoriesAsync`, `devStatus` (if S-18 shows it is writable), `reactions`, `detachedInfo` |
| B-139 | modes (`addMode`, `setExplicitVariableModeForCollection`), styles APIs, `teamLibrary.*`, `importVariableByKeyAsync` |
| B-142 | `createSlot`, SLOT and INSTANCE_SWAP property values, `importComponentByKeyAsync` |

---

<a id="spike-kit"></a>

## 9. Figma spike kit

<a id="spike-kit-arch"></a>

### 9.1 How the kit works

- **One plugin for all spikes.** `spikes/runner` builds "Holotype Spikes", a separate development plugin with its **own** manifest `id`. It must not reuse the product plugin's id, which is fixed forever and keys `clientStorage` ([02 §6.4](02-architecture.md#monorepo)).
- **Spikes are modules.** Each lives in `spikes/S-xx/`: `plugin.ts` (runs in Figma), an optional `refs.ts` (reference data rendered in Chromium, in the container), and `README.md` (the user card below). The runner lists them; each step is a button.
- **References are bundled.** Chromium screenshots, rects and line breaks are generated in the container and bundled into the spike UI. The plugin compares in the UI iframe (canvas, SSIM, pixel diff), so only small numbers come back.
- **Results.** Each step ends on **Done** with **Copy results**. The JSON envelope is `{ spike, kitVersion, step, env: { apiVersion, client, os }, results }`. It never contains the user's name, email or file names. Results over 30 kB split into numbered parts ("Copy part 1 of 3"). Fallback: **Save results file** and upload it to `spikes/results/` through the GitHub web page (Add file ▸ Upload files).
- **Multi-step spikes** keep their state in `clientStorage`, so the user can close Figma between steps.
- **Two shared test files** serve the library spikes (S-02, S-12, S-15): "Spikes Library" and "Spikes Consumer".
- **Dry run.** Every spike runs against `figma-fake` in CI (unsupported calls go through a recording proxy).
- **Analysis.** When results arrive, a container agent writes `docs/spikes/S-xx.md`, ending with a proposed README §5 update.

### 9.2 One-time setup (user)

1. Download `holotype-spikes-<version>.zip` from the link I send. Unzip it to a folder that stays put, e.g. `Holotype/spikes`.
2. Open the Figma desktop app and create a new design file named **Spikes Scratch**.
3. Menu **Plugins ▸ Development ▸ Import plugin from manifest…** and pick `manifest.json` in that folder.
4. To run a spike: **Plugins ▸ Development ▸ Holotype Spikes**, click the spike, then its step button. Wait for **Done**, click **Copy results**, and paste here.

When I send a new kit version, unzip it over the same folder. No re-import is needed.

### 9.3 Which spikes need Figma, and what they gate

From [14 Phase 0](14-roadmap.md#phase-0). The brief's list missed S-03, S-04, S-09, S-11 and S-13: they also need Figma.

| Spike | Needs Figma | Gates | Who | User time |
|---|---|---|---|---|
| S-02 | desktop, library publish | **slice** (B-59: in-place apply, appending variants) | user or boss | 40 min |
| S-05 | desktop + a designer's opinion | **slice** (B-48 borders, DCR padding arithmetic) | boss | 10 min |
| S-06 (step 1) | desktop | **slice** (`setTimeout`, `crypto.subtle`, `postMessage` size, `figma.fileKey`, blob download from the UI) | either | 2 min |
| S-12 | desktop, library publish | **slice** (B-60 bindings) | user | 20 min |
| S-16 | desktop | **slice** (B-66 reverse mapping) | either | 10 min |
| S-17 | desktop, Organization account | **slice** (B-63: plugin data in branches; else duplicated-file fallback) | user | 20 min |
| S-07, S-19 | no | **slice** | agent | — |
| S-01 | desktop + browsers | hardening (B-123 local server) | user (needs Node) | 30 min |
| S-03 | desktop | hardening (B-101) | either | 5 min |
| S-04 | desktop | hardening (B-105) | either | 10 min |
| S-06 (step 2) | desktop | hardening (B-119 scale) | either | 20 min, mostly waiting |
| S-09 | desktop | hardening (B-106) | either | 5 min |
| S-10 | desktop | hardening (B-112) | either | 5 min |
| S-11 | Figma account via the remote MCP connector | hardening (harness) | user connects; agent runs | 5 min |
| S-13 | desktop (plugin half) | hardening (B-142) | either | 5 min |
| S-15 | desktop, library + branch | hardening (B-132) | user | 20 min |
| S-18 | desktop + a Figma token | hardening (B-130) | user | 15 min |
| S-08 | no | hardening | agent | — |

Each card below is a work item. **Build** runs in the container (`spikes/S-xx`, depends on B-08). **Run** needs Figma desktop. The track of each card follows the table above.

### 9.4 Slice-gating spike cards

#### B-21 · S-02 Override preservation — slice

- **Question:** which in-place mutations of a main component keep instance overrides, in the same file and through a library update ([10 §11.1](10-sync.md#overrides)).
- **Build (L):** step 1 builds 19 main components (one per mutation row) with 15 child types and 13 instances each (one per override kind). Step 3 applies the 19 mutations. Steps 2 and 4 read overrides back and grade each cell kept / lost / partial. Component keys are kept in `clientStorage`.
- **User steps:**
  1. In the file **Spikes Library**, run **S-02 ▸ Step 1 (build)**.
  2. Publish the library: **Assets ▸ Libraries ▸ Publish**.
  3. In **Spikes Consumer**, switch on the library (**Assets ▸ Libraries**), then run **S-02 ▸ Step 2 (place instances)**.
  4. In **Spikes Library**, run **S-02 ▸ Step 3 (mutate)**. Copy results and paste (the same-file matrix). Publish again.
  5. In **Spikes Consumer**, accept the update ("Updates available" ▸ **Update all**), then run **S-02 ▸ Step 4 (read)**. Paste.
- **Paste back:** two results blocks. Output becomes `docs/research/s02-override-matrix.md`.

#### B-24 · S-05 Border model — slice

- **Question:** keep D-16 (INSIDE stroke, padding + border, `strokesIncludedInLayout:false`) or flip it.
- **Build (S):** refs for uniform, per-side widths and colors, dashed, outline. The plugin builds model A (`false`) and model B (`true`) side by side, in and out of auto layout, reads child positions and scores pixels.
- **User steps (boss, as a designer):**
  1. Run **S-05 ▸ Run** in **Spikes Scratch**. Paste results.
  2. On the new page, frames are labelled A and B. Change the stroke width of each to 3. Reply "A felt right", "B felt right" or "both fine", and one sentence why.

#### B-25 · S-06 Plugin environment and performance — step 1 slice, step 2 hardening

- **Question:** step 1: is `setTimeout` available in main; is `crypto.subtle` available in main (D-31); the practical `postMessage` size; does `figma.fileKey` work with `enablePrivatePluginApi`; can the UI download a blob file. Step 2: build time for 1k and 5k variants, `combineAsVariants` cost, property binding cost, memory over repeated applies, slice length, `exportAsync` throughput, `documentationLinks`/`descriptionMarkdown` writability.
- **Build (M):** step 1 is a set of quick checks; step 2 uses a synthetic Scene IR generator and a UI heartbeat that measures editor stalls.
- **User steps:** in a new empty file, run **S-06 ▸ Step 1 (quick checks)**. It downloads a small test file: say whether a download appeared. Paste results. Later, run **Step 2 (performance)**, don't use Figma while it runs (about 15 minutes), then reply "Figma froze: yes/no" and paste.

#### B-29 · S-12 Variables — slice

- **Question:** bindable fields in practice, explicit modes, the mode limit, `codeSyntax.WEB` matching, `importVariableByKeyAsync`, aliases across collections (D-18).
- **Build (M):** step 1 creates collections, modes (until Figma refuses, to find the limit), variables with `codeSyntax.WEB`, and binds every field of [08 §8](08-tokens.md#bindings). Step 2 (consumer) lists library collections and imports by key.
- **User steps:**
  1. In **Spikes Library**, run **S-12 ▸ Step 1**. Paste. Publish the library (variables included).
  2. In **Spikes Consumer**, run **S-12 ▸ Step 2**. Paste.
  3. Optional: on a Starter or Professional account, repeat step 1 and paste.

#### B-32 · S-16 Instance properties → args — slice

- **Question:** does instance properties → args → re-render → same instance hold for VARIANT, BOOLEAN, TEXT (slice) and INSTANCE_SWAP, SLOT (hardening) ([15 §4.5](15-change-requests.md#extraction)).
- **Build (M):** the plugin builds a Button-like set with a `valueMap` in plugin data, makes 20 instances with different values and overrides, and reverse-maps them to args. The container part re-renders those args from ds-react and compares.
- **User steps:** run **S-16 ▸ Run** in **Spikes Scratch**. Paste.

#### B-33 · S-17 Branches and plugin data — slice

- **Question:** can a branch be created without the UI; do branches carry shared plugin data on creation, on update from main, and on merge (D-32, [10 §9.5](10-sync.md#proposal-mode)). If plugin data does not survive, the slice uses duplicated files (D-32 fallback).
- **Build (S):** five small steps that write and read markers on the root and on a component, including a 90 kB chunk like `base:*`. The agent separately checks REST and the Figma MCP tool list for a creation path.
- **User steps:**
  1. In **Spikes Library**, run **S-17 ▸ Step 1**.
  2. File menu ▸ **Create branch…**, name it `spike-s17`. In the branch, run **Step 2**.
  3. Back in the main file, run **Step 3**.
  4. In the branch, accept **Update from main** when offered, then run **Step 4**.
  5. Merge the branch (**Review and merge**; test only, to learn what happens if someone merges; Holotype never merges, D-47). In the main file, run **Step 5**. Copy results and paste (all steps are in one block).

### 9.5 Hardening spike cards

#### B-20 · S-01 Local network access (desktop and browsers)

- **Question:** can the plugin UI reach `127.0.0.1` by fetch and WebSocket in each client; do the fixed manifest ports work; does the PNA header matter (D-25, D-10).
- **Build (M):** `s01-server.mjs`, one bundled file that needs only Node: ports 47321–47323, `ACAO:*`, routes with and without `Access-Control-Allow-Private-Network`, WS, and a request log. The plugin probes fetch GET/POST with an `Authorization` header, WS, SSE and long-poll on `127.0.0.1` and `localhost`, on each listed port and on unlisted 47324 (expected CSP block).
- **User steps:**
  1. Open Terminal (Mac) or PowerShell (Windows) in the kit folder and paste `node s01-server.mjs`. Leave it open.
  2. In Figma desktop, run **S-01 ▸ Probe**. Paste results.
  3. Stop the server (Ctrl+C), run **Probe** again. Paste.
  4. Paste the lines the server printed.
  5. Optional: open the file in Chrome, Edge, Safari and Firefox. If **Plugins ▸ Development** lists Holotype Spikes, run **Probe** and paste; if not, reply "not listed in <browser>" (also a result). Browser rows may later need a private organization publish of the kit; I'll send steps if so.

#### B-22 · S-03 Gradients, shadows, blurs

- **Build (M):** ≈60 Chromium reference cases; the plugin builds each with candidate formulas (for example blur ×1 and ×2), exports PNG @2x and scores them in the UI.
- **User steps:** run **S-03 ▸ Run** in **Spikes Scratch**. Paste.

#### B-23 · S-04 Text parity

- **Build (M):** 300 paragraphs (Inter, Roboto, Noto Sans JP, Roboto Flex as the variable font) across widths and sizes, with Chromium line counts, line boxes and breaks. The plugin builds fixed-width text, reads the line count, and searches the smallest extra width that restores it; breaks compared on a 50-paragraph subset.
- **User steps:** run **S-04 ▸ Run**. If Figma reports missing fonts, click **Done** in the plugin anyway; it records them. Paste (likely in parts). The SF/system row needs Chromium on a Mac and is optional.

#### B-26 · S-09 SVG import

- **Build (M):** an SVG corpus from Lucide (ISC), Heroicons (MIT), Material Symbols (Apache-2.0) and the ds-react icons, with Chromium refs. The icon-font outline prototype (fontkit) is container-only, in the same PR.
- **User steps:** run **S-09 ▸ Run**. Paste.

#### B-27 · S-10 Grid auto layout

- **Build (M):** refs for grid micro-cases; the plugin builds them with `layoutMode:'GRID'` and `setGridChildPosition`, records which combinations throw, and compares child rects. Calibrates `layout-sim` grid (B-112).
- **User steps:** run **S-10 ▸ Run**. Paste.

#### B-28 · S-11 `use_figma` feasibility

- **Build (S):** a `plugin/dist/applier.mjs` prototype on 10 fixtures and a Node driver ([09 §16](09-plugin.md#use-figma)).
- **User steps:** connect the Figma connector to this Claude session (Settings ▸ Connectors ▸ Figma), create an empty file named **Spikes MCP**, and paste its link. I run the rest.

#### B-30 · S-13 Slots and instance-swap (plugin half)

- **Build (S):** SLOT property creation and binding; `preferredValues` with local component keys; INSTANCE_SWAP default by node id ([09 §8.1](09-plugin.md#props)).
- **User steps:** run **S-13 ▸ Run**. Paste.

#### B-31 · S-15 Cross-file instances

- **Build (M):** step 1 builds components with `holotype` plugin data; step 2 places and detaches instances and reads remote data; step 3 changes the library; step 4 reads after the update ([15 §4.13](15-change-requests.md#instance-versions)).
- **User steps:**
  1. **Spikes Library**: run **S-15 ▸ Step 1**, then publish.
  2. **Spikes Consumer**: run **Step 2**. Paste.
  3. **Spikes Library**: run **Step 3**, then publish.
  4. **Spikes Consumer**: run **Step 4** *before* accepting the update. Paste. Accept the update, run **Step 4** again. Paste.
  5. Paste the link of **Spikes Consumer**. I'll ask for a read-only Figma token through the secure form (never paste a token in chat).

#### B-34 · S-18 REST vs plugin snapshot

- **Build (M):** step 1 builds a page with groups, component properties, instances with overrides, bound variables, annotations with categories, prototype reactions (including `CHANGE_TO`), Sections, root and node plugin data, and tries to set `devStatus`. Step 2 outputs a per-node, per-field digest; the agent computes the same digest from REST with the same code.
- **User steps:**
  1. In a new file **Spikes REST**, run **S-18 ▸ Step 1**. If it says "could not mark Ready for dev", select the frame **Screen** and click **Mark as ready for dev** in the right panel.
  2. Run **Step 2**. Paste.
  3. Paste the file link. I'll ask for a read-only Figma token through the secure form.

---

<a id="ordering"></a>

## 10. Merge and ordering plan

### 10.1 Waves

Items in one wave touch different paths and can run in parallel worktrees. Hardening items may fill idle agents at any time **after** the slice item they extend is merged, but slice items always get dispatched first.

| Wave | Week (target) | Items | Starts when |
|---|---|---|---|
| 0 | 0 | B-00 (in progress) | now |
| 1 | 1 | B-01, B-02, B-03, B-06, B-07, B-08 | B-00 merged |
| 2 | 1–2 | B-04, B-09, B-10, B-12, B-47; **slice spike kits** B-21, B-24, B-25, B-29, B-32, B-33 | B-01, B-03, B-08 |
| 3 | 2–3 | B-11, B-14, B-16, B-64, B-68 | B-10 (B-11), B-06 + B-07 (B-14), B-01 (B-64) |
| 4 | 3–4 | B-13, B-19, B-54 | B-11 + B-12; B-06 + B-47 |
| 5 | 4 | **B-15 (D1)** | B-04, B-13, B-14 |
| 6 | 4–6 | B-40, B-41, B-55, B-58, B-61 | B-15 |
| 7 | 6–8 | B-42, B-43, B-44, B-45, B-46, B-48, B-65 | B-41 (capture), B-40 (planner), B-58 (dcr core) |
| 8 | 8–10 | B-49, B-50, B-52, B-53, B-56, B-66, B-67 | B-47 + B-48; B-46; B-65 |
| 9 | 10–12 | B-51, B-57, B-59, B-60, **B-61b (D2/D3)**; paper DCR demo | B-45 + B-50; B-56; S-02/S-12 reports |
| 10 | 12–14 | B-62, **B-63 (D4)** | B-52; B-59 + B-60 + S-17 report |
| 11 | 14–17 | B-69, B-70 **(D5)** | B-63, B-67 |
| 12 | 17–19 | B-71, then **B-72 (D6)** | B-70, B-53 |
| — | 2 onward | hardening spike kits B-20, B-22, B-23, B-26, B-27, B-28, B-30, B-31, B-34; container spikes B-17, B-18 | idle agents; user time permitting |

The `dcr` package (B-64…B-68) is pure and works from hand-built fixtures, so it runs **in parallel** with capture, mapper and plugin work from week 3. It joins the main chain only at B-69.

**Send the slice spikes first.** User time, not agent time, is the scarce resource. Batch A (week 2): S-02, S-05, S-06 step 1, S-12, S-16, S-17. Batch B (any time after): the rest. The [14](14-roadmap.md) M0 criterion "all 18 spike reports" becomes a hardening milestone; the slice does not wait for batch B.

### 10.2 Critical path to the loop demo

```
B-00 → B-01 → B-10 → B-11 → B-41 → B-48 → B-49 → B-50 → B-57 → B-59 → B-63 → B-69 → B-70 → B-71 → B-72
                                ↘ B-45 → B-51 ↗ (tokens + provenance join at B-57/B-60 and B-70)
side chains that must land in time:  B-47 (layout-sim) → B-49;  B-58 (normalizer) → B-59, B-63, B-65;
                                     B-64 → B-65 → B-66 → B-67 → B-69;  S-02 → B-59;  S-17 → B-63
```

- **Longest chain:** capture → mapper (core, layout, alignment) → plugin sets → identity and in-place apply → proposal mode → Submit → `dcr import` → verify. About 15 items in sequence; with about three parallel agents, weeks 0–19.
- **User-time risks on the path:** the S-02 report (before B-59, week ~10), the S-17 report (before B-63, week ~12; the duplicated-file fallback removes this risk), and the D6 session itself.
- **Scope valves if the slice slips:** drop `component.new` and `screen` from the first D6 run (keep `component.modified`, `variant.added`, `property.changed`); keep tokens to colors and spacing only.

### 10.3 Demos

| Demo | When | Needs | Shows |
|---|---|---|---|
| **D1** | week 4 (B-15) | B-10…B-14 | the first visible demo: a Storybook story as frames and text in Figma |
| **D2/D3** | week 12 (B-61b) | B-57, B-59, B-60 | component sets with properties, auto layout, bound variables; re-import = 0 writes |
| **Paper DCR** | week ~13 (after B-67) | B-64…B-68 | `prompt.md` from a fixture, no Figma |
| **D4** | week 14 (B-63) | B-62, B-63 | a designer edit listed in the Changes tab of a branch file |
| **D5** | week 17 (B-69, B-70) | + `dcr` | the first DCR from real Figma edits, with file:line provenance |
| **D6** | week 19–20 (B-72) | + B-71 | the whole loop with a real AI agent and `holotype verify` |

---

<a id="plan-gaps"></a>

## 11. Plan gaps and choices made here

These gaps are resolved in the plan by the 2026-11 review ([REVIEW](REVIEW.md)); the choices below match the plan except where REVIEW notes otherwise (rows 12, 18: kept as chosen here).

Inconsistencies between chapters (or with the brief) that the build hits. The right column applies until the plan is fixed. Line numbers are as of 2026-11-19.

| # | Gap | Where | Choice in this file |
|---|---|---|---|
| 1 | The roadmap puts tokens in Phase 5, the DCR in Phase 4.5 and `holotype verify` in Phase 7; the product review wants the full loop first | 14-roadmap.md:16-28, 143-156, 198-210; README.md:259-270 | The Loop slice ([§4](#loop-slice)) pulls a tokens subset, the DCR core and verify v1 forward. 14 and README §8 should be re-sequenced to match |
| 2 | Fixture path: `fixtures/react-sb/` vs `fixtures/` and `fixtures/micro/` | 02-architecture.md:432; 12-quality.md:47, 69 | `fixtures/ds-react/`, micro stories in `fixtures/ds-react/src/micro/` |
| 3 | Packages `dcr` and `vite-plugin` are in README §6 but missing from the monorepo tree, the API table and the dependency rules | 02-architecture.md:411-467 | Add both in B-00; `dcr` may import `ir`, `shared`, `layout-sim` |
| 4 | The plugin may bundle only `ir`, `shared`, `layout-sim`, but the plugin UI runs `dcr.extract` | 02-architecture.md:464; 09-plugin.md:883; 15-change-requests.md:175 | Allow `dcr` in the plugin **UI** bundle only |
| 5 | "Same normalizer as `ah`" is required for baselines and DCR snapshots, but no package owns it | 10-sync.md:423-439; 09-plugin.md:864; 15-change-requests.md:194 | `normalizeGroups()` in `ir` (pure); node reading stays in the plugin (B-58) |
| 6 | The mapper takes `VariantPlan` (planner) and `ComponentMetaInput` (storybook) but may import neither | 07-mapping.md:17-26; 02-architecture.md:460 | Put these types in `ir/pipeline.ts` (B-01) |
| 7 | `HolotypeParams` has `additionalProperties:false` and no `implements`, yet D-37 requires `parameters.holotype.implements`; `replacedBy` is also referenced | 04-variant-model.md:414-490; 15-change-requests.md:997; 12-quality.md:567 | Add `implements?` and `replacedBy?` in B-01 (D-37 wins) |
| 8 | `branch:meta.fileKey` needs `figma.fileKey`, which requires `enablePrivatePluginApi` in the manifest; the manifest in 09 does not set it | 09-plugin.md:49-72; 15-change-requests.md:78 | Set `enablePrivatePluginApi: true` (B-07); S-06 step 1 confirms |
| 9 | Applier field names differ from 06 (`s.w`, `s.x`, `s.transform`, `s.bindings`, `s.clip`, `layout.grid.rows`, `counterSpacing`, `primaryAlign`, `padding` as array, text `runs`/`size`) | 09-plugin.md:313-361, 371-397 | Use 06 names |
| 10 | Capture IR names in the fill contract differ from 06 (`meta`, `styles`, `customProps`, `screenshot`, `CaptureNode`, `fxId` vs `target`, `textStyles`, `customProperties`, `CNode`) | 05-capture.md:593-611; 06-ir.md:60-87 | 06 wins |
| 11 | Two manifest shapes: 02 has `integrity` and `sceneHash`; 06 has neither; 09 checks `manifest.components[sid].sha256` and `manifest.irVersion` | 02-architecture.md:333-346; 06-ir.md:611-631; 09-plugin.md:151, 235 | 06 shape plus `integrity` and an optional `branch` block (B-01); the plugin checks `integrity.files` and `sceneVersion` |
| 12 | Two `report.json` shapes (`BundleReport` vs `RunReport`) | 06-ir.md:679-689; 12-quality.md:578-596 | 06 `BundleReport` now; reconcile before the GitHub Action |
| 13 | Canonical rounding: 1/1000 px vs 1/256 px | 06-ir.md:705; 12-quality.md:40 | 1/1000 (06) |
| 14 | Pairing: 6-digit code + `/v1/pair/start\|confirm` + WS `/v1/ws`, vs 6-word code + `POST /v1/pair` + `/v1/events?token=`, vs `XXX-XXX` | 02-architecture.md:187-200, 211; 09-plugin.md:180-181; 11-ux.md:394 | 02 (protocol owner); matters from B-123 |
| 15 | Exit codes: `4` = internal error vs `4` = browser failure, plus `5`/`6`/`130` | 02-architecture.md:625-630; 11-ux.md:154-168 | 11 (the fuller table) |
| 16 | `ah`: "h16" vs FNV-1a-64; 7 groups listed but 6 sub-hashes concatenated (`inst` missing) | 10-sync.md:95, 423, 439; 06-ir.md:719; README D-31 | FNV-1a-64 per group, 7 sub-hashes including `inst` |
| 17 | Variant and component `irh` formulas differ | 06-ir.md:729-730; 10-sync.md:489-491 | 06 |
| 18 | Capture cache: `.json.zst` + `cas/` vs `.json.gz` + `assets/`; two capture-key definitions | 05-capture.md:30; 02-architecture.md:385-401; 06-ir.md:727 | 02 (B-52) |
| 19 | `@holotype/vite-plugin` is Phase 4.5 in 14 but Phase 7 in 15 | 14-roadmap.md:153; 15-change-requests.md:1145 | Hardening (B-136); the slice uses CSS-rule provenance only |
| 20 | S-17 runs "on Pro and Organization plans" vs "on the user's Organization account" | 15-change-requests.md:1155; 14-roadmap.md:67 | Organization only (B-33) |
| 21 | The spike runner sits inside the product plugin, whose manifest id is fixed forever | 14-roadmap.md:44; 02-architecture.md:530 | A separate "Holotype Spikes" plugin (B-08) |
| 22 | Real-Figma fidelity assumes a self-hosted macOS runner with a bot account; D-39 describes a two-person private setup | 12-quality.md:176; README D-39 | Manual runs on the user's Mac (B-108) until a runner is decided |
| 23 | Spikes that need Figma: the brief listed 10; 14 implies 15 (also S-03, S-04, S-09, S-11, S-13 plugin half) | 14-roadmap.md:52-69 | Kits for all 15 ([§9](#spike-kit)) |
| 24 | Dev plugins load from local files, so S-01's browser rows may need a private organization publish | 02-architecture.md:567; 14-roadmap.md:52 | Desktop first; browser rows optional (B-20) |
| 25 | D-10 lists the local server (topology A) as MVP; the slice uses files only for the Figma ↔ CLI handoff (bundle in, `request.zip` out) | README D-10; 02-architecture.md:203 | Topology B in the slice; A and `POST /v1/dcr` in hardening (B-123, B-134) |
