# 14 — Roadmap: phases, spikes, milestones, risks

<a id="staffing"></a>

> **Staffing.** Estimates assume **one owner plus AI coding agents** (about three agents in parallel worktrees). Each phase lists two numbers: **agent-weeks** (pure packages with fixtures: `ir`, `dcr`, `mapper`, `planner`, `layout-sim`, CLI) and **owner-hours in Figma** (spikes, demo checks, usability sessions), which are the bottleneck. `figma-fake` and op-log replay ([12 §4.4.4](12-quality.md)) land in L0 so agents iterate without Figma. Estimates carry ±30% until the slice spikes close. Calendar: M-Loop at about week 16–20; hardening to M5 about 6–8 months after start; M8 later. Work items, sizes and waves are in [BUILD](BUILD.md); its names and weeks match this chapter (D-46).

---

## Overview

```
Slice:      L0 ──► L1 ──► L2 ──► L3 ──► L4 ──► L5 = M-Loop (D6)
Hardening:  (after the slice item it extends)  H-A→M1  H-B→M2  H-C→M3  H-D→M4  H-E→M4.5  H-F/H-G→M5
After:      composition (M6) ──► automation (M7) ──► private org plugin (M8) ──► public track (optional)
```

| Track | Theme | Agent-weeks | Owner-hours in Figma | Calendar | Milestone | Previous estimate (ew, 3 engineers) |
|---|---|---|---|---|---|---|
| L0 | Skeleton and slice spikes | 10 | 15 (slice spike kits, D1) | wk 0–4 | D1 | Phase 0: 15 |
| L1 | Components | 14 | 6 (S-02 follow-up, D2) | wk 4–9 | D2 | part of Phases 1, 3, 4 |
| L2 | Tokens and layout | 7 | 4 (D3) | wk 9–12 | D3 | part of Phases 2, 5 |
| L3 | Branch file | 5 | 4 (D4 with the designer) | wk 12–14 | D4 | part of Phase 4.5 |
| L4 | DCR | 8 | 6 (D5 with the designer) | wk 14–17 | D5 | part of Phase 4.5 |
| L5 | Loop: verify, agent eval, bake-off | 7 | 10 (D6, bake-off review) | wk 17–20 | **M-Loop** | part of Phase 7 |
| | **Slice total** | **~51** | **~45 h** | **~16–20 wk** | | |
| H-A | Fidelity | 10 | 10 (spike kits S-03, S-04, S-09) | after L1 | M1 | Phase 1: 15 |
| H-B | Native structure | 14 | 8 (S-10, designer review) | after L2 | M2 | Phase 2: 20 |
| H-C | Variants at scale | 12 | 8 (S-06 step 2, S-08) | after L1 | M3 | Phase 3: 20 |
| H-D | Sync UX (Phase 4b) | 10 | 10 (conflict and rename sessions) | after L1 | M4 | Phase 4: 15 |
| H-E | DCR complete | 10 | 10 (S-15, S-18, usability) | after M-Loop | M4.5 | Phase 4.5: 12 |
| H-F, H-G | Tokens complete, compatibility | 8 | 6 (S-12 modes) | after L2 | M5 | Phase 5: 12 |
| | Composition | 10 | 8 (S-13, S-16 subset) | after M-Loop | M6 | Phase 6: 12 |
| | Automation | 12 | 6 | after M5 | M7 | Phase 7: 15 |
| | Private org plugin | 6 | 10 (acceptance) | after M7 | M8 | Phase 8: 10 |
| | **Total** | **~133** | **~136 h** | | | ~146 ew |

Agent-weeks and engineer-weeks are not comparable one to one; the old column is kept for reference only. Hardening groups run in parallel on idle agents once the slice item they extend is merged, but slice items are always dispatched first.

---

<a id="loop-slice"></a>

## Loop slice (L0–L5)

