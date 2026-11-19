# Holotype: master plan

> **Status:** planning, v0.1 (2026-11-18). Nothing is implemented yet.
> **Name:** **Holotype** (D-01). The repository is still called `figmabook` and must be renamed before any public release: Figma's trademark guidelines forbid "Figma"/"Fig" in a product name, domain or handle (see [13](13-security-legal.md#trademark)). These steps belong to the public track ([13](13-security-legal.md#publishing)).

Holotype gives a design team a **code-aligned design branch whose edits become a verified AI implementation**. For each git feature branch it generates a Figma branch of the component library from the code (Storybook), so designers edit real, synced components and draw screens with them. On Submit, Holotype extracts a deterministic Design Change Request: what changed against the code baseline, which components are new, and how existing components are used, each with file:line provenance and tokens. An AI coding agent implements it, and `holotype verify` checks the result by re-rendering the new code.

The enabler is a native, editable, synced Figma library built from Storybook: real component sets with variants; boolean, text, instance-swap and slot properties; auto layout including grid; variables with modes; instances for nested components. Re-imports never lose designer overrides.

It overlaps with story.to.design (code → Figma) and with Figma MCP + Code Connect, Builder Fusion and Anima (design → agent → code). Its edge is the embedded code baseline, field-level diff, provenance and verify-by-re-render ([01](01-landscape.md)).

---

## How to read this plan

| # | Chapter | What it decides |
|---|---|---|
| 00 | **This file** | Vision, goals, non-goals, success metrics, **canonical decisions**, glossary, cross-chapter contracts |
| 01 | [Landscape & differentiation](01-landscape.md) | Competitor teardown (story.to.design, Figma code-to-canvas, Anima, Builder, Storybook Connect, Code Connect), our wedge |
| 02 | [System architecture](02-architecture.md) | Components, data flow, deployment topologies, monorepo, tech stack, CLI↔plugin protocol, bundle format |
| 03 | [Storybook integration](03-storybook.md) | Discovery, metadata extraction per SB version, render loop, readiness, root/portal detection, access & auth |
| 04 | [Component & variant model](04-variant-model.md) | How stories/args/states/themes/viewports become variants and component properties; `HolotypeParams` schema; budgets |
| 05 | [Capture engine](05-capture.md) | In-page serializer + CDP: composed tree, geometry, text, fonts, pseudo-elements, SVG, images, states, probing |
| 06 | [Intermediate representations](06-ir.md) | Capture IR, Scene IR, bundle layout, hashing, versioning, JSON Schema |
| 07 | [Mapping & inference](07-mapping.md) | CSS→Figma rules: layout inference + verification, sizing, text, visuals, tree simplification, naming, cross-variant alignment |
| 08 | [Tokens, variables & styles](08-tokens.md) | CSS custom properties → variables/aliases/modes; bindings; styles; matching existing libraries |
| 09 | [Figma plugin](09-plugin.md) | Plugin architecture, applier/reconciler, build order rules, components/sets/properties, nested instances, read-back verification |
| 10 | [Identity & sync](10-sync.md) | Stable keys, keyed in-place reconciliation, override preservation, conflict policies, renames/deletions, diff preview |
| 11 | [UX](11-ux.md) | CLI UX, commands and exit codes, plugin screens and flows, reports, error states |
| 12 | [Quality, fidelity & performance](12-quality.md) | Test pyramid, fixtures, fidelity harness and metrics, diagnostics catalog, perf budgets, observability |
| 13 | [Security, privacy, legal](13-security-legal.md) | Threat model, local/cloud security, trademark, licensing, publishing, business model |
| 14 | [Roadmap](14-roadmap.md) | Phases, de-risking spikes, milestones with exit criteria, risks, open questions |
| 15 | [Design change requests](15-change-requests.md) | Branch workflow, proposal mode, deterministic Figma → AI-prompt extraction (DCR IR), provenance, classification, agent contract, verification loop |
| 16 | [Configuration](16-config.md) | The complete holotype.config.ts schema: keys, types, defaults, validation, owning chapter |
| — | [Build plan](BUILD.md) | Executable build plan: work items, definition of done, the Loop slice, the Figma spike kit, merge order, plan gaps |
| — | [Plan review](REVIEW.md) | Record of the November 2026 review: findings, resolutions (D-46…D-58), rejected items, finding → file index |

Research inputs are kept under [`docs/research/`](../research/). Wherever a chapter cites an API, it uses the names verified there. Those names are current as of Nov 2026: `@figma/plugin-typings@1.142.0`, `storybook@10.6.7` / `11.0.0-beta.3`, and Playwright with Chromium.

