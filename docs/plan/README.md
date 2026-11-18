# figmabook: master plan

> **Status:** planning, v0.1 (2026-11-18). Nothing is implemented yet.
> **Codename:** `figmabook`. Figma's trademark guidelines forbid "Figma"/"Fig" in a product name, domain or handle (see [13](13-security-legal.md#trademark)). The public name is still to be chosen (decision **D-01**); until then every package, CLI and doc uses the codename.

figmabook turns a **Storybook** into a **native, editable, synced Figma component library**:

- real component sets, with variants;
- component properties: boolean, text, instance-swap and slot;
- auto layout, including grid;
- variables with modes;
- instances for nested components.

Imports can be repeated without losing the overrides designers have made on instances.

It works in the same space as story.to.design. It aims to beat it on fidelity, on the quality of its component model, on override-safe sync, on CI/agent automation, and on being open source and self-hostable.

---

## How to read this plan

| # | Chapter | What it decides |
|---|---|---|
| 00 | **This file** | Vision, goals, non-goals, success metrics, **canonical decisions**, glossary, cross-chapter contracts |
| 01 | [Landscape & differentiation](01-landscape.md) | Competitor teardown (story.to.design, Figma code-to-canvas, Anima, Builder, Storybook Connect, Code Connect), our wedge |
| 02 | [System architecture](02-architecture.md) | Components, data flow, deployment topologies, monorepo, tech stack, CLI↔plugin protocol, bundle format |
| 03 | [Storybook integration](03-storybook.md) | Discovery, metadata extraction per SB version, render loop, readiness, root/portal detection, access & auth |
| 04 | [Component & variant model](04-variant-model.md) | How stories/args/states/themes/viewports become variants and component properties; config schema; budgets |
| 05 | [Capture engine](05-capture.md) | In-page serializer + CDP: composed tree, geometry, text, fonts, pseudo-elements, SVG, images, states, probing |
| 06 | [Intermediate representations](06-ir.md) | Capture IR, Scene IR, bundle layout, hashing, versioning, JSON Schema |
| 07 | [Mapping & inference](07-mapping.md) | CSS→Figma rules: layout inference + verification, sizing, text, visuals, tree simplification, naming, cross-variant alignment |
| 08 | [Tokens, variables & styles](08-tokens.md) | CSS custom properties → variables/aliases/modes; bindings; styles; matching existing libraries |
| 09 | [Figma plugin](09-plugin.md) | Plugin architecture, applier/reconciler, build order rules, components/sets/properties, nested instances, read-back verification |
| 10 | [Identity & sync](10-sync.md) | Stable keys, keyed in-place reconciliation, override preservation, conflict policies, renames/deletions, diff preview |
| 11 | [UX](11-ux.md) | CLI UX, config file, plugin screens and flows, reports, error states |
| 12 | [Quality, fidelity & performance](12-quality.md) | Test pyramid, fixtures, fidelity harness and metrics, diagnostics catalog, perf budgets, observability |
| 13 | [Security, privacy, legal](13-security-legal.md) | Threat model, local/cloud security, trademark, licensing, publishing, business model |
| 14 | [Roadmap](14-roadmap.md) | Phases, de-risking spikes, milestones with exit criteria, risks, open questions |

Research inputs are kept under [`docs/research/`](../research/). Wherever a chapter cites an API, it uses the names verified there. Those names are current as of Nov 2026: `@figma/plugin-typings@1.142.0`, `storybook@10.6.7` / `11.0.0-beta.3`, and Playwright with Chromium.