**Goal:** the owner and one designer run the whole loop (git branch → Figma branch file → designer edits → Submit → DCR → AI agent → `holotype verify`) on a React + Vite + Storybook 10 repo by about week 16–20 (D-46). The scope table and item ids are in [BUILD §4](BUILD.md#loop-slice); a summary:

| Area | In the slice |
|---|---|
| Storybook | SB 10.x, react-vite, static build and dev server; `args`/`argTypes`/`parameters.holotype` |
| Variants | stories-as-variants plus declared args; VARIANT, BOOLEAN, TEXT; one budget check ([04](04-variant-model.md)) |
| Capture and mapper | light DOM + open shadow, solid paints, borders, radius, simple shadows, Latin text, inline SVG, PNG/JPEG; flex → auto layout with verification and fallback (D-15); cross-variant alignment |
| Tokens | subset: CSS custom properties → one collection, default mode, exact `var()` bindings ([08 §0](08-tokens.md)) |
| Plugin | file import (topology B); fonts preflight; identity keys + `irh`/`ah`; idempotent keyed in-place apply |
| Branch file | `branch start\|link\|refresh`; proposal mode; `branch:meta`; embedded baseline `base:*`; Changes list |
| DCR | the kinds below; `prompt.md`; plugin extraction + CLI provenance attach |
| Verify | `holotype verify` v1 (D-55) |

| Milestone | Weeks | Demo |
|---|---|---|
| **L0** Skeleton | 0–4 | **D1:** a story appears in Figma as frames and text |
| **L1** Components | 4–9 | **D2:** component sets with VARIANT/BOOLEAN/TEXT; re-import makes 0 writes |
| **L2** Tokens and layout | 9–12 | **D3:** auto layout and variables bound to `var()` values |
| **L3** Branch file | 12–14 | **D4:** a designer edit shows up in the Changes tab of a branch file |
| **L4** DCR | 14–17 | **D5:** Submit gives a `prompt.md` with provenance |
| **L5** Loop | 17–20 | **D6:** the full loop with a real AI agent = **M-Loop** |

Explicit scope statements:
- **Phase 4 is split.** **4a** (identity keys, `irh`/`ah`, S-02 rules, idempotent keyed in-place apply, proposal-mode preservation) is in L1. **4b** (Diff and Conflicts screens, take/fork, renames, deprecation, consumer-file retention) is H-D.
- **Tokens subset in L2** ([08 §0](08-tokens.md)). Modes, styles and library matching are H-F.
- **DCR kinds in L4:** `component.modified`, `variant.added`, `property.added`/`property.changed`, `component.new`, `screen` usage (one variant per screen); questions for untokenized or unmappable values; `prompt.md` with the agent contract; plugin extraction + CLI provenance attach (CSS rules only; `@holotype/vite-plugin` is hardening).
- **Hand-off in L4.** Submit saves a version and writes the request into the file (D-48, D-49). `holotype dcr import <request.zip>` is the guaranteed path. `holotype dcr --pull` lands in L4/L5 if the S-18 root-plugin-data check passes.
- **Verify v1 in L5** (D-55): field and token checks, Scene-space checks for `variant.added`/`component.new`, argTypes for `property.*`, `implements` story discovery, regression check; visual similarity is advisory.
- **Agent-eval corpus and bake-off in L5** ([12](12-quality.md#agent-eval), [12](12-quality.md#bake-off), D-54).
- **Scope valves** if the slice slips ([BUILD §10.2](BUILD.md#ordering)): drop `component.new` and `screen` from the first D6 run (keep `component.modified`, `variant.added`, `property.changed`); keep tokens to colors and spacing only.

<a id="m-loop"></a>

### M-Loop exit criteria

1. The owner and a designer run the loop of [BUILD §4.3](BUILD.md#loop-slice) on a real branch with a real agent. `holotype verify` exits 0, and a human PR review finds no unrelated changes outside provenance files and new component directories.
2. Designer acceptance: 10–15 real components accepted by the owner and the designer.
3. Determinism: every `fixtures/dcr` case is byte-identical across 3 shuffled runs; the plugin core hash equals the CLI's recomputed hash (D-50).
4. Agent-eval run with ≥2 agents; first-pass verify rate ≥70% (README §4).
5. Bake-off done and recorded (D-54).
6. Usability at D4, D5 and D6 with the designer (submit, hand off across two machines; D-40).

Until M-Loop the slice's own checks gate; the hardening exit criteria below never block it.

---

<a id="phase-0"></a>

## Phase 0 — Foundations and slice spikes (L0)

**Goal:** a working skeleton (L0, demo D1) and evidence for every slice-relevant decision marked 🟡 or "(verify)" in README §5. Other spikes are scheduled with the hardening group that needs them.

**Deliverables:**
- Monorepo per D-04 with all packages from README §6 as empty, building, tested skeletons; CI (lint, typecheck, unit, schema emission check); changesets; MIT license headers (D-02).
- `ir`: TypeBox schemas v0 for Capture IR, Scene IR, bundle manifest, report ([06](06-ir.md)); canonical JSON + hashing with property tests.
- `shared`: diagnostics registry scaffold + docs page check ([12](12-quality.md#diagnostics)).
- `plugin`: create-figma-plugin scaffold, manifest with `documentAccess: "dynamic-page"`, candidate `networkAccess`.
- **Spike runner:** a **separate "Holotype Spikes" dev plugin** with its own manifest id (the product plugin's id is fixed forever). It runs spike scripts and exports results JSON. Spike kits exist for all 15 Figma spikes ([BUILD §9](BUILD.md#spike-kit)).
- `figma-fake` and op-log replay ([12 §4.4.4](12-quality.md)), so agents iterate without Figma.
- `fixtures/ds-react`: first 30 micro-fixtures + React golden Button/Input/Card on Storybook 10.
- **Spike reports** in `docs/spikes/S-xx.md`, each ending with a decision update to README §5.

**Spike order.** Slice spikes first: S-02, S-05, S-06 step 1, S-12 (Organization account only), S-16, S-17, S-18 subset, S-19 on CSS modules, S-07 on SB 10 only. The rest are hardening spikes, scheduled with the track that needs them: S-01 full matrix with topology A (H-E); S-03 and S-04 with H-A; S-09 icon fonts with H-A; S-10 grid with H-B; S-06 step 2 and S-08 with H-C; S-15 with H-E; S-11 `use_figma` with automation; S-13 with composition.

### Spikes

| ID | Question | Method | Success criteria / output | Timebox | Unblocks |
|---|---|---|---|---|---|
| **S-01** | Can the plugin UI reach a loopback server under Chrome Local Network Access (142+, "Apps on device" in 145) in: Figma desktop (macOS/Windows), Chrome, Edge, Safari, Firefox? fetch **and** WebSocket? Do fixed ports in `allowedDomains` with `reasoning` pass? Does PNA preflight (`Access-Control-Allow-Private-Network`) matter? | Minimal plugin with manifest listing `http://127.0.0.1:47321-47323` (three explicit entries) + `ws://`; tiny Hono server with `ACAO:*`; inspect console/CSP errors; compare with published "Cursor Talk to Figma MCP" manifest pattern. Desktop app on the owner's and designer's OS first; browser rows optional (dev plugins load from local files; browsers may need a private org publish). Record fetch and WebSocket separately per Chrome version; classification uses the HTTP probe only | Matrix table; recommended manifest entries; UX copy for each failure mode; decide whether WS or HTTP long-poll/SSE is the streaming default | 4 d | D-25, D-10, [02](02-architecture.md) protocol, [11](11-ux.md) §6.11 |
| **S-02** | Which in-place mutations of a main component preserve instance overrides (fill, text, visibility, nested instance swap, component property values) — locally and via library publish? | Build a component with 15 child types; create instances with every override kind; apply a mutation matrix: property edits, reorder (`insertChild`), rename, reparent, delete+recreate same name, change layoutMode, add/remove sibling, change variant property names/values, swap nested main component, `swapComponent` vs `mainComponent=`; verify override survival programmatically (`instance.overrides`, values) both in-file and after library publish/update in a consumer file | Survival matrix (mutation × override kind × local/library); codified "safe mutation" rules → `plugin` reconciler constraints and `figma-fake` contract | 5 d | D-19, [10](10-sync.md) |
| **S-03** | Exact conventions: `gradientTransform` space (identity = left→right?), radial center/radius, ANGULAR origin & direction vs CSS conic; multiple-shadow stacking order vs CSS; `LAYER_BLUR` and `BACKGROUND_BLUR` radius vs CSS σ (is ×2 right?); spread behaviour on frames | Micro-fixtures rendered in Chromium; same params built in Figma; T2 pixel compare across parameter sweeps; fit factors | Verified formulas checked into `mapper` with tests; ≤1% pixel error on sweep fixtures | 3 d | [07](07-mapping.md) visuals |
| **S-04** | Text parity Chromium vs Figma: advance-width drift, line-break agreement, `line-height: normal` resolution, baseline placement, letter-spacing %, for Inter, Roboto, SF/system, Noto CJK, a variable font | 300 paragraphs × widths × sizes; compare line breaks and per-line boxes (T1); measure needed width buffer distribution | Drift distribution; default buffer policy; whether `locked-lines` must be default for some fonts; baseline offset correction table if needed | 5 d | D-17 |
| **S-05** | Border/stroke model: INSIDE stroke + `padding+border` with `strokesIncludedInLayout:false` vs `true`; per-side weights in auto layout; dash phase; outline | Fixture sweep; T1 box compare and T2 pixels; editing ergonomics review with a designer | Choose default (D-16 confirmed or flipped); documented edge cases | 2 d | D-16 |
| **S-06** | **Step 1 (slice):** `setTimeout` and `crypto.subtle` in main, `postMessage` size, `figma.fileKey` with `enablePrivatePluginApi`, blob download from the UI. **Step 2 (hardening):** plugin performance at scale: build 1k and 5k variants (20–200 nodes), `combineAsVariants` cost vs set size, `addComponentProperty` binding cost, memory growth over repeated applies, time-slicing overhead, `exportAsync` throughput | Synthetic Scene IR generator; harness timing + `performance.memory` where available; vary batch sizes and slice lengths | Measured curves; practical max variants per set (sets the default budget, [04](04-variant-model.md)); slicing params; confirm README §4 build-throughput target or revise | 4 d | perf budgets, budget defaults |
| **S-07** | Storybook render loop robustness, deep on 10.6 plus 11-beta, with 8.6 / 9.1 as smoke only (D-11): `loadStory`, `setCurrentStory`, `updateStoryArgs` with non-serializable values, `updateGlobals`, readiness events (`storyFinished ?? storyRendered`), `StorybookTestRunner` UA animation snapping, SB11 `docgenServer` + `manifests/components.json` argTypes merge | Generated react-vite sandboxes (D-26); scripted 200-variant loop; failure injection (story throws, play fails) | Adapter compatibility layer spec; per-version quirks list; throughput numbers | 5 d | D-11, [03](03-storybook.md) |
| **S-08** | Pseudo-state strategies on real DSs: CDP `CSS.forcePseudoState` (target + ancestors) vs Playwright real interaction vs pseudo-states addon global; CSS-in-JS late rules; JS-driven hover (Radix `data-state`, MUI ripple) | Run all three on MUI, shadcn and the React golden fixtures (Shoelace post-M5, D-26); diff renders | Per-strategy success rates; default strategy ordering & auto-detection heuristics (e.g. hover handlers present ⇒ interact) | 3 d | D-14 |
| **S-09** | `createNodeFromSvg` fidelity (gradients, clipPath, mask, `<use>`, stroke alignment, `<text>`) and icon-font → outline pipeline (opentype.js/fontkit + harfbuzzjs ligatures) | SVG corpus from 3 icon sets + DS icons; T2 compare; outline extraction for Material Symbols / Font Awesome | Rules for when to rasterize; icon-font converter prototype; diagnostics list | 3 d | [05](05-capture.md), [07](07-mapping.md) |
| **S-10** | Figma GRID auto layout vs CSS grid: FLEX(fr)/FIXED/HUG tracks, gaps, spans, alignment, HUG containers (Update 120+), defaults for plugin-created grids (FIXED container, FLEX tracks); `SPACE_EVENLY`/`SPACE_AROUND` render parity (D-15) | Grid micro-fixtures; build with `layoutMode:'GRID'`, `setGridChildPosition`; T1 compare | Supported-subset table; `layout-sim` grid model calibrated | 3 d | [07](07-mapping.md) grid |
| **S-11** | Can Figma MCP `use_figma` run our applier server-side for CI harness or headless builds? Input size limits, execution time, images (`upload_assets`), fonts (account-uploaded only), determinism, pricing outlook | Bundle applier into a self-contained script; drive via remote MCP from a Node client; apply 10 fixtures; read back boxes; compare to desktop results | Feasibility verdict; limits table; harness design if viable; ToS/terms review note ([13](13-security-legal.md)) | 3 d | [12](12-quality.md) §4.4, Phase 7 MCP |
| **S-12** | Variables: bindable-field coverage in practice (padding, gap, radius, typography, effects), `setExplicitVariableModeForCollection`, mode limits per plan, `codeSyntax.WEB` matching and `importVariableByKeyAsync` against a team library, aliases across collections | On the user's Organization account only (no Starter/Pro bot accounts); scripted bindings; library publish + consume. `documentationLinks` holds one link (known) | Coverage matrix; plan-limit handling (`TOKEN_MODE_LIMIT` fallback); library-matching algorithm confirmed | 3 d | D-18, [08](08-tokens.md) |
| **S-13** | Nested component detection: React fiber `type` ↔ Storybook `component` refs (dev & prod builds); structural-hash fallback accuracy. Vue `__vueParentComponent.type`, Angular `ng.getComponent` and custom-element tags + CEM are post-M5 (D-26) | React + Vite golden fixtures with nesting (Card→Button→Icon), dev & static builds; plus the Figma SLOT API: `createSlot`, SLOT `addComponentProperty` once per set, `slotContentId` binding (typings gap), `SlotSettings` (`stretchChildOnInsert`, `displayEmptyByDefault`), GRID frames cannot be slots, INSTANCE_SWAP `preferredValues` with local keys | Detection precision/recall per build mode; prop-extraction reliability (`memoizedProps`); decision on default enablement; SLOT API notes | 4 d | D-21, [09](09-plugin.md) |
| **S-15** | Cross-file instance resolution: can a consumer or branch file resolve instances of library components to our `sid`/`vk`/`irh`? Is `getSharedPluginData` readable on remote main components (`getMainComponentAsync`), or is component key → registry `keys.json` needed? Is `detachedInfo` reliable? Can an outdated library instance be detected? | Library file + consumer file (and a Figma branch); instances before and after a library publish; read through the plugin and REST | Resolution path chosen; `keys.json` format; outdated-detection rule (`irh` vs registry) | 2 d | [15 §4.2, §4.13](15-change-requests.md#instance-versions) |
| **S-16** | Override → args round trip: does instance properties → args → re-render → same instance hold for VARIANT / BOOLEAN / TEXT / INSTANCE_SWAP / SLOT and nested instances? Which overrides fall outside properties (`instance.deviation`)? | Fixture components with every property kind; scripted: set properties, reverse-map, re-render the story, rebuild, compare | Reversibility table; `valueMap` gaps; snippet prop rendering confirmed | 3 d | [15 §4.5, §7.3](15-change-requests.md#snippet) |
| **S-17** | Automated Figma branch creation: can a branch (or file) be created without the UI? Do branches carry shared plugin data (`branch:meta`, `base:*`) on creation and on update from main (plugin data, and the UX of `irh` drift)? What happens if someone merges? | On the user's Organization account only. Try REST `POST /v1/files/:key/duplicate` (Enterprise + private OAuth app, `file_duplicate:write`) and MCP `create_new_file` for the duplicated-file fallback; create, edit, update and (test only) merge a branch with plugin data on root and variants | Supported creation path, or the manual UI flow with copy; plugin-data behaviour on create, update and (test-only) merge, since Holotype never merges (D-47; feeds [10 §9.5](10-sync.md#proposal-mode)) | 2 d | D-32, [15 §2](15-change-requests.md#branch-model) |
| **S-18** | Headless REST diff + shared plugin data (**absorbs S-14**, proposed in [10 §15](10-sync.md)). Known facts: `devStatus` is writable only on top-level nodes, REST annotations are capped at one per node, and `interactions` and `componentPropertyDefinitions` are exposed. Open: **subset (slice):** does `plugin_data=shared` at `depth=1` on the document node return root shared plugin data (`request:*`, `branch:meta`; needed for `dcr --pull` and `holotype status`), and do images resolve at `?version=`? **Rest (hardening):** REST ↔ plugin field parity for the normalizer (groups, `componentProperties`, overrides, `boundVariables`, `reactions` incl. `CHANGE_TO`, Sections) | The same file through both paths, diffed; a read on the document node at `depth=1` | Root-data and version check (slice); field coverage table and the `parity` fixture ([12 §2.4](12-quality.md#dcr-fixtures)) (hardening) | 3 d | D-34, D-35, [15 §4.1, §4.11](15-change-requests.md#interactions), [10 §15](10-sync.md) |
| **S-19** | CSS provenance via CDP + Vite source maps: do `rule.styleSheetId` + `style.range` and `CSS.styleSheetAdded` `sourceURL`/`sourceMapURL` map to the original file:line for plain CSS, CSS modules (de-hashed selectors), Tailwind v4 and emotion in the Vite dev server? Does `data-holotype-loc` injection work with React 19 + Vite? | The react-vite fixture repo on the dev server with `css.devSourcemap: true` via `viteFinal`; inline sheets via `ownerNode` → `data-vite-dev-id`; subtract `startLine/startColumn`; compare resolved locations with ground truth; prototype `@holotype/vite-plugin` (hardening). Slice: CSS modules only | Coverage per styling approach; resolver + plugin prototype; `DCR_PROVENANCE_*` thresholds; `DCR_PROVENANCE_NO_SOURCEMAP` when a sheet has no source map | 3 d | D-36, [05 §6.2](05-capture.md), [15 §5](15-change-requests.md#provenance) |

S-14 was proposed in [10 §15](10-sync.md) and never got a separate slot. Its question (REST read of root shared plugin data for CI status) is part of S-18, and the id is retired.

**L0 exit:** slice spike reports merged; D1 demo (a story appears in Figma as frames and text); README §5 updated for slice-relevant 🟡 items; CI green. Remaining spike reports are hardening milestones.

---

<a id="hardening"></a>

## Hardening track (H-A…H-G, M1–M5)

The old Phases 1–5 become hardening groups. Each starts after the slice item it extends ([BUILD §7](BUILD.md#hardening)); the tables below list only what is not already in the slice. **These are hardening exit criteria; they never block the slice.**

| Group | Was | Milestone |
|---|---|---|
| H-A Fidelity | Phase 1 | M1 |
| H-B Native structure | Phase 2 | M2 |
| H-C Variants at scale | Phase 3 | M3 |
| H-D Sync UX | Phase 4b | M4 |
| H-E DCR complete | Phase 4.5 | M4.5 |
| H-F Tokens complete + H-G Compatibility (SB 8/9 smoke, SB 11 at GA) | Phase 5 | M5 |

A quarterly **first-party check** re-verifies Figma's agent tools and the competitors of [01](01-landscape.md) (R1).

---

## H-A — Fidelity (M1; was Phase 1)

**Goal:** `holotype capture --story <id>` → bundle → plugin builds an **absolute-positioned** frame tree that is pixel-faithful. Absolute is the baseline that every later phase falls back to (D-15). The slice already covers light DOM + open shadow, solid paints, borders, Latin text, inline SVG and PNG/JPEG; H-A adds the rest.

| Package | Deliverables |
|---|---|
| `capture` | closed shadow roots, `display:contents`, affine transforms, gradients, masks, blend, filters, pseudo-elements (CDP), form controls, image transcode, CJK/RTL text, icon fonts (S-09), rasterization fallback |
| `mapper` | gradient/shadow/blur math (S-03), font mapping requests |
| `plugin` | report tab polish, read-back geometry for the new node kinds |
| `cli` | `export`, `doctor` (subset) |
| `fidelity` | T1, T2 harness on the owner's Mac (manual runs until a runner is decided); baseline v1 |

**Exit criteria:** on micro-fixtures excluding layout groups: p95 box error ≤1px, median SSIM_masked ≥0.98; text line parity ≥95%; fonts preflight works; harness green with ratchet. **Effort:** 10 agent-weeks, ~10 owner-hours.

---

## H-B — Native structure (M2; was Phase 2)

**Goal:** designer-grade structure: wrap and grid with verification (D-15), text fidelity (D-17), simplification and naming. Flex row/column → auto layout with fallback is already in the slice (L2).

| Package | Deliverables |
|---|---|
| `capture` | Typed OM size keywords, CDP matched styles (authored intent: `fr`, `flex`, `calc`), optional layout probing at multiple widths |
| `layout-sim` | Figma stack + wrap + grid simulation calibrated with S-10 / T1 data |
| `mapper` | wrap and grid mapping, margin strategies, absolute children + constraints, z-order handling, tree simplification, full naming chain, text sizing/truncation/wrap modes |
| `plugin` | grid writer (S-10), wrap, full `LAYOUT_*` diagnostics in report |
| `fixtures` | More React + Vite golden fixtures; real DS dogfooding pipeline on Storybook 10 (MUI, shadcn/ui, Radix-based kits). Vue/Lit ports deferred to post-M5 renderer expansion (D-26) |

**Exit criteria:** auto-layout coverage ≥75% on golden fixtures (≥85% target at M5), geometry p95 ≤1px maintained, text parity ≥97%, ≤5% layers with generic names (`div`, `span`) on golden fixtures. **Decision checkpoint M2:** D-22 (file organization). **Effort:** 14 agent-weeks, ~8 owner-hours.

---

## H-C — Variants at scale (M3; was Phase 3)

**Goal:** render-and-diff classification, pairwise matrices, states and large sets. Component sets with declared VARIANT/BOOLEAN/TEXT properties, cross-variant alignment and property bindings are already in the slice (L1).

| Package | Deliverables |
|---|---|
| `storybook` | docgen/manifest metadata (SB11 path), globals/themes discovery, pseudo-state strategies (S-08) |
| `planner` | variant source priority (D-12) beyond declared args, `if` pruning, pairwise mode, render-and-diff classification (D-13): VARIANT/BOOLEAN/TEXT/FIXED/IGNORED, duplicate-variant dedupe, `chromatic.modes` fallback reading |
| `mapper` | alignment for huge sets (S-06 step 2 limits) |
| `plugin` | doc frames, Sections/pages (D-22), relaunch buttons, Library tab with statuses (Not imported/Synced/Error), Import config screen |
| `cli` | `init`, `list --plan` |
| `storybook-addon` | typed `parameters.holotype` (types only) |

**Exit criteria:** golden Button/Input/Checkbox/Card imported as sets with ≥70% property quality; states captured where they have visual effect; first-run flow ≤5 min for the owner, Chromium download excluded; budgets enforced. **Effort:** 12 agent-weeks, ~8 owner-hours.

---

## H-D — Sync UX (M4; Phase 4b)

**Goal:** override-safe re-import (G5) with the full conflict UX. **Phase 4a** (identity index, keyed in-place reconciler obeying S-02 rules, `irh`/`ah` hashing, idempotent apply, proposal-mode preservation) is in the slice (L1).

| Package | Deliverables |
|---|---|
| `plugin` | apply plan preview, conflict detection + policies (take/fork), deprecation (D-20), rename detection, consumer-file retention, Diff preview + Conflicts screens, Outdated/Conflict/Deprecated chips |
| `cli` | `cache` command, `serve --watch` |
| `figma-fake` | override model matching the full S-02 matrix for L6 tests |
| `fidelity` | L6 sync e2e suite (designer-edit simulation) |

**Exit criteria:** 100% override retention on unchanged-structure suite; no-op re-sync = 0 writes; conflict detection precision 100% / recall ≥95% on simulated-edit suite; rename + deletion flows tested with library consumer file. **Effort:** 10 agent-weeks, ~10 owner-hours.

---

## H-E — DCR complete (M4.5; was Phase 4.5)

**Goal:** G9 at full breadth. The slice (L3–L5) already delivers proposal mode, the embedded baseline, the core DCR kinds, `prompt.md`, Submit with the request in the file, `dcr import` and verify v1. H-E adds everything else from [15](15-change-requests.md).

| Package | Deliverables |
|---|---|
| `dcr` | REST normalizer and parity; `variant.removed`, `node.*` beyond basic, `instance.outdated`/`instance.deprecated`; screen grouping by breakpoint × state (D-41); interactions; copy vs placeholder; content and accessibility annotations; `targets` split + `importSpecifier` |
| `capture` / `mapper` | `@holotype/vite-plugin` (dev-only JSX locations, `data-holotype-loc`) |
| `plugin` | optional Approve (D-44); Inspector polish; usage-only DCR for consumer files (screens and `instance.*` items resolved through registry `keys.json`, S-15; no baseline) |
| `cli` | `dcr --reextract`; MCP server `holotype mcp` with `design_changes`, `dcr_item`, `dcr_item_assets`, `list_dcrs`; topology A local server + pairing + `POST /v1/dcr` (S-01) |
| `fixtures` | REST `parity` fixture; consumer-file cases |

**Out:** `token.*` items (H-F); INSTANCE_SWAP / SLOT reverse mapping, `instance.detached/deviation` (composition); follow-up DCRs, the Tailwind adapter and CI comments (automation).

**Exit criteria:**
- Plugin and REST give the same core `dcrHash` on the parity fixture.
- Screens group correctly by naming convention and Sections. Snippets compile as JSX after replacing the pseudo-elements (a syntax check in tests).
- No designer string reaches the Rules or Verify sections (the `injection` fixture passes).
- Usability with the designer on the private dev plugin (D-39): a designer submits a branch with 5 kinds of change in ≤10 minutes without help. The reviewer approves from the summary alone.

**Effort:** 10 agent-weeks, ~10 owner-hours.

---

## H-F — Tokens complete (M5; was Phase 5) and H-G — Compatibility

**Goal:** G4 — variables, aliases, modes, bindings, styles, library matching (D-18). The slice tokens subset (one collection, default mode, exact `var()` bindings) is in L2. H-G adds SB 8/9 smoke tests and SB 11 tracking (at GA).

| Package | Deliverables |
|---|---|
| `capture` | custom property extraction per mode, CDP matched-style `var()` chain resolution per bound property |
| `mapper` | token graph (primitives/semantic collections), binding annotations on Scene nodes, theme → mode mapping, text/effect style candidates |
| `plugin` | variable collections/modes/aliases creation, bindings (paints, spacing, radius, typography, effects), explicit modes on variant frames, library matching (`codeSyntax.WEB` → name), Variables diff in preview (never overwrite), `TOKEN_MODE_LIMIT` fallback |

**Exit criteria:** on Chakra + Carbon + golden themes: ≥90% of `var()`-produced fill/stroke/spacing/radius values bound; 0 bindings on non-`var` values unless value matching enabled; mode switch on a set reproduces the dark-theme capture (SSIM_masked ≥0.98). README §4 fidelity metrics become release-gating from here. **H-G exit:** SB 8/9 smoke suites green; SB 11 tracked at GA. **Effort:** 8 agent-weeks, ~6 owner-hours.

---

## Composition (M6; was Phase 6)

**Goal:** nested components as instances (D-21), icons, INSTANCE_SWAP, SLOT. **First priority after M-Loop:** INSTANCE_SWAP for icon args (S-16 subset) and React-fiber nested instances (S-13), before full tokens.

| Package | Deliverables |
|---|---|
| `capture` | framework boundary hooks → component id + props per subtree (S-13): React fiber (D-26); Vue, Angular and custom-element hooks come with the post-M5 renderer expansion |
| `planner` | INSTANCE_SWAP classification (mapping/icon args), SLOT classification (children/ReactNode args), dependency graph + topological import order |
| `mapper` | instance substitution with props → variant/property values; icon extraction (repeated normalized SVG hash, `split` components), slot regions |
| `plugin` | instance creation + `setProperties`, preferred values, `createSlot`/SLOT properties, Icons page, instance-vs-capture verification (`APPLY_INSTANCE_MISMATCH`) |

**Exit criteria:** Card→Button→Icon nesting produces instances in the React + Vite golden fixtures (D-26); instance precision ≥98% (no wrong instance), recall ≥85%; icon swaps work in designer test. **Effort:** 10 agent-weeks, ~8 owner-hours.

---

## Automation (M7; was Phase 7)

**Goal:** G6 — CI, Code Connect, MCP sync tools.

| Package | Deliverables |
|---|---|
| `cli` | `codeconnect` (generate Code Connect files from plugin-exported node map), MCP **sync** tools (the server itself ships in H-E), `publish` (url / s3 / gh-pages), `status --figma-file`. `login --storybook` moves to L0/L1 (private Storybooks need it early) and `login --figma` to L4 |
| `plugin` | export node map for Code Connect |

Code Connect generation stays here; the bake-off uses hand-written Code Connect mappings. **Deferred until there is a second team:** the GitHub Action, the registry (and its manifest domains, D-10) and the Storybook addon panel.

**Exit criteria:** Code Connect files validate with Figma's CLI; MCP sync tools usable from an agent in an end-to-end demo; `publish` and `status --figma-file` tested on the fixture repo. **Effort:** 12 agent-weeks, ~6 owner-hours.

---

## Private org plugin (M8; was Phase 8)

**Goal:** 1.0 release, distributed privately (D-39).

- **Private organization plugin** published to the org only (no Figma review); dev-plugin users move to it ([11](11-ux.md)). Network domains justified, security disclosure ([13](13-security-legal.md#publishing)).
- Quality: crash-free plugin sessions ≥99.5% in real use; top-20 diagnostics reviewed for fixability.
- After launch (not in M8 scope): hosted renderer (topology C) with sandboxing ([13](13-security-legal.md)), decision gated on demand.

**Exit criteria:** README §4 targets met on golden + micro corpus; owner + designer acceptance on the owner's repo; no open P0/P1. **Effort:** 6 agent-weeks, ~10 owner-hours.

<a id="public-track"></a>

### Public track (optional, post-M8)

Only if the project goes public: docs site (getting started, config reference generated from TypeBox, diagnostics pages, recipes, migration guide from story.to.design with the `parameters.s2d.variantProperties` reader, [04](04-variant-model.md)); published benchmarks ([12](12-quality.md) §4.5); Community listing (D-39: trademark-compliant title, privacy policy, submit ≥3 weeks before the target date); trademark search and repo rename ([13](13-security-legal.md#publishing)); the Action, registry and addon once a second team exists. Risks R9 and R10 belong here.

---

## Milestones

| M | Name | Definition of done | Decisions due |
|---|---|---|---|
| M0 | Foundations | Phase 0 exit criteria | D-25, D-16, D-10 confirmed |
| M1 | Snapshot | Phase 1 exit | — |
| M2 | Native structure | Phase 2 exit | D-22 |
| M3 | Components alpha | Phase 3 exit; private alpha for the user and their boss (dev plugin, D-39) | D-01 shortlist |
| M4 | Sync beta | Phase 4 exit | — |
| M4.5 | DCR MVP | Phase 4.5 exit; the flagship demo for the user and their boss | D-41…D-45 (proposed in [15 §13](15-change-requests.md)); screens target default ([15 §14](15-change-requests.md)) |
| M5 | Tokens | Phase 5 exit; metrics gating | — |
| M6 | Composition | Phase 6 exit; org beta (private organization plugin, D-39) | — |
| M7 | Automation | Phase 7 exit | registry hosting |
| M8 | Launch | Phase 8 exit | hosted tier go/no-go; Community listing (post-M8, D-39) |

---

## Risk register

L = likelihood, I = impact (H/M/L).

| # | Risk | L | I | Mitigation | Owner phase |
|---|---|---|---|---|---|
| R1 | Figma ships native Storybook→components (extends code-to-canvas to components/variants) | M | H | Differentiate on open source, CI, override-safe sync, properties quality, tokens; benchmark publicly; keep `mapper` reusable to target `use_figma` | all, review at each M |
| R2 | Chrome LNA / browser policy blocks loopback for plugin iframes | H | M | Desktop app primary; file import always (D-10); registry/CI topology; S-01 | 0, 7 |
| R3 | Storybook 11/12 changes preview internals (`__STORYBOOK_PREVIEW__`, channel events, docgen move to server) | H | M | Adapter compatibility layer per version; prefer public events + manifests; sandbox matrix nightly on `next`; optional addon as stable integration point | 3, ongoing |
| R4 | Override preservation under in-place mutation less reliable than assumed | M | H | S-02 matrix early; conservative reconciler; snapshot/restore overrides fallback; `SYNC_OVERRIDE_NOT_RESTORED` reporting; prefer component properties over layer overrides | 0, 4 |
| R5 | Fonts unavailable in Figma (web fonts not installed for org) | H | M | Fonts preflight + mapping persisted; record originals for restoration; doctor forecast; docs on org font upload | 1 |
| R6 | Text wrap drift Chromium vs Figma | H | M | S-04 data; width buffer; `locked-lines` mode; per-font policy | 0, 2 |
| R7 | Combinatorial explosion / giant sets degrade Figma | M | M | Budgets, pairwise, render-and-diff dedupe, properties instead of axes (D-12, D-13), S-06 limits | 3 |
| R8 | Plugin freezes or OOM on big imports | M | H | Time-slicing, chunked NDJSON, per-component commits, S-06 measured limits, cancel | 1, 3 |
| R9 | Community review delays / rejection (network access, localhost reasoning) | M | M | Private org plugin first (no review, D-39); Community only after M8 with minimal domains, clear reasoning, privacy policy, early submission | post-M8 |
| R10 | Trademark conflict over name | H (if unchanged) | M | Name chosen early (Holotype, D-01); formal trademark search before any public listing; repo renamed from `figmabook` | 3–8 |
| R11 | CSS-in-JS late rules / JS-driven states missed | M | M | CDP force + interact fallback (S-08), "no visual effect" detection | 3 |
| R12 | `use_figma` pricing/limits make headless harness impractical | M | L | macOS runner remains primary | 0, 7 |
| R13 | Variables mode limits per plan block theming | M | L | `TOKEN_MODE_LIMIT` fallback to axis | 5 |
| R14 | Nested component detection unreliable in production builds (minified names, no fiber debug) | M | M | Use `component` reference identity (not names), structural hash fallback, verification before instancing (D-21) | 6 |
| R15 | Scope creep / timeline slip | H | M | Phase exit criteria, ratchet metrics, defer hosted tier | all |
| R16 | Legal challenge from competitor | L | M | Clean-room implementation, no clipboard reverse-engineering ([13](13-security-legal.md)) | all |
| R17 | REST lacks fields the DCR needs (plugin data, reactions, annotations), so headless extraction is incomplete | M | M | S-18 early; plugin path is preferred and always complete; `DCR_SNAPSHOT_PARITY` reporting | 0, 4.5 |
| R18 | Prompt injection through designer text steers the user's agent | M | H | D-38 fencing/escaping, `injection` golden fixture, contract rule 8, PR review (D-37) ([13 §2.5](13-security-legal.md#dcr)) | 4.5 |
| R19 | Figma branches drop or mangle shared plugin data on create/merge | M | M | S-17; duplicated-file fallback (D-32); CLI-cache baseline (`DCR_BASELINE_EXTERNAL`) | 0, 4.5 |
| R20 | Provenance unreliable outside CSS modules (CSS-in-JS, Tailwind) | M | M | S-19 coverage table; selector-only fallback flagged `DCR_PROVENANCE_MISSING`; Tailwind adapter (Phase 7) | 4.5, 7 |

---

## Open questions

From README §9 (user decisions):
1. D-01 public name (in progress).
2. ~~License~~ → MIT (decided).
3. ~~Fixture target~~ → React + Vite on Storybook 10 (decided, D-26). Vue/Lit/Angular fixtures move out of Phases 2–3 to post-M5 ("renderer expansion"); the pipeline stays DOM-based so they work best-effort meanwhile.
4. ~~Distribution~~ → private: dev plugin from `manifest.json` now, private org plugin once stable, Community after M8 (decided, D-39).
5. ~~Storybook 7.6~~ → not supported; SB10 primary, 11 at GA, 8/9 best-effort (decided, D-11).

Technical (answered by spikes or during phases):
6. WebSocket vs SSE/HTTP chunking for streaming (S-01).
7. Default `strokesIncludedInLayout` model (S-05).
8. Default variant budget per set (S-06).
9. Default text wrap mode per font class (S-04).
10. Is `use_figma` viable for CI (S-11)?
11. Should doc frames be components themselves (for reuse) or plain frames? (Phase 3)
12. Registry hosting: first-party domain vs GitHub Pages only (Phase 7; manifest domains are fixed at publish time).
13. Prototype state reactions on by default? (Phase 3 usability test)
14. Should the mapper also be bundled into the plugin for future in-plugin re-inference? (post-M4)
15. Where do screens live: in the UI repo, or in a separate app repo? Default **same repo**; separate repos via `dcr.targets.screens` ([15 §5.5, §14](15-change-requests.md#targets)). (Phase 4.5)

---

## First 30 days (issue-sized tasks)

Week 1 — repo & contracts
1. Init monorepo: pnpm workspace, Turborepo pipeline (`build`, `test`, `lint`, `typecheck`), Biome config, tsconfig base (strict, ESM), Vitest workspace. (E1)
2. CI workflow: install, cache, lint/typecheck/test; changesets bot. (E1)
3. Scaffold packages from README §6 with `index.ts`, README, test placeholder. (E2)
4. `ir`: canonical JSON + sha256 hashing + fast-check property tests. (E2)
5. `ir`: TypeBox schema v0 for bundle manifest + JSON Schema emission + committed schema check. (E2)
6. `shared`: diagnostics registry + docs-page CI check + first 10 codes. (E3)
7. `plugin`: create-figma-plugin scaffold, manifest (`dynamic-page`, candidate `networkAccess`), "spike runner" UI. (E3)

Week 2 — spikes batch A
8. S-01 LNA connectivity matrix + report. (E3)
9. S-07 Storybook sandboxes generator script (react-vite on 10.6 + 11-beta; 8.6/9.1 smoke) + render loop prototype. (E1)
10. S-03 gradient/shadow/blur sweeps (micro-fixtures + Figma builder script). (E2)
11. S-05 border model sweep. (E2)
12. Fixtures: first 30 micro-fixtures (flex, borders, backgrounds, text basics) as plain-markup stories in the React + Vite Storybook (D-26). (E1)

Week 3 — spikes batch B
13. S-02 override preservation matrix (local + library). (E3)
14. S-04 text parity corpus + measurement script. (E2)
15. S-08 pseudo-state strategies on golden fixtures + MUI/shadcn. (E1)
16. S-10 grid conventions. (E2)
17. S-06 synthetic Scene generator + perf harness in plugin. (E3)

Week 4 — spikes batch C + smoke path
18. S-09 SVG/icon-font fidelity. (E2)
19. S-11 `use_figma` feasibility. (E3)
20. S-12 variables coverage & plan limits (needs bot accounts on 3 plans). (E3)
21. S-13 nested component detection prototype (React; other renderers via structural hash only). (E1)
22. Smoke path: CLI captures one micro-fixture → minimal Capture IR → absolute Scene IR → plugin file import builds rectangles + text. (all)
23. macOS self-hosted runner provisioning + Figma desktop bot account + "run last plugin" automation proof. (E3)
24. Write spike reports; update README §5 decisions; replan Phase 1 estimates. (all)

Week 5 — DCR spikes (flagship de-risking, [15](15-change-requests.md))
25. S-17 branch creation + plugin data on merge, and S-15 cross-file instance resolution, on the user's Organization account. (E3)
26. S-18 REST ↔ plugin field coverage and parity fixture (absorbs S-14). (E3)
27. S-19 CDP + Vite source-map provenance; `@holotype/vite-plugin` prototype. (E1)
28. S-16 override → args round trip on golden fixtures. (E2)