Some facts are marked **(verify)** in the chapters. These are inferred or community-reported, and each one is assigned to a spike in [14](14-roadmap.md#phase-0).

---

## 1. Vision

> *Code is the source of truth for components. Design should get a faithful, living, editable mirror of it, with no manual redrawing and no drift.*

Design-system teams keep two libraries in sync by hand: Storybook in code, and a Figma library. Drift is constant. Existing tools fall short in different ways:

- They produce **flat layers**: Figma code-to-canvas, html.to.design.
- They **embed** stories without converting them: Storybook Connect.
- They are **closed, per-Storybook-priced, cloud-processed**, and explode every arg into a variant axis: story.to.design.

Holotype makes the Figma library a *build artifact* of the Storybook, produced locally or in CI, while staying a first-class editable Figma library.

## 2. Goals

- **G9 Deterministic design → AI prompt.** From any Figma file generated by Holotype (typically one file per git feature branch), extract **deterministically** everything an AI coding agent needs to implement the design: what changed in existing components (diffed against the exact code baseline, with source file / CSS rule / token provenance), which components are new (structure, tokens, nearest existing components), and how existing components are used in screens (component + props). Same Figma file + same baseline ⇒ byte-identical Design Change Request. The AI writes the code; we produce the precise, verifiable spec and check the result by regenerating Figma from the new code (see [15](15-change-requests.md)). This is the primary goal; G1–G8 serve it.
- **G1 Fidelity.** Every imported variant is visually equivalent to the browser render: per-node box error ≤1px at p95, and text-masked SSIM median ≥0.985 against the Playwright screenshot (§4) on the fixture corpus.
- **G2 Native structure.** Output is what a skilled designer would build:
  - auto layout (flex and grid) wherever it reproduces the geometry, and absolute positioning only where it must;
  - semantic layer names;
  - no wrapper noise.
- **G3 Real component model.**
  - Variant properties only for args that change *style*.
  - BOOLEAN, TEXT, INSTANCE_SWAP and SLOT properties wherever they faithfully represent an arg.
  - Nested components become instances of the imported components.
- **G4 Tokens.** CSS custom properties become Figma variables, with alias chains and theme modes, bound to fills, strokes, spacing, radii, typography and effects.
- **G5 Override-safe sync.**
  - Re-import updates main components *in place*. Instance overrides survive, and so do designer-owned additions.
  - Every change is previewed as a diff before it is applied.
- **G6 Automation.** Everything the plugin can import can be produced by a CLI or a GitHub Action from a static Storybook build. Agents can drive it through an MCP server.
- **G7 Open & private by default.**
  - MIT-licensed core.
  - Storybook content and credentials never leave the user's machine or CI unless they opt into a hosted service.
- **G8 Framework-agnostic.** Works with any Storybook renderer (React, Vue, Angular, Svelte, Web Components/Lit, HTML), because conversion operates on the rendered DOM. Framework hooks are only *enhancers*, used for component boundaries and names.

## 3. Non-goals (for v1)

- **Generating code ourselves.** We never emit component code. Figma → code goes through G9: we produce a deterministic Design Change Request (the *prompt input*), and an AI agent of the user's choice writes the code. We also generate Figma **Code Connect** mappings in a later phase, because we already know the arg ↔ property mapping.
- **Automatic two-way sync.** Design edits are never written to code without going through a change request and a human-reviewed PR. In the main library file, designer edits are protected as overrides; in branch files they are captured as *proposals* (see [15](15-change-requests.md)).
- **Clipboard-format hacks.** No reverse-engineered Kiwi/clipboard writing. Only the official Plugin API is used, plus Figma's MCP `use_figma` as an experiment (see [13](13-security-legal.md)).
- **Arbitrary websites and full pages.** The target is component stories. Full-page capture works incidentally but is not optimized.
- **Rendering inside the Figma plugin iframe.** This is proven non-viable (null origin, frame-ancestors, cross-origin DOM). See [02](02-architecture.md#topologies).
- **Non-Chromium capture engines.** We depend on CDP, for platform fonts, forced pseudo-states and box models.

## 4. Success metrics

Fidelity metrics are tracked from milestone L1 onward by the fidelity harness ([12](12-quality.md)); they become release-blocking from M5. G9 metrics are tracked from L4 and gate M-Loop ([14](14-roadmap.md#m-loop)). Until a metric gates, a regression is reported but does not block.

| Metric | Definition | v1 target |
|---|---|---|
| Visual fidelity | median and p10 text-masked SSIM (`S_masked`, see [12](12-quality.md)), Figma PNG export vs Playwright element screenshot @2x | median ≥0.985, p10 ≥0.95 |
| Geometry fidelity | p95 \|Δ\| of every node's Figma `absoluteBoundingBox` vs captured rect | ≤1px |
| Auto-layout coverage | share of IR containers emitted as auto layout (not absolute) and still passing verification | ≥85% on fixtures |
| Text line parity | share of text nodes whose Figma line count equals the browser's | ≥98% |
| Property quality | share of eligible args emitted as non-variant properties (BOOLEAN/TEXT/INSTANCE_SWAP/SLOT), measured over the fixtures | ≥70% |
| Override retention | share of instance overrides surviving a re-sync in the sync test-suite, when structure is unchanged | 100% |
| Capture throughput | median warm-page variant capture time (render, settle, serialize) | ≤400ms |
| Build throughput | plugin apply time for a 20-node variant | ≤60ms; 1,000 variants in ≤3 min without freezing the UI for more than 100ms |
| Re-sync cost | Figma writes on a no-op re-sync | 0 |
| Agent first-pass verify rate | share of DCR items `implemented` after one agent session, per item kind, on the agent-eval corpus ([12](12-quality.md#agent-eval)), ≥2 agents | ≥70% at M-Loop, ≥85% at M8 |
| False-change rate | items the designer did not intend, per 100 items, on the corpus | ≤2 |
| Provenance coverage | share of `component.modified` fields carrying a rule file:line (CSS modules) | ≥95%, 0 wrong files |
| Loop time | designer Submit → verified PR (median, real use) | tracked, no target before M-Loop |
| Bake-off margin | Holotype DCR vs Figma MCP + Code Connect on the same branch ([12](12-quality.md#bake-off)) | DCR ahead on verify rate and unrelated-diff size |

## 5. Canonical decisions

These are binding for every chapter. If a chapter disagrees with this table, this table wins and the chapter must be fixed. Status: ✅ decided, 🟡 provisional (revisit at the named milestone), ❓ open (needs the user, see §9).

<a id="decisions"></a>

| ID | Decision | Status |
|---|---|---|
| D-01 | **Public product name: Holotype** (user decision). CLI `holotype`, alias `holo`; npm scope `@holotype/*`; plugin-data namespace and Storybook parameter key `holotype`. A holotype is the single reference specimen a species is defined from: the code is the specimen, Figma gets the faithful copy. A formal USPTO/EUIPO trademark search is still required before any public listing. The GitHub repo (`figmabook`) is renamed before any public release. Listing title pattern: "Holotype — Storybook to components, plugin for Figma Design" | ✅ |
| D-02 | **License:** MIT for all packages in this repo (user decision). A future hosted service, if any, lives in a separate repo (closed source or FSL-1.1-MIT) | ✅ |
| D-03 | **Language/runtime:** TypeScript (strict) everywhere; **Node ≥22.12** (Node 20 is end of life since 2026-04-30; 20.19 is best-effort, untested), developed on Node 24 LTS; ESM only (D-53) | ✅ |
| D-04 | **Monorepo:** pnpm workspaces + Turborepo + changesets; Vitest; Biome (lint+format); tsup for Node packages. Core libraries: Hono + `ws` (local server), c12/jiti (config), citty (CLI), fflate (bundle zip), `@noble/hashes`, colorjs.io, fontkit + harfbuzzjs (font metrics), sharp (CLI only), sirv; dependency-cruiser enforces package boundaries. Plugin bundle budgets: main ≤400 KB, UI ≤600 KB (see [02](02-architecture.md)) | ✅ |
| D-05 | **Capture:** Playwright, **Chromium only**, browser version pinned per release (it is part of the cache key); CDP used directly | ✅ |
| D-06 | **Plugin build:** create-figma-plugin (esbuild + Preact UI; UI shown with its `showUI()` helper, `ui: build/ui.js`); `documentAccess: "dynamic-page"`; `enablePrivatePluginApi: true` (D-53); async APIs only; typings pinned. The toolchain has had no release since 2025-08; the fallback is plain esbuild plus a hand-written manifest | ✅ |
| D-07 | **Schemas:** TypeBox is the single source of truth, with JSON Schema emitted and published per major version | ✅ |
| D-08 | **Two IRs:** the *Capture IR* holds raw browser facts and stays CLI-side (cached). The *Scene IR* is the Figma-ready desired graph with absolute fallbacks embedded, and it is what ships to the plugin. Inference (the `mapper`) runs **CLI-side**, is pure and isomorphic, and is never written against the `figma` global | ✅ |
| D-09 | **Plugin = reconciler.** The plugin does not infer CSS. It applies the Scene IR by keyed in-place reconciliation, verifies by read-back, and falls back per container to the embedded absolute layout | ✅ |
| D-10 | **MVP topologies:** (A) local CLI server on loopback with a pairing token, and (B) bundle-file import (always available). Then (D) CI/GitHub Action + registry, then (C) optional hosted renderer. (E) in-iframe rendering is rejected. The Loop slice uses (B) only: bundles in, `request.zip` out (D-49). (A) arrives in hardening. Until the registry exists (D), CI output reaches Figma as a downloaded `.holotype.zip` (Import file) | ✅ |
| D-11 | **Storybook support:** **10.x is the primary, first-class target** (user decision): all fixtures, dogfooding and release gates run on it. 11.x is tracked from beta and becomes first-class at its GA. 8.x/9.x are best-effort: the adapter keeps their code paths and CI runs a smoke test only. 7.x and older are not supported. Static build is the reference target; dev server is supported. Until M-Loop only SB 10.x on the owner's repo and `fixtures/ds-react` is tested; SB 8/9 smoke and SB 11 tracking start in hardening | ✅ |
| D-12 | **Variant source priority:** curated config > `parameters.holotype` > stories-as-variants > args matrix. The default is *not* a blind Cartesian product (see [04](04-variant-model.md)) | ✅ |
| D-13 | **Property classification:** each arg is classified VARIANT / BOOLEAN / TEXT / INSTANCE_SWAP / SLOT / FIXED by **render-and-diff verification**, not by type alone | ✅ |
| D-14 | **Pseudo-states:** CDP `CSS.forcePseudoState` on the target and its ancestor chain by default; real Playwright interaction as a per-component fallback or option; the storybook-addon-pseudo-states global when that addon is installed; drop states with no visual effect | ✅ |
| D-15 | **Layout policy:** absolute positioning is the always-correct baseline. Auto layout or grid is emitted per container only if the capture-side simulation passes (`TOL_SIM` ≤0.6px), and it is kept only if the plugin read-back passes (`TOL_READBACK` ≤1px). On read-back failure the plugin relaxes step by step (text width buffer → HUG→FIXED → FILL→FIXED) before the full absolute fallback. Failures fall back *per container*, never per document. `SPACE_EVENLY`/`SPACE_AROUND` are approximated until spike S-10 confirms parity | ✅ |
| D-16 | **Borders:** CSS border maps to an INSIDE stroke. Padding in the Scene = CSS padding + border width with `strokesIncludedInLayout:false` (exact). Per-side colors are decomposed | 🟡 (spike S-05) |
| D-17 | **Text:** one TEXT node per inline formatting context, with styled ranges. Explicit px line-height, never Figma "Auto". Fonts resolved via CDP `CSS.getPlatformFontsForNode`. Default wrap mode `reflow`, with `locked-lines` as an option | ✅ |
| D-18 | **Tokens:** a binding is created only when the value is *provably* produced by a `var()` chain (CDP matched styles). Value-equality matching is opt-in and flagged low-confidence. Existing library variables are matched by `codeSyntax.WEB`, then by name, before anything new is created. Generated values never silently overwrite existing variable values | ✅ |
| D-19 | **Identity:** shared plugin data under the namespace `holotype`. Keys `sid` (component), `vk` (variant), `nk` (node), `irh` (subtree hash), `ah` (applied hash), `v` (schema version). `v` = `"<irMajor>.<applierEpoch>"` (epoch bumps when a plugin fix changes output for the same input). Each key is a separate entry so `nk` can be indexed; the index skips nodes inside instances. Identity is always in **shared** plugin data: REST DCR reads and `holotype status` depend on it (a private-storage option was considered and rejected). `holotype` is final (D-01); `SYNC_LEGACY_NAMESPACE` is reserved for a future rename and not emitted. No delete-and-recreate of managed nodes, ever | ✅ |
| D-20 | **Deletions:** a removed story leads to deprecation (moved to a "Deprecated" page and renamed), never a hard delete while instances may exist | ✅ |
| D-21 | **Nested components:** detected in priority order: framework boundaries (React fiber `type`, Vue `__vueParentComponent`, Angular `ng.getComponent`, custom-element tag), matched to Storybook `component` references, then structural subtree hash. Each is emitted as an instance only if the instance render matches within tolerance | ✅ |
| D-22 | **File organization:** page "Components" (configurable), with one Figma Section per top-level title segment, and each component set laid out with a documentation frame. Also pages "Icons" and "Deprecated". The root registry is stored in `figma.root` shared plugin data as `registry:meta` + `registry:0..N-1` chunks ([10](10-sync.md#registry)) | 🟡 (M2) |
| D-23 | **Telemetry:** off by default and opt-in, anonymous aggregates only; honours `DO_NOT_TRACK`; off in CI | ✅ |
| D-24 | **Default capture environment:** DPR 2, viewport 1280×800, `reducedMotion: reduce`, user agent suffixed `StorybookTestRunner` (Storybook then pauses CSS animations and transitions instead of waiting; finite Web Animations are finished by the capture engine), locale `en-US`, timezone `UTC`, Date frozen at `2026-01-01T00:00:00Z` via `page.clock.setFixedTime` (timers and rAF stay real), seeded `Math.random`, Chromium `--font-render-hinting=none`. Stories render with `layout: 'fullscreen'` and decorator padding stripped unless `keepLayout` is set (see [05](05-capture.md)) | ✅ |
| D-25 | **Local server ports:** a fixed list of 3 loopback ports declared in the manifest (default `127.0.0.1:47321-47323`) | 🟡 (spike S-01) |
| D-26 | **Primary target stack:** React + Vite (`@storybook/react-vite`) on Storybook 10 (user decision). Every fixture, golden test, spike and dogfooding project uses it until M5. The DOM-based pipeline stays framework-agnostic (G8), but other renderers (Vue, Lit, Angular, Svelte, HTML) are *best-effort, untested* until they get fixtures in a later phase; framework-specific enhancers (D-21) ship for React first | ✅ |
| D-27 | **Superset trees:** every variant in a set contains the aligned union of nodes (by `nk`); nodes absent in a variant are emitted as hidden placeholders. BOOLEAN bindings and variant switching then keep instance overrides (see [07](07-mapping.md#alignment)) | ✅ |
| D-28 | **Variant budgets:** per set `budget.warn` 128, `budget.max` 256, `hardLimit` 1024 variants; `maxProbes` 120 classification renders. Probe renders classify args and are never emitted as variants (see [04](04-variant-model.md#budgets)) | 🟡 (spike S-06) |
| D-29 | **Default conflict policy: "Keep mine".** When a designer edited a managed node and the code changed it too, the node is skipped and flagged (`SYNC_CONFLICT`); the user resolves it in the diff preview. Designers can also `lock` any node (see [10](10-sync.md)) | ✅ |
| D-30 | **States axis:** `disabled`/`loading`/`invalid` args and pseudo-states fold into one `State` variant axis instead of separate boolean axes, unless config says otherwise (see [04](04-variant-model.md)) | ✅ |
| D-31 | **Hashing split:** producers (CLI) compute every content hash (`vk`, `irh`, asset sha256). The plugin has no `crypto.subtle`, so it only computes `ah` with pure-JS FNV-1a-64. `ah` = 7 per-group FNV-1a-64 sub-hashes (D-52) | 🟡 (spike S-06) |
| D-32 | **Branch files: Figma-native branching** (user's plan supports it: the files already show branches). Each git feature branch maps to a Figma branch of the main library file. Branch creation happens in the Figma UI, or is automated if spike S-17 finds an API. The link is stored in root `branch:meta` and in `.holotype/branches/`. The duplicated-file mode stays as a fallback for accounts without branching. Branches are never merged back (D-47). Branch *creation* has no API; files do: REST `POST /v1/files/:key/duplicate` (Enterprise, private OAuth app, scope `file_duplicate:write`) and the Figma MCP `create_new_file` can automate the duplicated-file fallback (S-17) (see [15](15-change-requests.md)) | ✅ |
| D-33 | **Proposal mode.** In branch files, designer edits to managed nodes are proposals, not conflicts. Library files keep D-29 (see [15](15-change-requests.md)) | ✅ |
| D-34 | **Embedded baseline.** In proposal mode, the applier stores a compressed, normalized applied snapshot per variant (`base:*`, same normalizer as `ah`). The DCR is diffed against that snapshot, never against the Scene IR's intent (see [15](15-change-requests.md)) | ✅ |
| D-35 | **Deterministic DCR.** The extraction is a pure function with no LLM, clock or randomness, using canonical JSON, stable item ids and asset bytes outside the hash. The same file version and baseline give a byte-identical `dcr.json` and `prompt.md` (see [15](15-change-requests.md)). The hash covers the DCR core only (D-50) | ✅ |
| D-36 | **Provenance.** Branch mode captures from the Vite dev server; the CLI forces `css.devSourcemap: true` and resolves inline dev stylesheets through `data-vite-dev-id`. The mapper records field → CSS origin in `provenance/<sid>.json`. An optional `@holotype/vite-plugin` (hardening) adds JSX locations (see [15](15-change-requests.md)) | ✅ |
| D-37 | **Agent contract.** Stories are mandatory for every new variant, property and component (15 §8 rule 3), tagged `parameters.holotype.implements: ['<itemId>']`; screens are optional and marked with `// holotype-implements: <itemId>`. `holotype verify` is the acceptance test. DCRs and verify reports are committed with the PR (see [15](15-change-requests.md)) | ✅ |
| D-38 | **Designer text is untrusted data** in prompts: always fenced or escaped, never inside instructions (see [15](15-change-requests.md)) | ✅ |
| D-39 | **Distribution (now): private, for a small known group** (user decision: the user and their boss). Through the loop slice (L0–L5) and early hardening: a **development plugin** installed from the built `manifest.json` ("Import plugin from manifest" in the Figma desktop app; any plan, no review). The account has Organization/Enterprise features (native branching), so switch to a **private organization plugin** (published to the org only, no Figma review) once the plugin is stable. Figma Community listing is deferred until after M8 and requires the trademark search (D-01) | ✅ |
| D-40 | **Quality bar** (user requirement): high-quality software with very good UX for both designers and developers. Every user-facing flow has a spec in [11](11-ux.md) with empty, loading, error and success states; every diagnostic has a plain-language message and a remedy; no flow ships without a usability check on a real design system. Usability checks run at every slice demo with a designer (D4, D5, D6) and at M4 and M4.5 | ✅ |
| D-41 | **Screen grouping:** frames become one `screen` item, grouped by `Screen / Breakpoint / State` names and Figma Sections and classified by vocabulary; configurable in `dcr.screens` (see [15](15-change-requests.md)). The slice emits one variant per screen; breakpoint/state grouping is hardening (H-E) | 🟡 |
| D-42 | **Usage snippets are specs:** `renderSnippet` is pure and golden-tested; its `jsx-sketch` names real components and props but is never shipped code | ✅ |
| D-43 | **Targets:** the DCR header names `targets.components` and optional `targets.screens`. Default: screens live in the UI repo; with separate repos, screens import only from the published package (hardening H-E, after M-Loop) | 🟡 (user to confirm) |
| D-44 | **Approval is optional and hash-bound:** `branch:meta.approval` approves exactly one `dcrHash` and is not part of the DCR, so approving never changes the hash (hardening H-E, after M-Loop) | ✅ |
| D-45 | **Old instances are not requests:** outdated/deprecated instances yield `instance.outdated` / `instance.deprecated` items pointing at the current component; the old look is never rebuilt (hardening H-E, after M-Loop) | ✅ |
| D-46 | **Loop-first roadmap** (R1). The first product milestone is **M-Loop** (demo D6): the owner and one designer run the whole loop (git branch → Figma branch file → designer edits → Submit → DCR → AI agent → `holotype verify`) on a React + Vite + Storybook 10 repo, about week 16–20. The **Loop slice** (L0 Skeleton, L1 Components, L2 Tokens and layout, L3 Branch file, L4 DCR, L5 Loop; [14](14-roadmap.md#loop-slice)) contains only: minimal capture → mapper → plugin apply (identity keys, `irh`/`ah`, idempotent keyed in-place apply; no conflict UI or renames: Phase 4a); a tokens subset (CSS custom properties → one collection, default mode, exact `var()` bindings); the branch baseline (`base:*`); DCR items `component.modified`, `variant.added`, `property.added`/`property.changed`, `component.new` and `screen` usage; `prompt.md`; and `holotype verify` v1. Everything else is the **hardening track**, in value order: Phase 4b sync UX (conflicts, renames, deprecation), full tokens, composition (INSTANCE_SWAP, SLOT, nested instances), DCR completion (approval, targets split, a11y, interactions, `instance.*`, REST parity, MCP tools), fidelity (grid, icon fonts, CJK, closed shadow DOM, huge variant sets), SB 8/9/11, automation, org plugin. Estimates assume one owner plus AI agents: agent-parallel work (pure packages with fixtures) and Figma-in-the-loop work (spikes, demos, usability; the human bottleneck, budgeted in owner-hours) are estimated separately | ✅ |
| D-47 | **Figma branches are never merged into the library** (R2). When the code PR merges, the branch file is archived (Figma: Archive branch; duplicated file: moved to an Archive project). The main library changes only by re-sync from code: a library maintainer opens the library file, runs Holotype ▸ Re-sync, and publishes the library. There is no CI write path (Figma has no write API outside plugins); CI only produces the bundle. A library file carrying `branch:meta` or `base:*` (a branch merged anyway) shows `SYNC_BRANCH_RESIDUE` and a cleanup step on its next sync. Amends D-32 | ✅ |
| D-48 | **Submit freezes a Figma version** (R3). On Submit the plugin saves a named version (`figma.saveVersionHistoryAsync('Holotype request <dcrHash8>')`, after a short settle delay) and records its id in `branch:meta.lastDcr.versionId` and `header.figma.fileVersion` (outside the hash, D-50). Every CLI read of a submitted request (images, `--pull`, REST re-extraction) uses `?version=<id>`, so later edits never leak into it | ✅ |
| D-49 | **Cross-machine hand-off** (R4). Designer and developer are assumed to be on different computers. Submit always writes the request into the file: root shared plugin data `request:0..n` (gzipped canonical DCR, ≤90 kB chunks) plus `branch:meta.lastDcr {id, hash, versionId, scope, excluded, chunks}`. The plugin's primary action depends on state: paired with a CLI on this computer → "Send to Holotype on this computer"; otherwise → **Notify developer** (copies a message with the branch URL, the request id and `holotype dcr --pull <figma-url>`). "Download request (.zip)" is always offered. The developer runs `holotype dcr --pull <figma-url>` (REST read of root plugin data and images at `versionId`, hash check, provenance attach) or `holotype dcr import <request.zip>`. In the Loop slice `dcr import` is the guaranteed path; `--pull` ships once the S-18 root-plugin-data check passes, and from then on "Notify developer" is the default for an unpaired plugin | ✅ |
| D-50 | **DCR hash core and shared config** (R5). `dcrHash = h16(canonical(core))`. The core is the DCR without `header.generated`, `header.figma.fileVersion`, the asset map and every CLI-enriched field (provenance: `items[].changes[].origin`, `items[].target.code`, `items[].nearest[].code`). Plugin and CLI compute byte-identical cores from the same snapshot; the CLI recomputes the core hash on import and pull and rejects a mismatch; approval (D-44) binds to it. Both sides use the same `dcr` config: the CLI writes the resolved `dcr` config into the bundle (`BundleManifest.branch.dcrConfig`), the plugin copies it to `branch:meta.dcrConfig` with its `configHash`, and the CLI warns `DCR_CONFIG_DRIFT` when its local config differs. Amends D-35 | ✅ |
| D-51 | **One config schema owner** (R6). [16](16-config.md) owns `holotype.config.ts`: every top-level key, type, default, validation rule, and the chapter that defines its semantics. `defaults` and `components[sid]` reuse `HolotypeParams` ([04 §9](04-variant-model.md#schema)). Other chapters link to 16 and never restate a schema. Unknown keys → `PLAN_CONFIG_UNKNOWN_KEY`; invalid values → `PLAN_CONFIG_INVALID` | ✅ |
| D-52 | **Contract owners and canonical numerics** (R7). 06 owns every IR and document schema (`CaptureDoc`, `SceneComponent`, `BundleManifest`, `TokensDoc`, `BundleReport`, `ApplyReport`, `ProvenanceDoc`) and every content hash (`vk`, `irh`, `ah`, `bundleFp`). 02 owns the CLI↔plugin wire protocol, the on-disk layout and the capture cache key; 09 owns the plugin-internal main↔UI messages; 11 owns CLI commands, flags, exit codes and the status vocabulary; 12 owns the diagnostics catalog and `RunReport`; 15 owns the DCR IR; 16 owns config. Others link instead of copying. Canonical rounding: lengths 1/1000 px; ratios and matrices 1e-6. `ah` = 7 per-group FNV-1a-64 sub-hashes (16 hex each), in the order geom, layout, paint, text, vis, bind, inst, computed in plugin main by `normalizeGroups()` from `@holotype/ir` | ✅ |
| D-53 | **Runtime and plugin identity** (R8). Node ≥22.12 minimum, Node 24 LTS reference. The manifest sets `enablePrivatePluginApi: true` (dev and private organization builds). Branch identity uses `figma.fileKey` when available; otherwise `branch:meta.fileId`, a random id written at link time in root shared plugin data and cross-checked by the CLI against REST `branch_data`. Amends D-03, D-06 | ✅ |
| D-54 | **Agent outcome is measured** (R10). G9 metrics (§4): first-pass verify rate per item kind on an agent-eval corpus (≥10 DCR fixtures on `fixtures/ds-react`, run on a schedule through ≥2 coding agents), false-change rate, provenance coverage, Submit → verified-PR time. Before M-Loop exit, a **bake-off** implements the same designer branch with (a) Figma MCP `get_design_context` + Code Connect and (b) the Holotype DCR, measuring verify pass rate, unrelated-diff size, token correctness, new-vs-existing mistakes and reviewer time ([12](12-quality.md#bake-off)) | ✅ |
| D-55 | **Verify v1 decides in Scene space.** `holotype verify` re-captures at HEAD and compares new Scene IR values with each item's `acceptance` through the shared normalizer: fields and token bindings (`component.modified`); variant values, structure and fields against the designer's snapshot (`variant.added`, `component.new`); argTypes (`property.*`). Visual similarity against the designer's Figma export is advisory (different renderers), with thresholds calibrated on fixture renderer noise. Verify also checks that non-target variants of each touched component keep their baseline values (status `regressed`). Stories are matched only by `parameters.holotype.implements`; screen files by a `// holotype-implements: <itemId>` marker | ✅ |
| D-56 | **Reviewer input and iterations stay outside the hash.** Answers to open questions are stored like approval in `branch:meta.answers {questionId: option, dcrHash}` and written by the CLI to `answers.json`; the agent records its own choices in `.holotype/requests/<id>/decisions.json`. Requests on one branch are **cumulative** (everything vs the baseline) with stable item ids; each records `parent`, and `.holotype/requests/LATEST-<branch-slug>` names the newest, which `holotype dcr`, `holotype verify` and MCP `design_changes` use by default | ✅ |
| D-57 | **Default DCR scope in branch files is `changed`:** every managed component whose `ah` differs from its baseline, plus every top-level frame or section created after link (absent from `branch:meta.baseFrames`). `ready`, `page:<name>`, `selection:<ids>` and `all` remain; the chosen scope is recorded in `lastDcr.scope` so `--pull` reproduces it | 🟡 (revisit after D6) |
| D-58 | **Local transport (topology A, hardening).** Pairing: `POST /v1/pair/start` → the CLI prints a 6-digit code (`482 913`, 2-minute expiry) → `POST /v1/pair/confirm`. Streaming: `ws://127.0.0.1:<port>/v1/ws`, subprotocol `holotype.v1`, session token as the first message, never in a URL; fallback `GET /v1/events?after=<seq>`. Probe `GET /v1/health`, then `GET /v1/session`. clientStorage key `holotype.session.<serverId>` (server instance id persisted in `~/.holotype/`). Spec: [02 §4](02-architecture.md#protocol) | ✅ |

## 6. Architecture at a glance

```
               ┌──────────────────────────── CLI / CI (Node) ─────────────────────────────┐
 Storybook     │  storybook adapter ─► variant planner ─► capture engine ─► mapper ──────┐ │
 (static build │   (index, meta,        (matrix, props,    (Playwright+CDP,   (inference, │ │
  or dev       │    docgen, globals)     budgets)           in-page serializer  alignment,  │ │
  server)      │                                            → Capture IR)       tokens,     │ │
               │                                                                naming      │ │
               │                         cache (content-addressed) ◄────────────┘ → Scene IR│ │
               │                                                                             ▼ │
               │                                        bundle writer / local server (HTTP+WS)│
               └──────────────────────────────────────────────────────────────┬──────────────┘
                                                                              │ Scene IR bundle
               ┌────────────────────────── Figma plugin ─────────────────────▼──────────────┐
               │ UI iframe (Preact): connect/pair, pick components, fonts preflight,         │
               │                     diff preview, report ── chunks ─►                       │
               │ main thread: identity index ─► reconciler/applier ─► read-back verify ─►    │
               │              fallback ─► registry update ─► fidelity export (optional)      │
               └─────────────────────────────────────────────────────────────────────────────┘
```

The packages (details in [02](02-architecture.md#monorepo)) are published under the provisional scope `@holotype/*`:

| Package | Role | Runs in |
|---|---|---|
| `ir` | TypeBox schemas for Capture IR, Scene IR, the bundle manifest and `HolotypeConfig` ([16](16-config.md)); migrations; canonical JSON; hashing; shared `normalizeGroups()` (the `ah`/baseline normalizer) and pipeline types (`ir/pipeline.ts`) | everywhere |
| `shared` | diagnostics codes, logger, result types, utilities | everywhere |
| `storybook` | Storybook adapter: index/metadata/docgen/globals discovery and the render-loop driver | Node + page |
| `capture` | Playwright orchestration, browser pool, CDP helpers, in-page serializer (built as an IIFE string) | Node + page |
| `planner` | variant matrix, property classification experiments, budgets | Node |
| `mapper` | **pure** Capture IR → Scene IR (layout inference, text, visuals, alignment, naming, token binding) | isomorphic |
| `layout-sim` | a model of Figma's auto-layout and grid algorithm, used by mapper verification and by `figma-fake` | isomorphic |
| `plugin` | Figma plugin: main (reconciler/applier) + UI | Figma |
| `figma-fake` | in-memory implementation of the plugin's narrow `FigmaPort` interface, for tests | Node |
| `cli` | `holotype` binary (alias `holo`). Commands are listed in [11 §3.3](11-ux.md#commands) (including `login`, `cache`, `publish`, `status`, `prune`, `branch`, `dcr`, `verify`, `mcp`); exit codes in [11 §3.2](11-ux.md#exit-codes) | Node |
| `storybook-addon` | optional: typed `parameters.holotype`, a manager panel, a build-time manifest via `experimental_manifests`, and in-preview capture hooks | Storybook |
| `action` | GitHub Action wrapper around the CLI | CI |
| `fidelity` (tool) | scoring: screenshot vs Figma export, box deltas, reports | Node |
| `dcr` | pure Figma snapshot ↔ baseline diff, classification, reverse property→arg mapping, DCR IR, deterministic `prompt.md` renderer; bundled into the plugin **UI** only | Node + plugin UI |
| `vite-plugin` | optional `@holotype/vite-plugin`: stamps JSX source locations for provenance in branch mode (hardening) | Node (Vite) |

## 7. Glossary and cross-chapter contracts

Use these exact terms and identifiers in every chapter.

### Storybook terms

| Term | Meaning |
|---|---|
| **Story id** | Storybook id, `components-button--primary` |
| **Component id** (`sid`) | the story-id prefix before `--` (e.g. `components-button`), equal to the Storybook manifest component id. One Figma component set per component id by default. Derived ids: story split `<sid>--<storySlug>`; viewport split `<sid>@<viewportName>`; enum split `<sid>=<valueSlug>`; extracted icon `icon:<slug>` (collision: `icon:<slug>-<sha8>`); `component:` regroup uses the configured id |
| **Variant** | one rendered state of a component: (story id, args, globals, pseudo-state, viewport). It becomes one `ComponentNode` inside the set |
| **Variant key** (`vk`) | `sha256(canonicalJSON({storyId, args, globals, state, viewport}))`, truncated to 16 hex characters |
| **Axis** | a Figma VARIANT property. Its values come from args, stories, states, themes (when modes are disabled) or viewports |

### Component properties

| Term | Meaning |
|---|---|
| **Component property** | a BOOLEAN / TEXT / INSTANCE_SWAP / SLOT property defined on the set and bound to sublayers |
| **Arg classification** | `VARIANT` \| `BOOLEAN` \| `TEXT` \| `INSTANCE_SWAP` \| `SLOT` \| `FIXED` \| `IGNORED`, decided by the planner and verified by render-and-diff |

### Nodes and IRs

| Term | Meaning |
|---|---|
| **Node key** (`nk`) | a stable, human-readable key of a node within a component, *aligned across all its variants* (see [07 §alignment](07-mapping.md)). Example: `root/label`, `root/icon-leading` |
| **Capture IR** (`CaptureDoc`) | per variant: raw DOM facts (geometry, computed and authored CSS, text lines, fonts, assets). Defined in [06](06-ir.md) |
| **Scene IR** (`SceneComponent`) | per component: properties, variants, per-variant `SceneNode` trees in Figma terms, plus bindings, fallbacks and diagnostics. Defined in [06](06-ir.md) |
| **Bundle** | `manifest.json` + `components/<sid>.json` (one Scene IR each) + `assets/<sha256>` (flat) + `tokens.json` + `report.json` (`BundleReport`) [+ `provenance/<sid>.json` in branch mode]. Schema: [06 §4](06-ir.md#bundlemanifest). Shipped as a directory, a `.holotype.zip`, or streamed by the local server |
| **Bundle fingerprint** (`bundleFp`) | content hash of a whole bundle ([06](06-ir.md#bundle-fingerprint)) |
| **`planHash`** | hash of the canonical `ComponentPlan` (planner output, [04](04-variant-model.md)); part of the cache keys ([02](02-architecture.md#capture-key)) |
| **`captureKey`** | the capture cache key per variant ([02](02-architecture.md#capture-key)) |

### Process and policy terms

| Term | Meaning |
|---|---|
| **Diagnostic** | `{code, severity, nodeKey?, variantKey?, message, data?}`. Codes are stable `UPPER_SNAKE` strings catalogued in [12](12-quality.md#diagnostics) |
| **Managed node** | a Figma node carrying `holotype/nk`. Unmanaged nodes inside managed components are designer additions and are never modified |
| **Fallback** | per container: absolute child positions embedded in the Scene IR, applied when read-back verification fails |
| **Apply plan** | the plugin-side diff (create/update/move/deprecate/conflict) computed read-only before writing |
| **Root registry** | the identity cache in `figma.root` shared plugin data (`registry:meta` + chunks, [10 §2.3](10-sync.md#registry)) |
| **Bundle registry** | the topology-D bundle store that CI publishes to ([02 §5.3](02-architecture.md)) |
| **`applierEpoch`** | the second part of `v`; bumps when a plugin fix changes output for the same input (D-19) |
| **Lock** vs **Detach from Holotype** | Lock ("Keep as designed") is reversible, keeps keys and is skipped by sync. Detach strips all `holotype` keys and is irreversible ([10](10-sync.md)) |
| **Branch file** | a Figma file (duplicate or Figma-native branch) linked to one git feature branch and its `baseCommit` (D-32) |
| **Proposal mode** | the sync mode of branch files: designer edits to managed nodes are *intent*, captured for a DCR, not conflicts (D-33) |
| **Baseline snapshot** | the normalized applied state per variant stored at generation time (`base:*`); the DCR diffs against it (D-34) |
| **DCR** | Design Change Request: deterministic, schema-validated list of design changes vs the baseline (modified, new variant/property/component, screens with states/breakpoints, interactions, content/a11y, deleted, detached, outdated/deprecated instances, tokens), each with provenance, tokens, assets and an acceptance criterion; rendered to `prompt.md` for an AI agent ([15](15-change-requests.md)) |
| **DCR core** | the DCR without `header.generated`, `header.figma.fileVersion`, the asset map and CLI-enriched provenance; `dcrHash` covers only the core (D-50) |
| **Request in file** | the submitted DCR stored in the branch file (`request:*` chunks + `branch:meta.lastDcr`) at a frozen version, readable by `holotype dcr --pull` (D-48, D-49) |
| **Loop slice / M-Loop** | the thin end-to-end slice L0–L5 and its exit milestone, the first real loop with an AI agent (D-46, [14](14-roadmap.md#loop-slice)) |
| **Hardening track** | everything after the Loop slice, in value order (D-46, [14](14-roadmap.md#hardening)) |

### Config precedence (lowest to highest)

Keys, types and defaults: [16](16-config.md) (D-51).

1. built-in defaults
2. `holotype.config.ts` → `defaults`
3. Storybook project `parameters.holotype` (preview)
4. meta `parameters.holotype`
5. story `parameters.holotype`
6. `holotype.config.ts` → `components[<sid>]` overrides
7. CLI flags

Tags `figma` / `!figma` opt in or out. Opt-out wins.

## 8. Roadmap summary

Details, estimates and exit criteria are in [14](14-roadmap.md).

| Track | Milestone | Headline deliverable |
|---|---|---|
| Slice L0 | Skeleton (D1, ~wk 4) | monorepo, `ir`, plugin + "Holotype Spikes" dev plugin, slice spikes; a story appears in Figma as frames and text |
| Slice L1 | Components (D2, ~wk 9) | component sets with VARIANT/BOOLEAN/TEXT; identity keys + `irh`/`ah`; re-import = 0 writes (Phase 4a) |
| Slice L2 | Tokens and layout (D3, ~wk 12) | flex → auto layout with fallback; tokens subset bound to `var()` values |
| Slice L3 | Branch file (D4, ~wk 14) | `branch start\|link\|refresh`, proposal mode, `base:*`, Changes list |
| Slice L4 | DCR (D5, ~wk 17) | Submit (version + request in file), `dcr import`, `prompt.md` with provenance |
| Slice L5 | **M-Loop** (D6, ~wk 16–20) | `holotype verify` v1, agent-eval corpus, bake-off; the full loop with a real agent |
| Hardening | M1…M5 | H-A fidelity (M1), H-B structure (M2), H-C variants at scale (M3), H-D sync UX / Phase 4b (M4), H-E DCR complete incl. MCP server and DCR tools, approval, REST parity (M4.5), H-F full tokens + H-G compatibility (M5) |
| After | M6–M8 | composition (INSTANCE_SWAP icons and nested instances first), automation (Action, registry, addon, Code Connect, MCP sync tools), private org plugin; public track optional after M8 |

Slice details: [14 §loop-slice](14-roadmap.md#loop-slice); hardening order: [14 §hardening](14-roadmap.md#hardening); staffing assumptions: [14 §staffing](14-roadmap.md#staffing).

## 9. Decisions needed from the user

1. ~~D-01 public name~~ → **Holotype** (decided; trademark search before any public listing).
2. ~~D-02 license~~ → **MIT** (decided).
3. ~~Primary target stack~~ → **React + Vite on Storybook 10** (decided, D-26).
4. ~~Distribution~~ → **private**: development plugin shared with the user's boss now, private organization plugin later if the plan allows (D-39).
5. ~~Storybook minimum version~~ → **Storybook 10 primary**; 11 at GA; 8/9 best-effort; no 7 (decided, D-11).
6. Is a hosted or paid tier ever intended? (Affects nothing in the MIT core; only where a future service would live.) Not before the public track (post-M8).
7. ~~Figma plan~~ → the account has **Figma-native branching** (Organization/Enterprise), so branch files are Figma branches (D-32) and a private organization plugin is available (D-39).
8. ~~Who edits branch files~~ → **designers** by default (designer view first, code details behind a toggle); developers may edit too.