Some facts are marked **(verify)** in the chapters. These are inferred or community-reported, and each one is assigned to a spike in [14](14-roadmap.md#phase-0).

---

## 1. Vision

> *Code is the source of truth for components. Design should get a faithful, living, editable mirror of it, with no manual redrawing and no drift.*

Design-system teams keep two libraries in sync by hand: Storybook in code, and a Figma library. Drift is constant. Existing tools fall short in different ways:

- They produce **flat layers**: Figma code-to-canvas, html.to.design.
- They **embed** stories without converting them: Storybook Connect.
- They are **closed, per-Storybook-priced, cloud-processed**, and explode every arg into a variant axis: story.to.design.

figmabook makes the Figma library a *build artifact* of the Storybook, produced locally or in CI, while staying a first-class editable Figma library.

## 2. Goals

- **G1 Fidelity.** Every imported variant is visually equivalent to the browser render: per-node box error ≤1px at p95, and SSIM ≥0.98 against the Playwright screenshot on the fixture corpus.
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

- **Figma → code.** Generating component code is out of scope. We *do* generate Figma **Code Connect** mappings in a later phase, because we already know the arg ↔ property mapping.
- **Two-way sync.** Design edits are not written back to code. We detect designer edits and protect them; we do not upstream them.
- **Clipboard-format hacks.** No reverse-engineered Kiwi/clipboard writing. Only the official Plugin API is used, plus Figma's MCP `use_figma` as an experiment (see [13](13-security-legal.md)).
- **Arbitrary websites and full pages.** The target is component stories. Full-page capture works incidentally but is not optimized.
- **Rendering inside the Figma plugin iframe.** This is proven non-viable (null origin, frame-ancestors, cross-origin DOM). See [02](02-architecture.md#topologies).
- **Non-Chromium capture engines.** We depend on CDP, for platform fonts, forced pseudo-states and box models.

## 4. Success metrics

These are tracked from Phase 1 onward by the fidelity harness ([12](12-quality.md)).

| Metric | Definition | v1 target |
|---|---|---|
| Visual fidelity | median and p10 SSIM, Figma PNG export vs Playwright element screenshot @2x | median ≥0.985, p10 ≥0.95 |
| Geometry fidelity | p95 \|Δ\| of every node's Figma `absoluteBoundingBox` vs captured rect | ≤1px |
| Auto-layout coverage | share of IR containers emitted as auto layout (not absolute) and still passing verification | ≥85% on fixtures |
| Text line parity | share of text nodes whose Figma line count equals the browser's | ≥98% |
| Property quality | share of eligible args emitted as non-variant properties (BOOLEAN/TEXT/INSTANCE_SWAP/SLOT), measured over the fixtures | ≥70% |
| Override retention | share of instance overrides surviving a re-sync in the sync test-suite, when structure is unchanged | 100% |
| Capture throughput | median warm-page variant capture time (render, settle, serialize) | ≤400ms |
| Build throughput | plugin apply time for a 20-node variant | ≤60ms; 1,000 variants in ≤3 min without freezing the UI for more than 100ms |
| Re-sync cost | Figma writes on a no-op re-sync | 0 |

## 5. Canonical decisions

These are binding for every chapter. If a chapter disagrees with this table, this table wins and the chapter must be fixed. Status: ✅ decided, 🟡 provisional (revisit at the named milestone), ❓ open (needs the user, see §9).

| ID | Decision | Status |
|---|---|---|
| D-01 | **Public product name: Holotype** (proposed; CLI `holotype`, alias `holo`; npm scope `@holotype`; GitHub org e.g. `holotypehq`). A holotype is the single reference specimen a species is defined from: the code is the specimen, Figma gets the faithful copy. npm name and scope are free; no conflicting dev or design product was found; a formal USPTO/EUIPO search is still required. Runners-up: Twinform, Limner (trademark risk: an existing painting app). Until the rename lands, every package, CLI and doc keeps the codename `figmabook`; the rename happens before the first public release (see [13](13-security-legal.md#trademark)). Listing title pattern: "Holotype — Storybook to components, plugin for Figma Design" | 🟡 (user confirm + trademark search) |
| D-02 | **License:** MIT for all packages in this repo (user decision). A future hosted service, if any, lives in a separate repo (closed source or FSL-1.1-MIT) | ✅ |
| D-03 | **Language/runtime:** TypeScript (strict) everywhere; Node ≥20.19, developed on Node 24 LTS; ESM only | ✅ |
| D-04 | **Monorepo:** pnpm workspaces + Turborepo + changesets; Vitest; Biome (lint+format); tsup for Node packages | ✅ |
| D-05 | **Capture:** Playwright, **Chromium only**, browser version pinned per release (it is part of the cache key); CDP used directly | ✅ |
| D-06 | **Plugin build:** create-figma-plugin (esbuild + Preact UI); `documentAccess: "dynamic-page"`; async APIs only; typings pinned | ✅ |
| D-07 | **Schemas:** TypeBox is the single source of truth, with JSON Schema emitted and published per major version | ✅ |
| D-08 | **Two IRs:** the *Capture IR* holds raw browser facts and stays CLI-side (cached). The *Scene IR* is the Figma-ready desired graph with absolute fallbacks embedded, and it is what ships to the plugin. Inference (the `mapper`) runs **CLI-side**, is pure and isomorphic, and is never written against the `figma` global | ✅ |
| D-09 | **Plugin = reconciler.** The plugin does not infer CSS. It applies the Scene IR by keyed in-place reconciliation, verifies by read-back, and falls back per container to the embedded absolute layout | ✅ |
| D-10 | **MVP topologies:** (A) local CLI server on loopback with a pairing token, and (B) bundle-file import (always available). Then (D) CI/GitHub Action + registry, then (C) optional hosted renderer. (E) in-iframe rendering is rejected | ✅ |
| D-11 | **Storybook support:** **10.x is the primary, first-class target** (user decision): all fixtures, dogfooding and release gates run on it. 11.x is tracked from beta and becomes first-class at its GA. 8.x/9.x are best-effort: the adapter keeps their code paths and CI runs a smoke test only. 7.x and older are not supported. Static build is the reference target; dev server is supported | ✅ |
| D-26 | **Primary target stack:** React + Vite (`@storybook/react-vite`) on Storybook 10 (user decision). Every fixture, golden test, spike and dogfooding project uses it until M5. The DOM-based pipeline stays framework-agnostic (G8), but other renderers (Vue, Lit, Angular, Svelte, HTML) are *best-effort, untested* until they get fixtures in a later phase; framework-specific enhancers (D-21) ship for React first | ✅ |
| D-12 | **Variant source priority:** curated config > `parameters.figmabook` > stories-as-variants > args matrix. The default is *not* a blind Cartesian product (see [04](04-variant-model.md)) | ✅ |
| D-13 | **Property classification:** each arg is classified VARIANT / BOOLEAN / TEXT / INSTANCE_SWAP / SLOT / FIXED by **render-and-diff verification**, not by type alone | ✅ |
| D-14 | **Pseudo-states:** CDP `CSS.forcePseudoState` on the target and its ancestor chain by default; real Playwright interaction as a per-component fallback or option; the storybook-addon-pseudo-states global when that addon is installed; drop states with no visual effect | ✅ |
| D-15 | **Layout policy:** absolute positioning is the always-correct baseline. Auto layout or grid is emitted per container only if the capture-side simulation passes (≤0.6px), and it is kept only if the plugin read-back passes (≤1px). Failures fall back *per container*, never per document | ✅ |
| D-16 | **Borders:** CSS border maps to an INSIDE stroke. Padding in the Scene = CSS padding + border width with `strokesIncludedInLayout:false` (exact). Per-side colors are decomposed | 🟡 (spike S-05) |
| D-17 | **Text:** one TEXT node per inline formatting context, with styled ranges. Explicit px line-height, never Figma "Auto". Fonts resolved via CDP `CSS.getPlatformFontsForNode`. Default wrap mode `reflow`, with `locked-lines` as an option | ✅ |
| D-18 | **Tokens:** a binding is created only when the value is *provably* produced by a `var()` chain (CDP matched styles). Value-equality matching is opt-in and flagged low-confidence. Existing library variables are matched by `codeSyntax.WEB`, then by name, before anything new is created. Generated values never silently overwrite existing variable values | ✅ |
| D-19 | **Identity:** shared plugin data under the namespace `figmabook`. Keys `sid` (component), `vk` (variant), `nk` (node), `irh` (subtree hash), `ah` (applied hash), `v` (schema version). No delete-and-recreate of managed nodes, ever | ✅ |
| D-20 | **Deletions:** a removed story leads to deprecation (moved to a "Deprecated" page and renamed), never a hard delete while instances may exist | ✅ |
| D-21 | **Nested components:** detected in priority order: framework boundaries (React fiber `type`, Vue `__vueParentComponent`, Angular `ng.getComponent`, custom-element tag), matched to Storybook `component` references, then structural subtree hash. Each is emitted as an instance only if the instance render matches within tolerance | ✅ |
| D-22 | **File organization:** page "Components" (configurable), with one Figma Section per top-level title segment, and each component set laid out with a documentation frame. Also pages "Icons" and "Deprecated". The registry is stored chunked in `figma.root` shared plugin data | 🟡 (M2) |
| D-23 | **Telemetry:** off by default and opt-in, anonymous aggregates only; honours `DO_NOT_TRACK`; off in CI | ✅ |
| D-24 | **Default viewport/DPR:** capture at DPR 2, viewport 1280×800, `reducedMotion: reduce`, user agent suffixed `StorybookTestRunner` (Storybook then snaps animations), locale `en-US`, timezone `UTC`, clock pinned | ✅ |
| D-25 | **Local server ports:** a fixed list of 3 loopback ports declared in the manifest (default `127.0.0.1:47321-47323`) | 🟡 (spike S-01) |

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

The packages (details in [02](02-architecture.md#monorepo)) are published under the provisional scope `@figmabook/*`:

| Package | Role | Runs in |
|---|---|---|
| `ir` | TypeBox schemas for Capture IR, Scene IR and the bundle manifest; migrations; canonical JSON; hashing | everywhere |
| `shared` | diagnostics codes, logger, result types, utilities | everywhere |
| `storybook` | Storybook adapter: index/metadata/docgen/globals discovery and the render-loop driver | Node + page |
| `capture` | Playwright orchestration, browser pool, CDP helpers, in-page serializer (built as an IIFE string) | Node + page |
| `planner` | variant matrix, property classification experiments, budgets | Node |
| `mapper` | **pure** Capture IR → Scene IR (layout inference, text, visuals, alignment, naming, token binding) | isomorphic |
| `layout-sim` | a model of Figma's auto-layout and grid algorithm, used by mapper verification and by `figma-fake` | isomorphic |
| `plugin` | Figma plugin: main (reconciler/applier) + UI | Figma |
| `figma-fake` | in-memory implementation of the plugin's narrow `FigmaPort` interface, for tests | Node |
| `cli` | `figmabook` binary: `init`, `doctor`, `list`, `capture`, `export`, `serve`, `mcp`, `codeconnect` | Node |
| `storybook-addon` | optional: typed `parameters.figmabook`, a manager panel, a build-time manifest via `experimental_manifests`, and in-preview capture hooks | Storybook |
| `action` | GitHub Action wrapper around the CLI | CI |
| `fidelity` (tool) | scoring: screenshot vs Figma export, box deltas, reports | Node |

## 7. Glossary and cross-chapter contracts

Use these exact terms and identifiers in every chapter.

### Storybook terms

| Term | Meaning |
|---|---|
| **Story id** | Storybook id, `components-button--primary` |
| **Component id** (`sid`) | the story-id prefix before `--` (e.g. `components-button`), equal to the Storybook manifest component id. One Figma component set per component id by default |
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
| **Bundle** | `manifest.json` + `components/<sid>.json` (one Scene IR each) + `assets/<sha256>` + `tokens.json` + `report.json`. Shipped as a directory, a `.figmabook.zip`, or streamed by the local server |

### Process and policy terms

| Term | Meaning |
|---|---|
| **Diagnostic** | `{code, severity, nodeKey?, variantKey?, message, data?}`. Codes are stable `UPPER_SNAKE` strings catalogued in [12](12-quality.md#diagnostics) |
| **Managed node** | a Figma node carrying `figmabook/nk`. Unmanaged nodes inside managed components are designer additions and are never modified |
| **Fallback** | per container: absolute child positions embedded in the Scene IR, applied when read-back verification fails |
| **Apply plan** | the plugin-side diff (create/update/move/deprecate/conflict) computed read-only before writing |

### Config precedence (lowest to highest)

1. built-in defaults
2. `figmabook.config.ts` → `defaults`
3. Storybook project `parameters.figmabook` (preview)
4. meta `parameters.figmabook`
5. story `parameters.figmabook`
6. `figmabook.config.ts` → `components[<sid>]` overrides
7. CLI flags

Tags `figma` / `!figma` opt in or out. Opt-out wins.

## 8. Roadmap summary

Details, estimates and exit criteria are in [14](14-roadmap.md).

| Phase | Theme | Headline deliverable |
|---|---|---|
| 0 | Foundations & spikes | Repo, CI, schemas skeleton; 12 de-risking spikes answered |
| 1 | Pixel-correct snapshot | `figmabook capture <story>` → bundle → plugin builds an **absolute**, pixel-faithful frame. Fidelity harness live |
| 2 | Native structure | Auto layout/grid inference with verification and fallback; text and font fidelity; naming; simplification |
| 3 | Components & variants | Variant planner, component sets, component properties (BOOLEAN/TEXT), states; local server + pairing; doc frames |
| 4 | Sync | Identity, keyed in-place reconciliation, diff preview, conflict policies, deprecation, renames |
| 5 | Tokens | Variables, aliases, modes from themes, bindings, styles, library matching |
| 6 | Composition | Nested instances, icon extraction, INSTANCE_SWAP, SLOT |
| 7 | Automation | GitHub Action + registry, Storybook addon, Code Connect generation, MCP server |
| 8 | Public launch | Community listing, docs site, migration guides; optional hosted renderer (C) afterwards |

## 9. Decisions needed from the user

1. **D-01 public name.** Proposed **Holotype** (alternatives Twinform, Limner). Needs user confirmation and a formal trademark search.
2. ~~D-02 license~~ → **MIT** (decided).
3. ~~Primary target stack~~ → **React + Vite on Storybook 10** (decided, D-26).
4. **Distribution:** public Figma Community plugin, or a private org plugin first (no review, faster iteration)?
5. ~~Storybook minimum version~~ → **Storybook 10 primary**; 11 at GA; 8/9 best-effort; no 7 (decided, D-11).
6. Is a hosted or paid tier ever intended? (Affects nothing in the MIT core; only where a future service would live.)
