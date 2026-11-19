# BUILD: executable build plan (Phase 0 → Phase 4.5)

> **Status:** v0.1 (2026-11-19). Companion to the master plan ([README](README.md)). It does not change any decision. Where it must pick between two chapters that disagree, it says so in [§10](#plan-gaps).
>
> **Reader:** a coordinator that dispatches coding subagents, one work item at a time, often in parallel git worktrees. Every item names its paths, its dependencies, what to build, how it is accepted, and where it runs.

---

## Contents

1. [How to use this file](#how-to-use)
2. [Conventions](#conventions)
3. [Definition of done](#dod)
4. [Phase 0 work items](#phase-0-items)
5. [`figma-fake`: the API surface](#figma-fake)
6. [Figma spike kit](#spike-kit)
7. [Phase 1 work items](#phase-1-items)
8. [Phases 2 to 4.5: outline](#later-phases)
9. [Merge and ordering plan](#ordering)
10. [Plan gaps and choices made here](#plan-gaps)

---

<a id="how-to-use"></a>

## 1. How to use this file

1. Pick the next item whose **Depends** are all merged ([§9](#ordering) lists the waves).
2. Create a worktree and branch: `git worktree add ../wt/B-xx -b build/B-xx-<slug>`.
3. Give the subagent: the item text, the linked plan sections, [§2](#conventions) and [§3](#dod).
4. The subagent opens one PR per item, titled `B-xx: <title>`. The coordinator merges in wave order.
5. Items marked **needs Figma desktop** end with a step for the user. The coordinator sends the user the short instructions from [§6](#spike-kit) and waits for the pasted result.

---

<a id="conventions"></a>

## 2. Conventions

### 2.1 Labels

| Label | Meaning |
|---|---|
| **container** | Runs fully in the agent container: Linux, Node 22, pnpm, Playwright with headless Chromium preinstalled. No Figma |
| **needs Figma desktop** | The user (or their boss) must run something in the Figma desktop app and paste a result back |
| **S** | ≤300 changed lines, one agent session |
| **M** | 300–1,000 lines, one or two sessions |
| **L** | 1,000–2,500 lines, two or three sessions. Split into sub-PRs if it grows |
| **XL** | Not allowed. Split before dispatch |

Sizes are for dispatch planning. They are not the engineer-week estimates of [14](14-roadmap.md).

### 2.2 Commands

B-00 provides these root scripts. Every acceptance line below uses them.

| Command | Does |
|---|---|
| `pnpm i --frozen-lockfile` | install |
| `pnpm turbo run lint typecheck test build` | the PR gate (L0 + L1 + L2 + L3, [12 §1](12-quality.md#pyramid)) |
| `pnpm -F <pkg> test` | one package's Vitest suite |
| `pnpm -F <pkg> test:e2e` | one package's Playwright suite (Chromium) |
| `pnpm depcruise` | package boundary rules ([02 §6.2](02-architecture.md#monorepo)) |
| `pnpm -F @holotype/ir schema && git diff --exit-code packages/ir/schema` | committed JSON Schema check |
| `pnpm diag:check` | every used diagnostic code is registered and documented (B-02) |
| `pnpm size` | plugin bundle budgets: main ≤400 KB, UI ≤600 KB (D-04) |

### 2.3 Shared files and conflict rules

Parallel worktrees conflict on a few shared files. These rules keep merges mechanical.

| Hot file | Owner | Rule for everyone else |
|---|---|---|
| `pnpm-lock.yaml`, root `package.json` | none | On rebase, run `pnpm install` and commit the new lockfile. Never hand-merge it |
| `.github/workflows/*` | B-00, then B-09 | Other items do not edit workflows. They ask B-09 (or a follow-up CI item) for new jobs |
| `packages/ir/src/**` (schemas) | B-01 | After B-01, schema changes are their own small PR (`ir: <change>`), one at a time, merged before the item that needs them |
| `packages/shared/src/diagnostics/**` | B-02 | Codes come from [12 §6.2](12-quality.md#diagnostics). A missing code is added to 12 first, then `pnpm diag:gen` regenerates the registry. Never edit the generated file by hand |
| `packages/capture/src/page/collectors/index.ts` | B-11 | One import line per collector. Append only |
| `packages/mapper/src/stages/index.ts` | B-12 | One line per stage, in [07 §1](07-mapping.md) order. Append only |
| `packages/plugin/src/apply/write/index.ts` | B-14 | One line per writer. Append only |
| `packages/plugin/src/port.ts` | B-06 | Additive only. Each later fake item adds the `Pick<>` members it needs |
| `fixtures/ds-react/src/**` | B-03 | New stories go in new files. Do not rename story ids: tests depend on them |

### 2.4 Source of truth for shapes

Types come from [06](06-ir.md) (via `@holotype/ir`). If another chapter shows a different field name for the same thing, use 06 and record the gap in the PR description. [§10](#plan-gaps) lists the known ones.

---

<a id="dod"></a>

## 3. Definition of done

Every item meets all of these before merge. They implement D-40 (quality bar) and [12](12-quality.md).

### 3.1 All items

1. **Gate green.** `pnpm turbo run lint typecheck test build` and `pnpm depcruise` pass. TypeScript is strict, ESM only (D-03).
2. **Tests match the pyramid.** The package has the L1/L2/L3 tests that [12 §1.1](12-quality.md#pyramid) lists for it, for the code this item adds. Every public function has a test.
3. **Diagnostics.** Every code the item emits is registered, has a docs page with a plain-language message and a remedy, and is triggered by at least one test (`pnpm diag:check`).
4. **Determinism.** Snapshot tests give the same bytes on two runs. Pure packages (`ir`, `shared`, `layout-sim`, `mapper`, `dcr`) read no clock, no random source and no environment (lint rule from B-00).
5. **Boundaries.** No new dependency outside [02 §6.2](02-architecture.md#monorepo). Isomorphic packages pass the browser-bundle check.
6. **Docs.** The package README lists the public API added. A changeset is included for publishable packages.
7. **No secrets, no outside network** in tests. Tests talk only to `127.0.0.1`.
8. **Acceptance.** Every command in the item's **Acceptance** list passes in CI, or on the user's machine for Figma steps.

### 3.2 Extra rules by item type

| Type | Extra rule |
|---|---|
| **User-facing flow** (plugin screen, CLI command) | Implements the empty, loading, error and success states from [11](11-ux.md). Plugin screens: one UI test per state (`pnpm -F @holotype/plugin test:ui`). CLI: a `--json` output snapshot and an exit-code test. Copy follows [11 §6.12](11-ux.md#plugin); keyboard and contrast follow §6.13 |
| **Page code** (capture serializer) | Size of the built IIFE ≤150 kB ([05 §2.1](05-capture.md#injection)); no imports outside `src/page/**` plus `ir` types |
| **Plugin main** | No `figma` global outside `src/main.ts` (Biome rule); all writes through `FigmaPort`; async APIs only (D-06) |
| **Fixture** | Story ids are listed in the item and checked by a snapshot of the built `index.json` |
| **Spike kit** | Dry-runs against `figma-fake` in CI. Instructions for the user fit on one screen. Results JSON carries no personal data (no user name, no file name; see [§6.1](#spike-kit-arch)) |
| **Milestone flow** (M0 demo, M1, M3, M4.5) | A usability check on a real design system with the user or the boss (D-40). The result is written into the item's PR |

---

<a id="phase-0-items"></a>

## 4. Phase 0 work items

Goal: the skeleton, the fixtures, the spike kits, and one micro-fixture flowing CLI → bundle → plugin ([14 Phase 0](14-roadmap.md#phase-0)).

### 4.1 Foundations

#### B-00 · Monorepo scaffold — **IN PROGRESS (another agent)**

**Path** repo root, `packages/*` · **Depends** — · **Runs** container · **Size** L

Build:
- pnpm workspaces + Turborepo + Biome + Vitest + tsup + changesets (D-04). Node `>=20.19`, CI on 22.
- Every `@holotype/*` package from [README §6](README.md) as a building, tested stub: `ir`, `shared`, `layout-sim`, `storybook`, `capture`, `planner`, `mapper`, `plugin`, `figma-fake`, `cli`, `storybook-addon`, `action`, `dcr`, `vite-plugin`, plus `tools/fidelity`.
- `shared`: `Diagnostic`, `defineDiagnostic()`, registry, `Result<T,E>`, `Logger` interface.
- `ir`: `canonicalJSON()` per [06 §5](06-ir.md), `h16()` (sha256 → 16 hex, `@noble/hashes`), `sha256hex()`, `fnv1a64()` for `ah` (D-31). Property tests with fast-check.
- dependency-cruiser rules from [02 §6.2](02-architecture.md#monorepo). CI workflow: install, lint, typecheck, test, build, depcruise.

Acceptance: `pnpm i --frozen-lockfile && pnpm turbo run lint typecheck test build && pnpm depcruise`; property tests for canonical JSON (idempotent, key-order independent, `-0` → `0`, NaN throws) and both hashes (known vectors).

Checklist for the coordinator when B-00 lands. If any line is missing, open **B-00b** (S) to add it:
- workspace globs include `fixtures/*`, `spikes/*`, `tools/*`;
- the root scripts of [§2.2](#conventions) exist;
- `playwright-core` is pinned to the exact version preinstalled in the container (D-05);
- Biome restricts `node:*`, `process`, `Buffer`, `Date.now`, `Math.random` in `ir`, `shared`, `layout-sim`, `mapper`, `dcr`, and the `figma` global in `packages/plugin/src/apply/**`;
- dependency-cruiser applies boundary rules to `src/**` only, so tests may import `figma-fake`.

#### B-01 · `ir` schemas v0

**Path** `packages/ir` · **Depends** B-00 · **Runs** container · **Size** L

Build (TypeBox is the source of truth, D-07):
- `primitives.ts`, `capture.ts` (`CaptureDoc`, `CNode`, text, assets, fonts, custom properties; [06 §1–2](06-ir.md)).
- `scene.ts` (`SceneComponent`, `ScenePropertyDef`, `SceneVariant`, `SceneNode`, layout, paints, text, instance, bindings; [06 §3](06-ir.md)).
- `bundle.ts` (`BundleManifest`, [06 §4.2](06-ir.md)), plus `integrity: {algo:'sha256', files}` from [02 §5.1](02-architecture.md) (needed for `APPLY_BUNDLE_CORRUPT`).
- `tokens.ts` (`TokensDoc`, [06 §4.3](06-ir.md#tokens)), `report.ts` (`BundleReport`, 06 §4.4).
- `config.ts`: `HolotypeParams` from [04 §9](04-variant-model.md#schema), plus `implements?: string[]` (D-37) and `replacedBy?: string`.
- `pipeline.ts`: the cross-package input types the mapper needs but may not import from other packages: `VariantPlan` (minimal), `ComponentMetaInput`, `ComponentCatalog`, `TokenResolution` ([07 §0](07-mapping.md)).
- Compiled validators (`TypeCompiler`): `validateCaptureDoc`, `validateScene`, `validateManifest`, `validateTokens`, `validateParams`.
- Semantic invariant checker `checkSceneInvariants()` ([06 §9](06-ir.md)).
- `migrations/scene/` registry (empty), `migrateScene()`.
- Schema emitter → `packages/ir/schema/{capture,scene,tokens,bundle,report,config}.v1.json`.

Acceptance:
- `pnpm -F @holotype/ir test`: a valid/invalid corpus in `test/corpus/` passes and fails as named. It includes the Button excerpt of [06 §10](06-ir.md), completed into a valid document.
- Round trip: `validate(parse(canonicalJSON(x)))` for every valid corpus file.
- `pnpm -F @holotype/ir schema && git diff --exit-code packages/ir/schema`.

Parallel: owns `packages/ir/**` only. Runs alongside B-02, B-03, B-06, B-07, B-08.

#### B-02 · Diagnostics catalog from chapter 12

**Path** `tools/diag-gen`, `packages/shared/src/diagnostics/**`, `docs/diagnostics/**` · **Depends** B-00 · **Runs** container · **Size** M

Build:
- `tools/diag-gen` parses the tables of [12 §6.2](12-quality.md#diagnostics) and writes `catalog.generated.ts`: `{code, domain, severity, message, remedy, emittedBy, definedIn}` for every code.
- One page per code, `docs/diagnostics/<CODE>.md`: what happened (Meaning), what to do (User remedy), where it is defined. This satisfies D-40 (plain-language message + remedy).
- `pnpm diag:gen` (regenerate) and `pnpm diag:check`: fails on (a) a `UPPER_SNAKE` code literal in `packages/**/src` that is not registered, (b) a registered code without a page, (c) per-domain row counts that differ from the counts in the catalog's header line.

Acceptance: `pnpm diag:gen && git diff --exit-code`; `pnpm diag:check`; a unit test that every code is unique and has a non-empty remedy.

Note: chapter 12 is being edited by another agent. Run this item after that edit lands, and re-run `pnpm diag:gen` whenever 12 changes.

#### B-03 · Fixture design system `fixtures/ds-react`

**Path** `fixtures/ds-react` (private package `@holotype/fixture-ds-react`), `fixtures/fonts.lock` · **Depends** B-00 · **Runs** container · **Size** L

A small React + Vite design system on Storybook 10.6.x (`@storybook/react-vite`, D-11, D-26). Capture, mapper and DCR tests use it.

Build:
- **Tokens** `src/tokens/tokens.css`. Primitives: `--color-<hue>-<step>`, `--space-1..8`, `--radius-sm|md|lg|full`, `--font-size-*`, `--line-height-*`, `--shadow-sm|md`. Semantic aliases: `--color-bg`, `--color-fg`, `--color-primary`, `--button-bg: var(--color-primary)`. A dark theme under `[data-theme="dark"]`. One `calc()` token and one `color-mix()` token (unbindable cases, [12 §2.2](12-quality.md#fixtures)).
- **Font:** Inter 400/500/600/700 from `@fontsource/inter`, self-hosted. `fixtures/fonts.lock` lists each file with its sha256 ([12 §1.2](12-quality.md#pyramid)). Inter is also available in Figma, so fonts preflight passes.
- **Components**, each with a CSS module and only token values:

| Component | Props (args) | Exercises |
|---|---|---|
| `Button` | `variant: 'primary'\|'secondary'\|'ghost'`, `size: 'sm'\|'md'\|'lg'`, `label`, `disabled`, `loading`, `iconLeading?: IconName`, `showIcon` | variants, BOOLEAN, TEXT, states (`:hover`, `:focus-visible`, `:active`), spinner |
| `Badge` | `tone: 'neutral'\|'info'\|'success'\|'warning'\|'danger'`, `label`, `dot` | inline box, HUG |
| `Input` | `label`, `placeholder`, `value`, `helperText`, `error?`, `disabled`, `prefixIcon?` | `::placeholder`, native input, invalid state |
| `Card` | `title`, `body`, `media` (local image), `children` (actions slot) | `margin-top:auto` footer, line clamp, image `object-fit` |
| `Stack` | `direction`, `gap: 1..8`, `align`, `justify`, `wrap`, `children` | flex layouts for Phase 2 |
| `Icon` | `name` (8 inline SVGs from Lucide, ISC), `size: 16\|20\|24` | inline SVG, `currentColor` |

- **Stories** (CSF3). Titles `Components/<Name>`, so `sid` = `components-<name>`. Fixed story ids:
  - `components-button--primary`, `--secondary`, `--ghost`, `--small`, `--large`, `--with-icon`, `--loading`, `--disabled`
  - `components-badge--default`, `--tones`, `--with-dot`
  - `components-input--default`, `--with-error`, `--disabled`, `--with-prefix`
  - `components-card--default`, `--with-media`, `--long-text`
  - `components-stack--row`, `--column`, `--wrap`
  - `components-icon--default`, `components-icon--gallery` (tagged `!figma`: tests opt-out)
- Every story has `args` and `argTypes` with controls.
- **`parameters.holotype` usages** (schema [04 §9](04-variant-model.md#schema)):
  1. Button meta: `args: { label: { as: 'text' }, showIcon: { as: 'boolean' } }`, `states: { include: ['default','hover','focus-visible','active'], foldBooleans: ['disabled','loading'] }`, `layout: { columns: ['State'], rows: ['Variant','Size'] }`.
  2. Badge meta: `args: { tone: { as: 'variant', name: 'Tone' }, dot: { as: 'boolean', name: 'Dot' } }`.
  3. Stack `--wrap`: `keepLayout: true` and `width: { probe: [240, 480] }`.
  4. Card `--long-text`: `textMode: 'locked-lines'`.
  5. Card meta: `slots: { actions: { selector: '[data-slot=actions]' } }`.
- `.storybook/preview.tsx`: `globalTypes.theme` (light/dark) applied by a decorator as `data-theme` ([03 §8](03-storybook.md#themes)).

Acceptance:
- `pnpm -F @holotype/fixture-ds-react build-storybook` writes `storybook-static/` (gitignored). A snapshot test checks the sorted story ids in `index.json`.
- `pnpm -F @holotype/fixture-ds-react test:smoke` (Playwright): every story renders, no console error, no request outside `127.0.0.1`, `document.fonts.check('600 14px Inter')` is true.
- `pnpm -F @holotype/fixture-ds-react dev` serves on port 6006 (used by S-19 and branch mode).

Parallel: owns `fixtures/ds-react/**`. B-04 and B-05 add files only.

#### B-04 · Micro-fixtures, batch 1 (30 stories)

**Path** `fixtures/ds-react/src/micro/**` · **Depends** B-03 · **Runs** container · **Size** M

Plain-markup stories, one feature each ([12 §2.2](12-quality.md#fixtures)). Titles `Micro/<Group>`, ids `micro-<group>--<case>`:

| Group | Cases |
|---|---|
| flex (8) | `row`, `column`, `wrap`, `gap`, `justify-between`, `align-center`, `grow`, `nested` |
| borders (7) | `uniform`, `per-side-widths`, `per-side-colors`, `dashed`, `outline-offset`, `radius-per-corner`, `radius-overflow` |
| backgrounds (8) | `solid-alpha`, `oklch`, `linear-angle`, `linear-hard-stops`, `radial`, `conic`, `multi-layer`, `image-cover` |
| text (7) | `single-line`, `wrap-paragraph`, `weights`, `line-height-px`, `letter-spacing`, `text-transform`, `mixed-inline` |

Acceptance: the B-03 smoke test covers them; the `index.json` id snapshot includes all 30.

#### B-05 · Styling-variant fixtures

**Path** `fixtures/ds-react/src/styling/**` · **Depends** B-03 · **Runs** container · **Size** S

The same Button styled three more ways, for S-08 and S-19: plain global CSS (`styling-button-css--default`), emotion (`styling-button-emotion--default`, late-injected rules), Tailwind v4 (`styling-button-tailwind--default`). Each has a `:hover` and a JS-driven hover (`onMouseEnter` → `data-state`).

Acceptance: smoke test passes; ids in the snapshot.

#### B-06 · `figma-fake` core and the `FigmaPort` type

**Path** `packages/figma-fake`, `packages/plugin/src/port.ts` · **Depends** B-00 · **Runs** container · **Size** L

Build:
- `port.ts`: `FigmaPort` as a `Pick<>` of `@figma/plugin-typings@1.142.0` ([09 §4](09-plugin.md#port)), Phase 1 members only (list in [§5](#figma-fake)).
- `createFakeFigma(opts) → FigmaPort & { snapshot(): FakeTree; ops(): Op[]; reset(); faults: FaultPlan }`.
- In-memory node tree with real node ids (`<n>:<m>`), shared plugin data, `findAllWithCriteria`, fonts list, and the Phase 1 throw rules of [§5](#figma-fake).
- `snapshot()`: canonical JSON of the document (types, names, geometry, paints, text, plugin data). `ops()`: an ordered log of every write (method, node id, property, value).
- A contract test table: one test per throw rule, named after the row in [09 §6.2](09-plugin.md#apply-order).

Acceptance: `pnpm -F @holotype/figma-fake test`; `pnpm -F @holotype/figma-fake typecheck` proves `createFakeFigma()` satisfies `FigmaPort` with no casts.

Parallel: owns `packages/figma-fake/**` and `port.ts`. B-07 must not create `port.ts`.

#### B-07 · Plugin scaffold

**Path** `packages/plugin` (except `port.ts`) · **Depends** B-00 · **Runs** container (build), needs Figma desktop (smoke, via B-15) · **Size** M

Build:
- create-figma-plugin project (D-06): `src/main.ts`, `src/ui/**` (Preact), `src/protocol.ts` (message union of [09 §3.2](09-plugin.md#protocol), Phase 1 subset: `hello`, `session.open`, `unit`, `need`, `progress`, `diagnostics`, `done`, `error`, `cancel`, `ping`/`pong`).
- Manifest from `package.json` `figma-plugin` field ([09 §2](09-plugin.md#manifest)): `documentAccess: "dynamic-page"`, `editorType: ["figma"]`, candidate `networkAccess` (3 loopback ports, http + ws), `reasoning` text. The real manifest `id` is fixed forever; until Figma issues one, use a placeholder and record it in the PR.
- UI shell: tabs Library / Import file / Report / Settings ([11 §5](11-ux.md#plugin)), with Library and Settings as "coming soon" panes. A message catalog `ui/messages/en.json`.
- `pnpm -F @holotype/plugin build` → `manifest.json`, `build/main.js`, `build/ui.html`. `pnpm -F @holotype/plugin pack` → `holotype-plugin-<version>.zip` with fixed mtimes ([02 §6.4](02-architecture.md#monorepo)).

Acceptance: build and pack succeed; `pnpm size` within budget; UI tests render each tab in its empty state; protocol tests round-trip every message type through a mocked `figma.ui`.

#### B-08 · Spike kit infrastructure (`spikes/runner`)

**Path** `spikes/runner`, `spikes/_shared`, `spikes/README.md` · **Depends** B-00 · **Runs** container (build), needs Figma desktop (use) · **Size** M

One development plugin, "Holotype Spikes", that hosts every Figma spike, so the user imports it once. Details in [§6.1](#spike-kit-arch).

Acceptance: `pnpm -F @holotype/spikes build` → `spikes/dist/holotype-spikes-<version>.zip`; `pnpm -F @holotype/spikes test` dry-runs a sample spike against `figma-fake`; UI tests for the spike list, a running spike, a finished spike (Copy results) and a failed spike.

#### B-09 · CI: end-to-end jobs and artifacts

**Path** `.github/workflows/**` · **Depends** B-03, B-07, B-08 · **Runs** container · **Size** S

Build: a Playwright job that builds `fixtures/ds-react` once (cached by lockfile + source hash) and runs every `test:e2e`; the plugin bundle-size check; artifacts `holotype-plugin-<version>.zip` and `holotype-spikes-<version>.zip` on every main build, so the coordinator can send the user a download link.

Acceptance: a PR shows the e2e job and both artifacts.

### 4.2 Walking skeleton (M0 smoke: the first visible demo)

These six items make one story appear in Figma as rectangles and text. Phase 1 deepens each one.

#### B-10 · `storybook` adapter v0: discovery and URL render

**Path** `packages/storybook` · **Depends** B-01, B-03 · **Runs** container · **Size** M

Build ([03 §2](03-storybook.md), [§3](03-storybook.md), [§5.4](03-storybook.md#render-loop-driver)):
- `connectStorybook({ source })`: a static dir (served with sirv on a free loopback port) or a dev URL. Reads `index.json` v5 and `project.json`; detects the version (`SbCapabilities`, 03 §3.1).
- `listStories()` with `figma` / `!figma` tag filtering (README §7).
- `RenderDriver.render()` via the URL path (`iframe.html?id=…&args=…`), readiness `storyFinished ?? storyRendered`, `document.fonts.ready`, two animation frames.
- Root detection `#storybook-root` ([03 §6.1](03-storybook.md#root)).
- Codes `SB_INDEX_UNREACHABLE`, `SB_VERSION_UNSUPPORTED`, `SB_STORY_ERROR`, `SB_RENDER_TIMEOUT`.

Acceptance: `pnpm -F @holotype/storybook test` (index parsing v4/v5 fixtures, tag filter); `pnpm -F @holotype/storybook test:e2e` renders `components-button--primary` and `micro-flex--row` from the static build and returns a root handle.

#### B-11 · `capture` v0: pool, environment, serializer skeleton

**Path** `packages/capture` · **Depends** B-01, B-10 · **Runs** container · **Size** L

Build ([05 §1–2](05-capture.md#orchestration)):
- `createCapturer(opts) → Capturer` with `capture(req)` and `close()`. One Chromium, N contexts. Context options and Chromium flags of D-24 and [05 §1.3](05-capture.md#orchestration). Pinned clock, seeded `Math.random`.
- `src/page/**` built by esbuild into one IIFE string, exported as `serializerSource`. Injected with `addInitScript`.
- Collector registry `src/page/collectors/index.ts`. v0 collectors: element rects (`getBoundingClientRect`), `background-color`, uniform border, `border-radius`, `opacity`, text runs with font family/size/weight/color and line boxes (`Range.getClientRects`).
- Output: a `CaptureDoc` that validates with `validateCaptureDoc` (optional fields left out). Element screenshot @2x of the root.

Acceptance: `pnpm -F @holotype/capture test` (unit: whitespace collapse, color parse); `pnpm -F @holotype/capture test:e2e`: L3 snapshot `micro-flex--row → CaptureDoc` and `components-badge--default → CaptureDoc`, byte-identical across two runs; built IIFE ≤150 kB.

#### B-12 · `mapper` v0: absolute Scene IR

**Path** `packages/mapper` · **Depends** B-01 · **Runs** container · **Size** M

Build ([07 §0–1](07-mapping.md)):
- `mapComponent(input: MapperInput) → MapperOutput`, pure. Stage registry `src/stages/index.ts`.
- v0 stages: normalize (drop empty wrappers that have no paint), absolute frames (`xy` + `size`), SOLID fills, uniform INSIDE stroke, radius, opacity, one TEXT node per text block with one range, `nk` path signatures ([10 §4](10-sync.md#nk)), `expect` rects, `irh` bottom-up ([06 §6](06-ir.md#hashing)), invariant check.
- Single-variant `kind: 'component'` scene; `vk` from [06 §6](06-ir.md#hashing).

Acceptance: `pnpm -F @holotype/mapper test`: L3 snapshots from hand-written `CaptureDoc` JSON in `test/fixtures/` (until B-11 lands, then from B-11 snapshots); property test "every node's absolute rect equals its capture rect".

#### B-13 · `cli` v0: `capture` and the bundle writer

**Path** `packages/cli`, `packages/planner` (one function) · **Depends** B-10, B-11, B-12 · **Runs** container · **Size** M

Build:
- `holotype capture --storybook <dir|url> --story <id> --out <dir|file.holotype.zip> [--json]` (citty).
- `planner.planSingleStory(model, storyId)` → a one-variant `VariantPlan`.
- Bundle writer `src/bundle/**` ([02 §5.1](02-architecture.md), [06 §4](06-ir.md)): `manifest.json` first, `components/<sid>.json`, `assets/<sha>`, `report.json`, `integrity`. Zip with fflate (STORE for images, DEFLATE for JSON).
- Exit codes per [11 §3.2](11-ux.md) (see [§10](#plan-gaps)).

Acceptance: `pnpm -F @holotype/cli test:e2e`: capture `micro-flex--row` from the static build to a zip; unzip; manifest and scene validate; integrity hashes match; `--json` output snapshot; exit code 3 for a missing Storybook dir.

#### B-14 · Plugin v0: file import and absolute applier

**Path** `packages/plugin/src/{ui/import,apply,main.ts}` · **Depends** B-01, B-06, B-07 · **Runs** container (tests), needs Figma desktop (via B-15) · **Size** L

Build:
- **Import file** screen ([11 §2.3](11-ux.md), §6.11): drop zone or picker; unzip in a Web Worker with fflate; validate manifest and scenes with the compiled validators; integrity check (`APPLY_BUNDLE_CORRUPT`); IR major check (`APPLY_IR_VERSION_UNSUPPORTED`). States: empty, loading, error, success.
- Pull loop and chunking ([09 §3.3](09-plugin.md#protocol)).
- `apply/` against `FigmaPort` only: page "Components" (created if absent), one frame per variant, then children pre-order with the write order of [09 §6](09-plugin.md#apply-order) steps 0–2, 4, 5, 8, 10 (no layout yet). `writeIdentity()` writes `nk`, `vk`, `irh`, `v`.
- Fonts: `loadFontAsync` for each unique FontName; on failure fall back to Inter at the nearest weight with `FONT_MISSING`.
- After apply: select the new frames, `notify`, `commitUndo` once per component.
- Phase 1 limitation, stated in the UI: each import creates new frames. Re-sync arrives in Phase 4.

Acceptance: `pnpm -F @holotype/plugin test`: L3 snapshot `Scene IR → figma-fake tree + op log` for the B-12 fixtures; no throw from the fake; UI tests for the four Import states.

#### B-15 · M0 smoke: CLI → bundle → plugin

**Path** `tests/smoke/**` · **Depends** B-04, B-13, B-14 · **Runs** container + **needs Figma desktop** · **Size** S

Container: `pnpm test:smoke` captures `micro-flex--row` and `components-badge--default`, writes `smoke.holotype.zip`, applies it to `figma-fake` and compares the fake snapshot with a committed one.

User steps (send these as written):
1. Download `holotype-plugin-<version>.zip` and `smoke.holotype.zip` from the link I send. Unzip the plugin to a folder that stays put.
2. In the Figma desktop app, open a new design file.
3. Menu **Plugins ▸ Development ▸ Import plugin from manifest…** and pick `manifest.json` from that folder.
4. Run **Plugins ▸ Development ▸ Holotype**. Open the **Import file** tab and drop `smoke.holotype.zip`.
5. Reply "smoke OK" if you see a row of three boxes and a badge. Otherwise copy the message the plugin shows and paste it here.

Acceptance: CI green; the user replies "smoke OK". This is the **first visible demo** and the last M0 exit criterion besides the spike reports.

### 4.3 Container-only spikes

Each ends with `docs/spikes/S-xx.md` and a proposed README §5 update. The coordinator confirms README changes with the user (README is binding).

| ID | Spike | Path | Depends | Size | Build | Acceptance |
|---|---|---|---|---|---|---|
| **B-16** | S-07 render loop | `tools/sandboxes`, `spikes/S-07` | B-10 | M | Sandbox generator (react-vite on 10.6.x and 11-beta; 8.6/9.1 smoke) with the ds-react stories copied in; a 200-variant channel loop prototype with failure injection ([14 S-07](14-roadmap.md#phase-0)) | `pnpm -F @holotype/spikes s07`; report with a quirks list per version and throughput numbers |
| **B-17** | S-08 pseudo-states | `spikes/S-08` | B-05, B-11 | M | `CSS.forcePseudoState` (target + ancestors) vs real Playwright hover vs addon global, on ds-react, the styling variants, and small MUI and shadcn sandboxes | per-strategy success table; default ordering proposal for D-14 |
| **B-18** | S-13 detection (capture half) | `spikes/S-13` | B-11 | S | React fiber `type` ↔ Storybook `component` refs in dev and static builds; structural-hash fallback; Card→Button→Icon nesting story added to ds-react | precision/recall per build mode |
| **B-19** | S-19 provenance | `spikes/S-19`, `packages/vite-plugin` (prototype) | B-05, B-11 | M | CDP `styleSheetId` + `style.range` + `CSS.styleSheetAdded` source maps on the dev server, for plain CSS, CSS modules, Tailwind v4, emotion; `data-holotype-loc` injection prototype for React 19 | coverage table per styling approach; `DCR_PROVENANCE_*` thresholds proposal |

The container halves of S-03, S-04, S-05, S-09, S-10 and S-16 (reference renders in Chromium) are part of their kit items in [§6](#spike-kit).

---

<a id="figma-fake"></a>

## 5. `figma-fake`: the API surface

The fake implements exactly what the applier calls through `FigmaPort` ([09 §4](09-plugin.md#port)), plus the node members those calls return. It grows by phase. Each phase's members are added to `port.ts` in the same PR.

**Rule for every member:** same name and type as `@figma/plugin-typings@1.142.0`; throw the same error class in the same situations as real Figma ([12 §1.1](12-quality.md#pyramid)); record every write in `ops()`.

### 5.1 Phase 1 (B-06, B-54)

| Area | Members | Source |
|---|---|---|
| Global | `createFrame`, `createRectangle`, `createEllipse`, `createText`, `createVector`, `createNodeFromSvg`, `createImage`, `getImageByHash`, `createPage`, `createSection`, `getNodeByIdAsync`, `loadFontAsync`, `listAvailableFontsAsync`, `commitUndo`, `notify`, `root`, `currentPage`, `setCurrentPageAsync`, `mixed`, `skipInvisibleInstanceChildren`, `clientStorage.getAsync/setAsync` | [09 §4](09-plugin.md#port), [§5.1](09-plugin.md#preflight) |
| BaseNode | `id`, `type`, `name`, `parent`, `removed`, `remove()`, `getSharedPluginData`, `setSharedPluginData`, `getSharedPluginDataKeys`, `setRelaunchData` | [10 §2](10-sync.md#keys) |
| Children | `children`, `appendChild`, `insertChild`, `findAllWithCriteria({ types?, sharedPluginData })` | [10 §3](10-sync.md#index) |
| Page | `loadAsync` | [09 §5.2](09-plugin.md#index-stage) |
| Geometry | `x`, `y`, `width`, `height`, `resize`, `resizeWithoutConstraints`, `relativeTransform`, `rotation`, `absoluteTransform`, `absoluteBoundingBox`, `constraints` | [09 §6](09-plugin.md#apply-order), [§11](09-plugin.md#verify) |
| Paint | `fills`, `strokes`, `strokeAlign`, `strokeWeight`, `strokeTopWeight`/`Right`/`Bottom`/`Left`, `dashPattern`, `strokeCap`, `strokeJoin`, `topLeftRadius`…`bottomLeftRadius`, `cornerSmoothing`, `effects`, `opacity`, `blendMode`, `visible`, `clipsContent`, `isMask`, `maskType` | [09 §6](09-plugin.md#apply-order) |
| Text | `fontName`, `characters`, `fontSize`, `setRangeFontName`, `setRangeFontSize`, `setRangeLineHeight`, `setRangeLetterSpacing`, `setRangeFills`, `setRangeTextCase`, `setRangeTextDecoration`, `setRangeHyperlink`, `getStyledTextSegments`, `textAlignHorizontal`, `textAlignVertical`, `textAutoResize`, `textTruncation`, `maxLines`, `paragraphSpacing`, `paragraphIndent`, `leadingTrim`, `textWrapStyle` | [09 §6.1](09-plugin.md#text) |
| Vector / image / SVG | `vectorPaths`; `Image.hash`; `createNodeFromSvg` returns a frame with one vector child per `<path>` | [09 §6.3](09-plugin.md#apply-order) |
| Export | `exportAsync({format:'PNG', constraint})` returns deterministic placeholder PNG bytes | [09 §14](09-plugin.md#fidelity) |

Throw rules (rows of [09 §6.2](09-plugin.md#apply-order)): setting `characters` or font fields with an unloaded font; size below 0.01; mutating a paint, effect or constraints object in place (arrays are frozen); sync getters (`getNodeById`) absent under `dynamic-page`. Behaviour rules: replacing `characters` drops range styles; text `resize()` sets a fixed width.

Text metrics: the fake computes line breaks with a deterministic advance table (per font, per character class). Tests may switch to "oracle" mode, where line count comes from the Scene IR `lines`, to test the verify path in isolation.

### 5.2 Phase 2 (layout)

`layoutMode`, `layoutWrap`, `paddingTop/Right/Bottom/Left`, `itemSpacing`, `counterAxisSpacing`, `counterAxisAlignContent`, `primaryAxisAlignItems`, `counterAxisAlignItems`, `primaryAxisSizingMode`, `counterAxisSizingMode`, `itemReverseZIndex`, `strokesIncludedInLayout`, `layoutSizingHorizontal/Vertical`, `layoutPositioning`, `minWidth`/`maxWidth`/`minHeight`/`maxHeight`, grid members (`gridRowCount`, `gridColumnCount`, `gridRowSizes`, `gridColumnSizes`, `gridRowGap`, `gridColumnGap`, `setGridChildPosition`). Geometry comes from `layout-sim`.

Throw rules: padding/spacing without `layoutMode`; `WRAP` on GRID; FILL without an auto-layout parent; HUG on a non-auto-layout node; `ABSOLUTE` before append; FLEX track on a HUG axis; `BASELINE` on a vertical stack. Behaviour: `resize()` on an auto-layout axis forces FIXED; `x`/`y` ignored for non-absolute children.

### 5.3 Phase 3 (components)

`createComponent`, `combineAsVariants`, `ComponentNode.createInstance`, `description`, `documentationLinks`, `getInstancesAsync`, `key`, `variantProperties`, `ComponentSetNode.addComponentProperty`, `editComponentProperty`, `deleteComponentProperty`, `componentPropertyDefinitions`, `defaultVariant`, `componentPropertyReferences`. Throw: `combineAsVariants` with 0 nodes, mixed pages, or inside an instance ([09 §7.2](09-plugin.md#sets)).

### 5.4 Phase 4 (sync)

`InstanceNode.getMainComponentAsync`, `swapComponent`, `setProperties`, `componentProperties`, `overrides`; instance sublayer ids `I<inst>;<child>` that read the main component's plugin data ([10 §2.1](10-sync.md#keys)); an override model that follows the S-02 matrix; `clone()` (fork policy); fault injection (throw at the Nth write) for T-19; the conformance-replay format (record ops in real Figma, replay in the fake, compare, [12 §4.4](12-quality.md#harness)).

### 5.5 Phase 4.5 (DCR)

`figma.fileKey`, `annotations`, `figma.annotations.getAnnotationCategoriesAsync`, `devStatus` (only if S-18 shows plugins can write it), `reactions`, `detachedInfo` (S-15), root plugin data chunks for `branch:meta` and `base:*`.

Variables and styles (`figma.variables.*`, `teamLibrary.*`, style APIs) arrive with Phase 5 and are outside this file.

---

<a id="spike-kit"></a>

## 6. Figma spike kit

<a id="spike-kit-arch"></a>

### 6.1 How the kit works

- **One plugin for all spikes.** `spikes/runner` builds "Holotype Spikes", a separate development plugin with its **own** manifest `id`. It must not reuse the product plugin's id, because that id is fixed forever and keys `clientStorage` ([02 §6.4](02-architecture.md#monorepo)).
- **Spikes are modules.** Each spike lives in `spikes/S-xx/`: `plugin.ts` (runs in Figma), optional `refs.ts` (renders reference data in Chromium, in the container), and `README.md` (the user card below). The runner lists them; each step is a button.
- **References are bundled.** Container-side reference renders (screenshots, rects, line breaks) are generated by `refs.ts` and bundled into the spike plugin's UI. The plugin compares in the UI iframe (canvas, SSIM, pixel diff), so only small numbers come back.
- **Results.** Every step ends on a "Done" screen with **Copy results**. The JSON envelope is `{ spike, kitVersion, step, env: { apiVersion, client, os }, results }`. It never contains the user's name, email or file names. Results over 30 kB are split into numbered parts ("Copy part 1 of 3"). **Save results file** is the fallback: the user uploads the file to the repo folder `spikes/results/` through the GitHub web page (Add file ▸ Upload files).
- **Multi-step spikes** keep their state in `clientStorage`, so the user can close Figma between steps.
- **Two shared test files** serve every library spike (S-02, S-12, S-15): "Spikes Library" and "Spikes Consumer". Publishing is done once per step, not once per spike.
- **Dry run.** Every spike runs against `figma-fake` in CI (unsupported calls go through a recording proxy), so the user never hits a trivial bug.
- **Analysis.** When the results arrive, the coordinator dispatches a container agent to write `docs/spikes/S-xx.md`, ending with a proposed README §5 update.

### 6.2 One-time setup (user)

1. Download `holotype-spikes-<version>.zip` from the link I send. Unzip it to a folder that stays put, e.g. `Holotype/spikes`.
2. Open the Figma desktop app and create a new design file named **Spikes Scratch**.
3. Menu **Plugins ▸ Development ▸ Import plugin from manifest…** and pick `manifest.json` in that folder.
4. To run a spike: **Plugins ▸ Development ▸ Holotype Spikes**, click the spike, then its step button. Wait for **Done**, click **Copy results**, and paste here.

When I send a new kit version, unzip it over the same folder. No re-import is needed.

### 6.3 Which spikes need Figma

From [14 Phase 0](14-roadmap.md#phase-0). The brief's list missed S-03, S-04, S-09, S-11 and S-13: they also need Figma.

| Spike | Needs Figma | Who runs it | Time for the user |
|---|---|---|---|
| S-01 | desktop + browsers | user (needs Node for the test server) | 30 min |
| S-02 | desktop, library publish | user or boss | 40 min |
| S-03 | desktop | either | 5 min |
| S-04 | desktop | either | 10 min |
| S-05 | desktop + a designer's opinion | boss | 10 min |
| S-06 | desktop | either | 20 min (mostly waiting) |
| S-07, S-08, S-19 | no | agent | — |
| S-09 | desktop | either | 5 min |
| S-10 | desktop | either | 5 min |
| S-11 | Figma account via the remote MCP connector | user connects; agent runs | 5 min |
| S-12 | desktop, library publish | user | 20 min |
| S-13 | desktop (plugin half only) | either | 5 min |
| S-15 | desktop, library + branch | user | 20 min |
| S-16 | desktop | either | 10 min |
| S-17 | desktop, Organization account, branching | user | 20 min |
| S-18 | desktop + a Figma token for REST | user | 15 min |

### 6.4 Spike cards

Each card is a work item. The **build** part runs in the container (`spikes/S-xx`, depends on B-08). The **run** part needs Figma desktop.

#### B-20 · S-01 Local network access (desktop and browsers)

- **Question:** can the plugin UI reach `127.0.0.1` by fetch and WebSocket in each client; do the fixed manifest ports work; does the PNA header matter? Decides D-25, D-10 and the streaming default.
- **Build (M):** `spikes/S-01/server.ts`, bundled into one file `s01-server.mjs` that needs only Node (no install). It listens on 47321–47323 with `ACAO:*`, has routes with and without `Access-Control-Allow-Private-Network`, answers WS, and prints every request. The plugin step probes fetch GET/POST with an `Authorization` header, WS, SSE and long-poll, on `127.0.0.1` and `localhost`, on each listed port and on unlisted port 47324 (expected CSP block). It records error class and message per probe.
- **User steps:**
  1. Open the Terminal (Mac) or PowerShell (Windows) in the kit folder and paste: `node s01-server.mjs`. Leave it open.
  2. In Figma desktop, run **S-01 ▸ Probe**. Copy results and paste here.
  3. Stop the server (Ctrl+C) and run **S-01 ▸ Probe** again. Paste.
  4. Copy the lines the server printed and paste them here.
  5. Browsers (optional): open the same file in Chrome, Edge, Safari and Firefox. If **Plugins ▸ Development** lists Holotype Spikes there, run **Probe** and paste each result. If it is not listed, reply "not listed in <browser>". That is a result too. For the browser rows we may later publish the kit privately to your organization; I will send separate steps if needed.
- **Paste back:** one results block per client and server state, plus the server log.

#### B-21 · S-02 Override preservation

- **Question:** which in-place mutations of a main component keep instance overrides, in the same file and through a library update ([10 §11.1](10-sync.md#overrides)).
- **Build (L):** step 1 builds 19 main components (one per mutation row) with 15 child types and, for each, 13 instances (one per override kind). Step 3 applies the 19 mutations. Steps 2 and 4 read overrides back and grade each cell kept / lost / partial. Component keys are saved in `clientStorage` between steps.
- **User steps:**
  1. In the file **Spikes Library**, run **S-02 ▸ Step 1 (build)**.
  2. Publish the library: **Assets ▸ Libraries ▸ Publish**.
  3. In the file **Spikes Consumer**, enable the library (**Assets ▸ Libraries**, switch on Spikes Library), then run **S-02 ▸ Step 2 (place instances)**.
  4. Back in **Spikes Library**, run **S-02 ▸ Step 3 (mutate)**. Copy results and paste (this is the same-file matrix). Publish again.
  5. In **Spikes Consumer**, accept the library update (the "Updates available" notice ▸ **Update all**), then run **S-02 ▸ Step 4 (read)**. Paste.
- **Paste back:** two results blocks (same-file matrix, cross-file matrix). Output becomes `docs/research/s02-override-matrix.md`.

#### B-22 · S-03 Gradients, shadows, blurs

- **Question:** `gradientTransform` space, radial and angular conventions, shadow order, blur radius factor, spread on frames.
- **Build (M):** `refs.ts` renders parameter sweeps (≈60 cases) in Chromium and bundles PNG references. The plugin builds each case with candidate formulas (for example blur ×1 and ×2), exports PNG @2x, and scores each candidate in the UI.
- **User steps:** in **Spikes Scratch**, run **S-03 ▸ Run**. Paste results.
- **Paste back:** best formula and error per case family.

#### B-23 · S-04 Text parity

- **Question:** line breaks, `line-height: normal`, baseline and the width buffer needed, per font (D-17).
- **Build (M):** `refs.ts` renders 300 paragraphs (Inter, Roboto, Noto Sans JP, Roboto Flex as the variable font) across widths and sizes, recording line count, line boxes and break positions. The plugin builds fixed-width text nodes, reads the line count, and searches the smallest extra width that restores the browser's line count. Break positions are compared on a 50-paragraph subset.
- **User steps:** run **S-04 ▸ Run** in **Spikes Scratch**. If Figma asks about missing fonts, click **Done** in the plugin anyway; it records which fonts were missing.
- **Paste back:** results (likely in parts). The SF/system-font row needs Chromium on a Mac; it is optional and done later if needed.

#### B-24 · S-05 Border model

- **Question:** keep D-16 (INSIDE stroke, padding + border, `strokesIncludedInLayout:false`) or flip it.
- **Build (S):** refs for uniform, per-side widths and colors, dashed, outline. The plugin builds model A (`false`) and model B (`true`) side by side, in and out of auto layout, reads child positions and scores pixels.
- **User steps (boss, as a designer):**
  1. Run **S-05 ▸ Run** in **Spikes Scratch**. Paste results.
  2. On the new page, frames are labelled A and B. Change the border (stroke) width of each to 3. Reply: "A felt right", "B felt right" or "both fine", and one sentence why.
- **Paste back:** results plus the one-line opinion.

#### B-25 · S-06 Plugin performance

- **Question:** build time for 1k and 5k variants, `combineAsVariants` cost, property binding cost, memory over repeated applies, slice length, `exportAsync` throughput. Also: is `setTimeout` available in main, is `crypto.subtle` available in main (D-31), the practical `postMessage` size, `documentationLinks` / `descriptionMarkdown` writability.
- **Build (M):** a synthetic Scene IR generator inside the spike; timing with `Date.now`; a heartbeat in the UI that measures editor stalls.
- **User steps:** in a new empty file, run **S-06 ▸ Run**. Don't use Figma while it runs (about 15 minutes). Then reply also "Figma froze: yes/no" and paste results.
- **Paste back:** results plus the yes/no.

#### B-26 · S-09 SVG import

- **Question:** where `createNodeFromSvg` fails (gradients, clipPath, mask, `<use>`, `<text>`) and when to rasterize.
- **Build (M):** an SVG corpus from Lucide (ISC), Heroicons (MIT) and Material Symbols (Apache-2.0) plus the ds-react icons, with Chromium refs. The icon-font outline prototype (fontkit) is container-only and lands in the same PR.
- **User steps:** run **S-09 ▸ Run** in **Spikes Scratch**. Paste.

#### B-27 · S-10 Grid auto layout

- **Question:** which CSS grid cases Figma GRID reproduces; plugin defaults for new grids.
- **Build (M):** refs for grid micro-cases (fixed, `fr`, auto tracks, gaps, spans, alignment, HUG container). The plugin builds them with `layoutMode:'GRID'` and `setGridChildPosition`, records which combinations throw, and compares child rects.
- **User steps:** run **S-10 ▸ Run** in **Spikes Scratch**. Paste. The output also calibrates `layout-sim` (B-61).

#### B-28 · S-11 `use_figma` feasibility

- **Question:** can the remote Figma MCP `use_figma` run our applier for a CI harness ([09 §16](09-plugin.md#use-figma)).
- **Build (S):** `plugin/dist/applier.mjs` prototype on 10 fixtures; a Node driver.
- **User steps:** connect the Figma connector to this Claude session (Settings ▸ Connectors ▸ Figma), create an empty file named **Spikes MCP**, and paste its link here. I run the rest.
- **Paste back:** the file link only.

#### B-29 · S-12 Variables

- **Question:** bindable fields in practice, explicit modes, mode limit per plan, `codeSyntax.WEB` matching, `importVariableByKeyAsync` from a library, aliases across collections (D-18).
- **Build (M):** step 1 creates collections, modes (adds modes until Figma refuses, to find the limit), variables with `codeSyntax.WEB`, and binds every field of [08 §8](08-tokens.md#bindings). Step 2 (consumer) lists library collections and imports by key.
- **User steps:**
  1. In **Spikes Library**, run **S-12 ▸ Step 1**. Paste. Publish the library (variables included).
  2. In **Spikes Consumer**, run **S-12 ▸ Step 2**. Paste.
  3. Optional: if you also have a Starter or Professional account, repeat step 1 there and paste.

#### B-30 · S-13 Slots and instance-swap (plugin half)

- **Question:** the SLOT property creation and binding sequence; `preferredValues` with local component keys; INSTANCE_SWAP default by node id ([09 §8.1](09-plugin.md#props)).
- **Build (S).** **User steps:** run **S-13 ▸ Run** in **Spikes Scratch**. Paste.

#### B-31 · S-15 Cross-file instances

- **Question:** can a consumer or branch file resolve library instances to our `sid`/`vk`/`irh`; is shared plugin data readable on remote main components; is `detachedInfo` reliable; can an outdated instance be detected ([15 §4.13](15-change-requests.md#instance-versions)).
- **Build (M):** step 1 builds components carrying `holotype` plugin data; step 2 places and detaches instances and reads remote data; step 3 changes the library; step 4 reads again after the update.
- **User steps:**
  1. **Spikes Library**: run **S-15 ▸ Step 1**, then publish.
  2. **Spikes Consumer**: run **S-15 ▸ Step 2**. Paste.
  3. **Spikes Library**: run **S-15 ▸ Step 3**, then publish.
  4. **Spikes Consumer**: run **S-15 ▸ Step 4** *before* accepting the update. Paste. Then accept the update and run Step 4 again. Paste.
  5. Paste the link of **Spikes Consumer**. I read it through REST with a token you give me through the secure form (never paste a token in chat).

#### B-32 · S-16 Instance properties → args

- **Question:** does instance properties → args → re-render → same instance hold for VARIANT, BOOLEAN, TEXT, INSTANCE_SWAP, SLOT ([15 §4.5](15-change-requests.md#extraction)).
- **Build (M):** the plugin builds a Button-like set (size × tone, BOOLEAN showIcon, TEXT label, INSTANCE_SWAP icon, SLOT) with a `valueMap` in plugin data, makes 20 instances with different values and overrides, and reverse-maps them to args. The container part re-renders those args from ds-react and compares.
- **User steps:** run **S-16 ▸ Run** in **Spikes Scratch**. Paste. I do the rest.

#### B-33 · S-17 Branches and plugin data

- **Question:** can a branch be created without the UI; do branches carry shared plugin data on creation, update from main, and merge (D-32, [10 §9.5](10-sync.md#proposal-mode)).
- **Build (S):** five small steps that write and read markers on the root and on a component (including a 90 kB chunk like `base:*`). The agent separately checks REST and the Figma MCP tool list for a creation path.
- **User steps:**
  1. In **Spikes Library** (a main file), run **S-17 ▸ Step 1**.
  2. Create a branch: file menu ▸ **Create branch…**, name it `spike-s17`. In the branch, run **Step 2**.
  3. Back in the main file, run **Step 3**.
  4. In the branch, accept **Update from main** when Figma offers it, then run **Step 4**.
  5. Merge the branch (**Review and merge**). In the main file, run **Step 5**. Copy results and paste (all steps are in one block).

#### B-34 · S-18 REST vs plugin snapshot

- **Question:** does REST `GET /v1/files/:key?plugin_data=shared` return every field the DCR normalizer needs; is plugin ↔ REST parity exact; can plugins write `devStatus` (absorbs S-14).
- **Build (M):** step 1 builds a page with groups, component properties, instances with overrides, bound variables, annotations with categories, prototype reactions (including `CHANGE_TO`), Sections, and root and node plugin data; it tries to set `devStatus`. Step 2 reads everything and outputs a per-node, per-field digest. The agent computes the same digest from REST with the same code.
- **User steps:**
  1. In a new file **Spikes REST**, run **S-18 ▸ Step 1**. If it says "could not mark Ready for dev", select the frame named **Screen** and click **Mark as ready for dev** in the right panel.
  2. Run **S-18 ▸ Step 2**. Paste results.
  3. Paste the file link. I will ask for a read-only Figma token through the secure form.

---

<a id="phase-1-items"></a>

## 7. Phase 1 work items

Goal: `holotype capture --story <id>` → bundle → plugin builds an absolute, pixel-faithful frame tree. Exit criteria in [14](14-roadmap.md) (Phase 1): on micro-fixtures excluding layout groups, p95 box error ≤1px, median `S_masked` ≥0.98, text line parity ≥95%, fonts preflight works, the fidelity ratchet is green.

Phase 1 items start once B-15 is merged, except where noted.

#### B-40 · `storybook` adapter v1: render loop and decorators

**Path** `packages/storybook` · **Depends** B-10, B-16 · **Runs** container · **Size** M

Build: channel render loop (`setCurrentStory`, `updateStoryArgs`, `updateGlobals`, [03 §5.2–5.3](03-storybook.md#render-loop-driver)), with the URL path as fallback; settle protocol ([03 §5.5](03-storybook.md#settle-protocol)); decorator unwrap and `keepLayout` ([03 §6.2](03-storybook.md#root)); portal detection basics ([03 §6.3](03-storybook.md#portals-and-overlays)); retries per [02 §1.3](02-architecture.md); the quirks found by S-07.

Acceptance: `pnpm -F @holotype/storybook test:e2e`: 50 sequential renders of different stories on one page with no reload; a story that throws gives `SB_STORY_ERROR` and the next render succeeds; `components-stack--wrap` keeps its layout.

#### B-41 · `capture`: composed tree and geometry

**Path** `packages/capture/src/{page/walk,page/collectors/geometry,cdp}` · **Depends** B-11, B-40 · **Runs** container · **Size** L

Build ([05 §3](05-capture.md#walk), §3.1–3.2, §8): composed-tree walk (open and closed shadow roots via the init hook, slots, `display:contents`); `data-fx-id` stamping and the CDP id map ([05 §2.3](05-capture.md#injection)); CDP box model and `getContentQuads` for transformed nodes; `affineFromQuad`; computed-style subset diffed against defaults; stacking contexts and paint order.

Acceptance: unit and property tests (quad → affine → quad); `test:e2e` snapshots for `micro-flex--*`, `micro-borders--uniform`, a closed-shadow micro story (add it to B-56 if not yet there); T0 check: every captured rect equals a live re-measure within 0.01px.

#### B-42 · `capture`: paint facts

**Path** `packages/capture/src/page/collectors/paint` · **Depends** B-41 · **Runs** container · **Size** M

Build ([05 §7](05-capture.md)): colors with colorjs.io (sRGB and P3, `original` text kept); background layers; gradient parsing (linear, radial, conic, repeating); box shadows; per-side borders and styles; radius per corner and elliptical; outline; clips and masks; opacity and blend modes. Codes `PAINT_*` from the catalog.

Acceptance: unit tests on gradient and shadow parsers; property test for in-gamut color round trips; `test:e2e` snapshots for every `micro-backgrounds--*` and `micro-borders--*` story.

#### B-43 · `capture`: text and fonts

**Path** `packages/capture/src/page/collectors/text`, `packages/capture/src/cdp/fonts.ts` · **Depends** B-41 · **Runs** container · **Size** L

Build ([05 §4](05-capture.md)): inline formatting contexts → one text block with styled runs; lines from range rects; whitespace and `text-transform`; `lineHeightPx` per style; CDP `CSS.getPlatformFontsForNode` for the used face ([05 §4.3](05-capture.md#fonts)); web-font inventory with `src` and status; `TEXT_*` and `FONT_*` codes.

Acceptance: unit tests (whitespace collapse, run splitting); `test:e2e` snapshots for `micro-text--*` and `components-card--long-text`; line counts equal the browser's on all text micro-fixtures.

#### B-44 · `capture`: replaced content, SVG, pseudo-elements, rasters

**Path** `packages/capture/src/{page/collectors/replaced,assets}` · **Depends** B-41 · **Runs** container · **Size** L

Build ([05 §5](05-capture.md#images)): images (fetch through `Network.getResponseBody`, transcode WebP/AVIF/SVG-as-img to PNG and downscale to ≤4096 with sharp, dedupe by sha256); inline SVG serialization with styles inlined; `::before`/`::after`/`::marker`/`::placeholder` via CDP ([05 §5.5](05-capture.md)); basic form controls ([05 §5.3](05-capture.md#controls)); canvas, video poster and 3D transforms rasterized with `Page.captureScreenshot` clip.

Acceptance: `test:e2e` snapshots for `micro-backgrounds--image-cover`, `components-icon--default`, `components-input--default` (placeholder), `components-card--with-media`; asset dedupe test (two stories, one image, one asset).

#### B-45 · `mapper`: visuals

**Path** `packages/mapper/src/stages/visuals/**` · **Depends** B-12, B-22, B-24 (S-03, S-05 reports) · **Runs** container · **Size** L

Build ([07 §9–10](07-mapping.md#color)): fills from background layers; gradient → `gradientTransform` with the S-03 formulas; borders per D-16 as decided by S-05 (per-side colors decomposed into vectors, [07 §10.3](07-mapping.md#radius)); shadows and blurs with the S-03 factors; opacity, blend, clip, masks; transforms → `relativeTransform`; rasterization criteria ([07 §10.9](07-mapping.md)).

Acceptance: unit tests per CSS feature; L2 property tests for gradient math; L3 snapshots `CaptureDoc → Scene IR` for every Phase 1 micro-fixture.

Until S-03/S-05 reports land, start with the formulas in 07 and mark them `(verify)`; the formula constants live in one file so the report can change them in one line.

#### B-46 · `mapper`: text and font requests

**Path** `packages/mapper/src/stages/text/**` · **Depends** B-12, B-43 (snapshots), B-23 (S-04) · **Runs** container · **Size** M

Build ([07 §8](07-mapping.md)): runs → ranges covering all characters; style mapping (px line height, never AUTO, D-17); decorations; `wrapMode` (`reflow` default, `locked-lines` inserts U+2028 at browser breaks); `widthBuffer` from S-04; `SceneFontRequest` with style candidates ([07 §8.6](07-mapping.md#fonts)).

Acceptance: unit tests for range coverage and style-name candidates; L3 snapshots for `micro-text--*` and `components-card--long-text`.

#### B-47 · `mapper`: tree, SVG and images, naming, fallbacks

**Path** `packages/mapper/src/stages/{normalize,order,replaced,naming,emit}` · **Depends** B-12, B-44 (snapshots) · **Runs** container · **Size** M

Build ([07 §2, §7, §10.7, §12](07-mapping.md)): tree normalization; paint-order sort and hoisting of z-escapes; `svg`, `image` and `vector` nodes; naming chain (basic, unique siblings); `expect` on every node; invariant validation (`PLAN_INVARIANT_VIOLATION`).

Acceptance: L2 property test "simplification and hoisting keep every node's absolute rect"; L3 snapshots for SVG and image fixtures.

#### B-48 · `cli`: capture, export, doctor, reports

**Path** `packages/cli` · **Depends** B-13, B-40 · **Runs** container · **Size** M

Build ([11 §3](11-ux.md)): `capture` with `--only`, `--story`, `--out`, `--debug-capture`, `--fail-on`, `--concurrency`, `--json`, `--ndjson`; `export` from a capture directory; `doctor` checks 1, 2, 4, 5, 6, 10, 11, 13 of [11 §3.4](11-ux.md); `report.json` and a static `report.html` ([12 §7.1](12-quality.md#observability)); the progress region and summary table; config loading with c12 (`PLAN_CONFIG_*`, `SEC_SECRET_IN_CONFIG`).

Acceptance: `test:e2e`: capture every Phase 1 micro-fixture into one bundle; `--json` and `doctor --json` snapshots; exit codes 0, 1, 2, 3 tested; `report.html` opens with no network request.

#### B-49 · Plugin: fonts preflight and Fonts screen

**Path** `packages/plugin/src/{apply/preflight,ui/fonts}` · **Depends** B-14 · **Runs** container (tests), needs Figma desktop (B-58) · **Size** M

Build ([09 §5.1](09-plugin.md#preflight), [11 §6.5](11-ux.md)): collect every FontName; `listAvailableFontsAsync` once; resolve exact → saved mapping (root `holotype/fontmap`) → style-name table → fallback; Fonts screen to map or accept; `FONT_MISSING`, `FONT_SUBSTITUTED`; loads in parallel batches of 16.

Acceptance: unit tests on resolution order; UI tests for empty (all fonts present), loading, missing-fonts, error; a saved mapping is reused on the next import (fake test).

#### B-50 · Plugin: absolute applier, complete

**Path** `packages/plugin/src/apply/write/**` · **Depends** B-14, B-54 · **Runs** container · **Size** L

Build ([09 §6](09-plugin.md#apply-order), §6.3): every Phase 1 Scene field: gradients, images (`createImage`, sha → hash map on root), SVG (`createNodeFromSvg`, unwrap, raster fallback with `SVG_IMPORT_FAILED`), vectors, per-side stroke weights, dash, radii, effects, masks, `relativeTransform`; new arrays for every paint; asset pull (`need` asset) once per sha.

Acceptance: L3 snapshots `Scene IR → fake` for every Phase 1 micro-fixture; zero fake throws; an order-fuzz test that shuffles independent writes and never throws ([09 §18](09-plugin.md#testing)).

#### B-51 · Plugin: text writer and line parity

**Path** `packages/plugin/src/apply/write/text.ts`, `src/apply/verify/text.ts` · **Depends** B-14, B-54 · **Runs** container · **Size** M

Build ([09 §6.1](09-plugin.md#text), [§11.1](09-plugin.md#text-check)): base font first, characters before ranges, per-range styles, sizing last; line-count check; width buffer up to `widthBuffer.max`; `TEXT_WIDTH_BUFFERED`, `TEXT_LINE_MISMATCH`.

Acceptance: fake tests in oracle and metric modes; L3 snapshots for `micro-text--*`.

#### B-52 · Plugin: read-back, report, progress, fidelity export

**Path** `packages/plugin/src/{apply/verify,apply/schedule,ui/report,ui/progress,export}` · **Depends** B-50, B-51 · **Runs** container (tests), needs Figma desktop (B-57) · **Size** L

Build: geometry read-back per variant against `expect` (absolute only, no relax step yet, [09 §11](09-plugin.md#verify)); time slicing, progress, cancel ([09 §12](09-plugin.md#schedule)); Report tab with diagnostics grouped by code and a link to each docs page ([11 §6.9](11-ux.md)); Progress screen ([11 §6.8](11-ux.md)); fidelity export to a downloadable zip of PNGs + boxes ([09 §14](09-plugin.md#fidelity)).

Acceptance: fake tests (an injected 2px error raises the right diagnostic; cancel mid-component leaves a partial status); UI tests for each Report and Progress state; `pnpm size` within budget.

#### B-53 · Plugin: import flow polish and error states

**Path** `packages/plugin/src/ui/import/**` · **Depends** B-49, B-52 · **Runs** container · **Size** S

Build: the full error table of [11 §6.11](11-ux.md) that applies to file import (version mismatch, no edit access, corrupt file, bundle rejected by safety limits from [06 §9](06-ir.md)); "Import another file"; keyboard and contrast checks ([11 §6.13](11-ux.md)).

Acceptance: one UI test per error row; an axe accessibility check on each screen.

#### B-54 · `figma-fake` v2

**Path** `packages/figma-fake` · **Depends** B-06 · **Runs** container · **Size** M

Build: everything in [§5.1](#figma-fake) not done in B-06: text metric model and oracle mode, image hashes, SVG → vectors, `exportAsync` placeholder, `getStyledTextSegments`, the op-log JSON format used later for conformance replay.

Acceptance: contract tests for every new member; `typecheck` against `FigmaPort`.

#### B-55 · Fidelity tool: T0, T1, T2 and the ratchet

**Path** `tools/fidelity` · **Depends** B-01, B-48 · **Runs** container · **Size** L

Build ([12 §4](12-quality.md#fidelity-harness)): T0 (Capture IR vs live re-measure; Scene absolute geometry vs Capture IR); T1 scoring from read-back boxes and line counts; T2 SSIM (ssim.js) and pixelmatch with text masking (`S_full`, `S_masked`); composite `F(v)`; `fidelity/baseline.json` and the ratchet rules of [12 §4.3](12-quality.md#fidelity-harness); a static HTML dashboard. CLI: `holotype-fidelity score --bundle <zip> --figma-export <zip>`.

Acceptance: unit tests on scoring with synthetic images (identical → 1.0; known shift → known score); T0 runs in CI on every PR for all micro-fixtures; a ratchet test fails on a seeded regression.

#### B-56 · Micro-fixtures, batch 2

**Path** `fixtures/ds-react/src/micro/**` · **Depends** B-04 · **Runs** container · **Size** M

About 90 more stories from [12 §2.2](12-quality.md#fixtures) for the Phase 1 groups: effects, transforms, clipping, svg, images, pseudo, shadow DOM (open, closed, slots), positioning, extended typography, portals. Layout groups (grid, sizing) wait for Phase 2.

Acceptance: smoke test green; id snapshot updated; every story listed in a table in `fixtures/ds-react/README.md` with the feature it isolates.

#### B-57 · Real-Figma fidelity run

**Path** `tools/harness/manual.md`, `tools/fidelity/baseline.json` · **Depends** B-52, B-55, B-56 · **Runs** container + **needs Figma desktop** · **Size** S

Container: build `phase1-all.holotype.zip` with every Phase 1 micro-fixture, and the plugin zip.

User steps:
1. Update the Holotype plugin folder with the new zip I send (unzip over it).
2. In a new file, run Holotype ▸ **Import file** ▸ drop `phase1-all.holotype.zip`. Wait for **Done**.
3. Open **Report** ▸ **Check fidelity** ▸ **Save export**. Upload the saved file to `spikes/results/` on GitHub (Add file ▸ Upload files), or send it however you prefer.

Container again: score it, write `baseline.json` v1, and report the three Phase 1 metrics.

Acceptance: metrics meet the Phase 1 exit criteria, or each miss has an issue with a diagnostic code. A self-hosted macOS runner ([12 §4.4](12-quality.md#harness)) is **not** assumed: until the user decides to provision one, this manual run replaces "nightly" (see [§10](#plan-gaps)).

#### B-58 · M1 usability check

**Path** PR description only · **Depends** B-53, B-57 · **Runs** **needs Figma desktop** · **Size** S

The boss imports a bundle that uses one font not installed in Figma and finishes the import without help (D-40). Steps for the boss: install the new plugin zip; Import file; follow what the plugin says. Then reply with: time taken, anything confusing, and whether the result looked like the Storybook.

Acceptance: done without help in ≤5 minutes; every confusing point becomes an issue.

---

<a id="later-phases"></a>

## 8. Phases 2 to 4.5: outline

Each row becomes a full item (same fields as above) when its phase starts. **Runs** is container unless marked **F** (needs Figma desktop).

### 8.1 Phase 2: native structure (M2)

| ID | Package / path | Depends | What | Size |
|---|---|---|---|---|
| B-60 | `layout-sim` stack + wrap | B-01, B-27 | `simulateAutoLayout`, `measureHug` ([07 §6.1](07-mapping.md#verification)); property test `simulate(spec(rects)) == rects` | L |
| B-61 | `layout-sim` grid | B-60, B-27 | `simulateGrid`, calibrated with S-10 data | M |
| B-62 | `capture` authored styles | B-41 | Typed OM keywords, CDP matched styles (`fr`, `flex`, `calc`) ([05 §6](05-capture.md#authored)) | L |
| B-63 | `capture` layout probing | B-62 | re-measure at N widths ([05 §11](05-capture.md#probing)) | M |
| B-64 | `mapper` flex/block → auto layout | B-60, B-62 | container classification, mapping table, sizing, margin strategies, absolute children ([07 §3–4](07-mapping.md#border-padding)) | L |
| B-65 | `mapper` grid | B-61, B-64 | [07 §5](07-mapping.md) mapping and fallback chain | M |
| B-66 | `mapper` verification + fallback emission | B-64 | `TOL_SIM` check, per-container `fallback` (D-15) | M |
| B-67 | `mapper` simplification + naming chain | B-64 | [07 §11–12](07-mapping.md) | M |
| B-68 | `mapper` text sizing and wrap modes | B-46 | [07 §8.3–8.5](07-mapping.md) with S-04 policy | M |
| B-69 | `figma-fake` layout | B-54, B-60 | [§5.2](#figma-fake) members and throw rules | M |
| B-70 | plugin auto-layout writer + relax/fallback | B-52, B-69 | write order of [09 §6](09-plugin.md#apply-order), relax steps and absolute fallback of [09 §11](09-plugin.md#fallback) | L |
| B-71 | fixtures: layout micro + dogfooding pipeline | B-56 | grid and sizing micro-fixtures; pinned MUI and shadcn sandboxes in `fixtures/real/lock.json` | M |
| B-72 | **F** M2 fidelity run | B-70, B-71 | B-57 procedure; auto-layout coverage ≥75%, generic names ≤5% | S |

### 8.2 Phase 3: components and variants (M3)

| ID | Package / path | Depends | What | Size |
|---|---|---|---|---|
| B-73 | `storybook` metadata + globals | B-40 | `describe()` per [03 §4](03-storybook.md#metadata-extraction), themes discovery ([03 §8](03-storybook.md#themes)), many variants per page | L |
| B-74 | `capture` pseudo-states | B-41, B-17 | strategies of [05 §9](05-capture.md#pseudo-states) per S-08 | M |
| B-75 | `planner` matrix + budgets | B-73 | sources priority D-12, matrix, `if` pruning, pairwise, budgets ([04 §2, §5](04-variant-model.md#budgets)), config merge (README §7) | L |
| B-76 | `planner` classification | B-75, B-74 | render-and-diff (D-13), states axis (D-30), dedupe ([04 §4](04-variant-model.md#classification), [§6](04-variant-model.md#states)) | L |
| B-77 | `mapper` alignment + property binding | B-67 | superset trees (D-27, [07 §13](07-mapping.md#alignment)), [07 §14](07-mapping.md) | L |
| B-78 | `figma-fake` components | B-69 | [§5.3](#figma-fake) | M |
| B-79 | plugin sets, properties, doc frames, sections | B-70, B-78 | [09 §7–9](09-plugin.md#sets) | L |
| B-80 | plugin Library tab, Import config, Connect/pair | B-79, B-81 | [11 §6.1–6.4](11-ux.md) | L |
| B-81 | `cli` `init`, `list --plan`, `serve` | B-48, B-20 | pairing, Host check, ports per S-01, streaming ([02 §4](02-architecture.md#protocol), [13 §2.1](13-security-legal.md#local-server)) | L |
| B-82 | `storybook-addon` types | B-01 | typed `parameters.holotype` | S |
| B-83 | fixtures: Checkbox + golden set tests | B-03 | add Checkbox to ds-react (Phase 3 exit names it) | S |
| B-84 | **F** M3 alpha + usability | B-80, B-81 | Button/Input/Checkbox/Card as sets, ≥70% property quality; first-run ≤5 min | S |

### 8.3 Phase 4: sync (M4)

| ID | Package / path | Depends | What | Size |
|---|---|---|---|---|
| B-85 | plugin `normalize/` (the `ah` normalizer) | B-79 | per-group read-back normalizer and `fnv1a64` sub-hashes ([10 §9.1](10-sync.md#designer-edits)). **Isomorphic module**, reused by proposal mode and by `dcr` | M |
| B-86 | plugin identity index + root registry | B-79 | [10 §2–3](10-sync.md#keys), chunked registry | M |
| B-87 | plugin apply plan + reconciler | B-85, B-86, B-21 | [10 §5, §8](10-sync.md#reconcile) obeying the S-02 rules; Merkle skip | L |
| B-88 | plugin conflicts, locks, deprecation, renames | B-87 | [10 §6–7, §9](10-sync.md#deprecation) | L |
| B-89 | plugin Diff preview + Conflicts screens | B-87 | [11 §6.6–6.7](11-ux.md) | M |
| B-90 | `figma-fake` instances + override model | B-78, B-21 | [§5.4](#figma-fake) | M |
| B-91 | `cli` capture cache + `serve --watch` | B-81 | cache keys of [02 §5.4](02-architecture.md) | M |
| B-92 | L6 sync suite | B-88, B-90 | T-01…T-25 of [10 §12](10-sync.md#test-suite) on the fake | L |
| B-93 | **F** L6 Figma semantics run | B-92 | the F-layer rows of 10 §12; override retention 100% | S |

### 8.4 Phase 4.5: DCR MVP (M4.5)

| ID | Package / path | Depends | What | Size |
|---|---|---|---|---|
| B-94 | `ir`/`dcr` DCR schemas | B-01 | `FigmaSnapshot`, `BaselineSnapshot`, `DesignChangeRequest` in TypeBox ([15 §3.3, §4.1, §6](15-change-requests.md#dcr-ir)) | M |
| B-95 | `dcr` core | B-94, B-85 | identification, field diff + noise filter, classification for `component.modified`, `variant.*`, `property.*`, `node.*`, `component.new`; reverse mapping VARIANT/BOOLEAN/TEXT; stable ids; canonical output ([15 §4](15-change-requests.md#extraction)) | L |
| B-96 | `dcr` screens + content | B-95 | screen grouping, interactions, copy vs placeholder, a11y, `instance.outdated/deprecated` ([15 §4.10–4.13](15-change-requests.md#screens)) | L |
| B-97 | `dcr` renderers | B-95 | `renderPrompt`, `renderSnippet`, review summary, D-38 escaping ([15 §7](15-change-requests.md#prompt)) | M |
| B-98 | `dcr` REST normalizer | B-95, B-34 | `normalizeRest` per the S-18 table; parity fixture | M |
| B-99 | `fixtures/dcr/*` + shuffle test | B-95 | the cases of [12 §2.4](12-quality.md#dcr-fixtures) | M |
| B-100 | capture/mapper branch mode | B-19, B-62 | `styleSheetId` + ranges, `provenance/<sid>.json` ([15 §5](15-change-requests.md#provenance)) | L |
| B-101 | `vite-plugin` | B-19 | `data-holotype-loc` (dev only) | S |
| B-102 | plugin proposal mode | B-87, B-85 | `branch:meta`, `base:*` writes, no `SYNC_CONFLICT` ([09 §20](09-plugin.md#proposal)) | L |
| B-103 | plugin Changes / Submit / preview | B-102, B-97 | [11 §6.14–6.16](11-ux.md#changes) with all four states | L |
| B-104 | `cli` branch + dcr + login | B-100, B-98, B-91 | `branch start\|link\|refresh\|close`, `dcr`, `login --figma`, `POST /v1/dcr` | L |
| B-105 | `cli` MCP DCR tools | B-104 | `design_changes`, `dcr_item`, `dcr_item_assets`, `list_dcrs` | M |
| B-106 | fixtures: ds-react branch with designer edits | B-99 | the fixture branch of [14](14-roadmap.md) Phase 4.5 | S |
| B-107 | **F** M4.5 usability | B-103, B-104 | the exit criteria of Phase 4.5 with the boss | S |

Phase 5 (tokens) and later are outside this file. DCR `token.*` items wait for Phase 5.

---

<a id="ordering"></a>

## 9. Merge and ordering plan

### 9.1 Waves (Phase 0 and Phase 1)

Items in one wave touch different paths and can run in parallel worktrees.

| Wave | Items | Starts when |
|---|---|---|
| 0 | B-00 (in progress) | now |
| 1 | B-01, B-02, B-03, B-06, B-07, B-08 | B-00 merged |
| 2 | B-04, B-05, B-09, B-10, B-12, B-54; spike kits B-20…B-34 | B-01 + B-03 (fixtures), B-08 (kits) |
| 3 | B-11, B-14, B-16 | B-10 (B-11), B-06 + B-07 (B-14) |
| 4 | B-13, B-17, B-18, B-19 | B-11 + B-12 |
| 5 | B-15 (M0 smoke) | B-04, B-13, B-14 |
| 6 | B-40, B-41, B-55, B-56 | B-15 |
| 7 | B-42, B-43, B-44, B-45, B-47, B-48, B-49 | B-41 (capture), B-12 + spike reports (mapper) |
| 8 | B-46, B-50, B-51 | B-43, B-54 |
| 9 | B-52, then B-53 | B-50, B-51 |
| 10 | B-57, then B-58 (M1) | B-52, B-55, B-56 |

Path splits that make the parallel capture, mapper and plugin items safe: each collector, stage and writer has its own folder and registers itself with one appended line ([§2.3](#conventions)).

**Dispatch the spike kits early (wave 2).** User time, not agent time, is the scarce resource in Phase 0. The kits should reach the user in two batches: batch A (S-01, S-03, S-04, S-05, S-06, S-09, S-10, S-13) needs only **Spikes Scratch**; batch B (S-02, S-12, S-15, S-16, S-17, S-18, S-11) needs the library files, a branch, a token or the MCP connector.

### 9.2 Critical path

```
B-00 → B-01 → B-10 → B-11 → B-13 → B-15 (M0 demo)
                              ↓
               B-41 → B-43 → B-46 → B-51 → B-52 → B-57 → M1
```

- **To the first visible demo (a Storybook component in Figma):** B-00 → B-01 → B-10 → B-11 → B-13 → B-15, with B-06/B-07 → B-14 and B-03/B-04 joining at B-15. Nine items, all container except the user's final check.
- **To M1:** text is the longest chain (capture text → mapper text → plugin text → read-back → real-Figma run). S-04 (B-23) feeds B-46, so its user run is on the critical path. Send it in batch A.
- **M0 exit** also needs all 18 spike reports. The slowest are the library and branch spikes (batch B), which depend on the user's calendar.

### 9.3 First DCR demo

**Planned path (Phase 4.5):** M1 → Phase 2 → Phase 3 (B-79 sets) → Phase 4 (B-85 normalizer, B-87 reconciler) → B-102 proposal mode → B-95 + B-97 → B-103 Submit. The demo: the designer changes Button padding in a branch file, presses Submit, and gets `prompt.md` with a `component.modified` item.

**Optional fast track (needs a user decision).** `component.modified` needs neither variants nor the reconciler, only managed nodes with `nk` (written since B-14), the normalizer and a baseline. So right after M1 the coordinator can run:

1. B-85 (normalizer) early: it is a pure module reused unchanged by Phase 4.
2. B-94 + a cut of B-95 (`component.modified` only) + a cut of B-97 (`renderPrompt` only), all pure and container-only, tested on two hand-built `fixtures/dcr` cases.
3. A minimal `base:*` write after read-back and a "Copy prompt" button in the Report tab (a slice of B-102/B-103, behind a dev flag).

That gives a DCR demo on a single-variant component about three items after M1, and de-risks the flagship (determinism, normalizer parity, prompt shape) before Phases 2–4. Nothing built in the fast track is thrown away.

**"Paper" demo, any time after B-97:** `holotype dcr --from-fixture fixtures/dcr/modified-padding` prints the prompt. It shows the agent-facing output with no Figma.

---

<a id="plan-gaps"></a>

## 10. Plan gaps and choices made here

These are inconsistencies between chapters (or with the brief) that the build hits. The choice in the right column applies until the plan is fixed. Line numbers are as of 2026-11-19.

| # | Gap | Where | Choice in this file |
|---|---|---|---|
| 1 | Fixture path: `fixtures/react-sb/` vs `fixtures/` and `fixtures/micro/` | 02-architecture.md:432; 12-quality.md:47, 69 | `fixtures/ds-react/` (one Storybook), micro stories in `fixtures/ds-react/src/micro/` |
| 2 | Packages `dcr` and `vite-plugin` are in README §6 but missing from the monorepo tree, the API table and the dependency rules | 02-architecture.md:411-467 | Add both in B-00; `dcr` may import `ir`, `shared`, `layout-sim` |
| 3 | The plugin may bundle only `ir`, `shared`, `layout-sim`, but the plugin UI runs `dcr.extract` | 02-architecture.md:464; 09-plugin.md:883; 15-change-requests.md:175 | Allow `dcr` in the plugin **UI** bundle only (main stays as is) |
| 4 | The mapper takes `VariantPlan` (planner) and `ComponentMetaInput` (storybook), but may import neither | 07-mapping.md:17-26; 02-architecture.md:460 | Put these input types in `ir/pipeline.ts` (B-01) |
| 5 | `HolotypeParams` has `additionalProperties:false` and no `implements`, yet D-37 requires `parameters.holotype.implements`; `replacedBy` is also referenced | 04-variant-model.md:414-490; 15-change-requests.md:997; 12-quality.md:567 | Add `implements?` and `replacedBy?` in B-01 (D-37 wins) |
| 6 | Scene IR field names in the applier sketch differ from 06 (`s.w`, `s.x`, `s.transform`, `s.bindings`, `s.clip`, `layout.grid.rows`, `counterSpacing`, `primaryAlign`, `padding` as array, text `runs`/`size`) | 09-plugin.md:313-361, 371-397 | Use 06 names (`size.w`, `xy`, `relativeTransform`, `bind`, `clipsContent`, `columns`, `counterAxisSpacing`, `primaryAxisAlignItems`, `padding.{t,r,b,l}`, `ranges`, `fontSize`) |
| 7 | Capture IR field names in the fill contract differ from 06 (`meta`, `styles`, `customProps`, `screenshot`, `CaptureNode`, `fxId` vs `target`, `textStyles`, `customProperties`, `CNode`) | 05-capture.md:593-611; 06-ir.md:60-87 | 06 wins |
| 8 | Two manifest shapes: 02 has `integrity` and per-component `sceneHash`; 06 has neither; 09 checks `manifest.components[sid].sha256` and `manifest.irVersion` | 02-architecture.md:333-346; 06-ir.md:611-631; 09-plugin.md:151, 235 | 06 shape plus `integrity` (B-01); the plugin checks `integrity.files` and `sceneVersion` |
| 9 | Two `report.json` shapes (`BundleReport` vs `RunReport`) | 06-ir.md:679-689; 12-quality.md:578-596 | B-01 ships 06 `BundleReport`; reconcile before Phase 7 (`action`) |
| 10 | Canonical rounding: 1/1000 px vs 1/256 px | 06-ir.md:705; 12-quality.md:40 | 1/1000 (06) |
| 11 | Pairing: 6-digit code + `/v1/pair/start\|confirm` + WS `/v1/ws`, vs 6-word code + `POST /v1/pair` + `/v1/events?token=`, vs 6 chars `XXX-XXX` | 02-architecture.md:187-200, 211; 09-plugin.md:180-181; 11-ux.md:394 | 02 (protocol owner). Matters from B-81 |
| 12 | Exit codes: `4` = internal error vs `4` = browser failure, plus `5`/`6`/`130` | 02-architecture.md:625-630; 11-ux.md:154-168 | 11 (the fuller table) |
| 13 | `ah`: "h16" over canonical JSON vs FNV-1a-64; 7 groups listed but 6 sub-hashes concatenated (`inst` missing) | 10-sync.md:95, 423, 439; 06-ir.md:719; D-31 | FNV-1a-64 per group (D-31), 7 sub-hashes including `inst` |
| 14 | Variant and component `irh` formulas differ | 06-ir.md:729-730; 10-sync.md:489-491 | 06 |
| 15 | Capture cache: `.json.zst` + `cas/` vs `.json.gz` + `assets/`; two different capture key definitions | 05-capture.md:30; 02-architecture.md:385-401; 06-ir.md:727 | 02 (matters from B-91) |
| 16 | `@holotype/vite-plugin` is a Phase 4.5 deliverable in 14 but Phase 7 in 15 | 14-roadmap.md:153; 15-change-requests.md:1145 | Phase 4.5 (B-101), optional |
| 17 | S-17 runs "on Pro and Organization plans" vs "on the user's Organization account" | 15-change-requests.md:1155; 14-roadmap.md:67 | Organization only (B-33) |
| 18 | The spike runner is placed inside the product plugin, whose manifest id is fixed forever | 14-roadmap.md:44; 02-architecture.md:530 | A separate "Holotype Spikes" plugin (B-08) |
| 19 | Real-Figma fidelity assumes a self-hosted macOS runner with a bot account; D-39 describes a two-person private setup | 12-quality.md:176; README D-39 | A manual run on the user's Mac (B-57) until the user decides on a runner |
| 20 | Spikes that need Figma: the brief listed 10; 14 implies 15 (S-03, S-04, S-09, S-11 and the S-13 plugin half also need Figma) | 14-roadmap.md:52-69 | All 15 have kits in [§6.4](#spike-kit) |
| 21 | Phase 1 dev-plugin imports in browsers: dev plugins load from local files, so browser rows of S-01 may need a private org publish | 02-architecture.md:567; 14-roadmap.md:52 | Desktop first; browser rows optional (B-20 step 5) |
