# 12 — Quality, fidelity, performance, diagnostics, observability

> This chapter defines how we *know* Holotype works: the test pyramid, the fixture corpus, the fidelity harness that measures README §4 metrics, performance budgets, the diagnostics catalog, observability and release gates.

---

## 1. Test pyramid <a id="pyramid"></a>

| Layer | What | Tools | Runs |
|---|---|---|---|
| **L0 static** | types (strict), Biome lint/format, schema emission diff (TypeBox → JSON Schema committed; CI fails if regenerated schema differs) | tsc, Biome | every PR |
| **L1 unit** | pure functions per package | Vitest | every PR |
| **L2 property-based** | invariants of canonical JSON, hashing, layout-sim, gradient math, color conversion | fast-check + Vitest | every PR |
| **L3 snapshot** | DOM fixture → Capture IR; Capture IR → Scene IR; Scene IR → `figma-fake` scene graph | Vitest file snapshots (deterministic JSON, sorted keys) | every PR |
| **L4 integration** | Storybook adapter against generated sandboxes per SB version (react-vite until M5, D-26); capture end-to-end in Chromium | Playwright (pinned Chromium, D-05) | every PR (smoke subset), nightly (full matrix) |
| **L5 fidelity** | T0/T1/T2 harness (§4) in real Figma | Figma desktop: manual on the owner's Mac now; macOS runner or S-11 path later (§4) | per slice demo + release; nightly once the runner exists |
| **L6 sync e2e** | apply → designer-edit simulation → re-sync → assert overrides/conflicts | real Figma (harness mode) + `figma-fake` mirror | nightly |
| **L7 usability** | scripted tasks with the owner + 1–2 designers (including the boss) at every slice demo D4, D5, D6, and at M4 (resolve a conflict, re-sync) and M4.5 (submit, approve, pull the request on a second machine); 5 DS engineers + 5 designers at M5 and M8. No new flow ships without one (D-40) | moderated sessions | slice demo + milestone |

### 1.1 Per-package matrix

| Package | L1 unit focus | L2 properties | L3 snapshots | L4/L5 |
|---|---|---|---|---|
| `ir` | schema validation, migrations `vN→vN+1` | canonicalJSON idempotent, key-order independence, `hash(x)=hash(roundtrip(x))`, NaN/−0/float normalization | schema fixtures (valid/invalid corpus) | — |
| `shared` | diagnostic registry (unique codes, templates render) | — | — | — |
| `storybook` | index parsing v5 (SB 8.x–11; v3/v4 dropped with SB 7, D-11), URL args encode/decode, argTypes inference, `if` evaluation | buildArgsParam∘parse = id on safe values | metadata extraction per SB version (recorded) | sandbox matrix (§3.3) |
| `capture` | text-run extraction, whitespace collapse, pseudo `content` resolution, affineFromQuad, color parse/convert, gradient parse | color convert in-gamut round trips; quad→affine→quad | **DOM micro-fixture → Capture IR** | Chromium real render |
| `planner` | matrix building, `if` pruning, budgets, pairwise generator, classification decision table | pairwise covers all value pairs; budget never exceeded | plan for fixture components | render-and-diff in Chromium |
| `mapper` | flex/grid/block classification, sizing decisions, margin strategies, alignment across variants, naming chain, token binding | simplification preserves absolute geometry (every node's abs rect unchanged by collapse) | **Capture IR → Scene IR** | — |
| `layout-sim` | auto layout + wrap + grid algorithm | `simulate(spec(rects)) == rects` for generated specs; monotonicity under FIXED sizes | — | calibrated vs real Figma (T1) nightly |
| `plugin` (applier) | build-order rules (append before FILL, layoutMode before padding…), font/image dedupe, reconciliation diff | reconcile(plan, plan) → zero writes; reconcile is order-independent for keyed children | **Scene IR → figma-fake graph + op log** | real Figma T1/T2, L6 |
| `figma-fake` | contract tests: each `FigmaPort` method throws exactly where Figma throws (e.g. FILL without auto-layout parent, HUG on non-AL frame) — table generated from S-05/S-06 observations | — | — | conformance replay vs real Figma (record ops in harness, replay in fake, compare final graph) |
| `cli` | flag parsing, exit codes, config loading | — | `--json` output snapshots | e2e on fixture Storybook |
| `storybook-addon` | parameter typing, manifest emission | — | — | sandbox build |
| `dcr` | identification, field diff + noise filter, classification, reverse prop mapping, screen grouping, interaction mapping, placeholder rules, a11y grammar, `importSpecifier`, `renderSnippet`, `renderPrompt` | **shuffle invariance** (§2.4); `normalizeRest(x)` ≡ `normalizePlugin(x)` on the parity fixture; escaping never lets designer text leave its fence or cell | **`fixtures/dcr/*` → `dcr.json` + `prompt.md`** (§2.4) | `holotype verify` e2e on the react-vite fixture branch |

**Golden tests for the loop slice:**

| Test | Asserts |
|---|---|
| `init` `.gitignore` | `init` writes `.holotype/*`, `!.holotype/requests/`, `!.holotype/branches/` ([02 §5.4](02-architecture.md#workspace)); requests and branch links are tracked, everything else is ignored |
| capture determinism | a fixture story that renders `new Date().toISOString()` captures byte-identically on two runs (pinned `page.clock`, §1.2) |
| `dcrHash` parity | the core hash computed by the plugin equals the hash the CLI recomputes after it attaches provenance (R5, [15](15-change-requests.md#dcr-hash)) |

### 1.2 Determinism requirements (prerequisite for snapshots and caching)

- Pinned Chromium + Playwright (D-05), fonts installed in CI image from a lockfile (`fixtures/fonts.lock`), D-24 context options, `page.clock` pinned, `Math.random` seeded via init script.
- Canonical JSON (lengths 1/1000 px, ratios and matrices 1e-6; exact rules in [06 §5](06-ir.md)).
- Snapshot updates only via `pnpm test -u` with reviewer sign-off; snapshot diffs rendered in PR as a summary (counts of changed nodes per fixture).

---

## 2. Fixture corpus <a id="fixtures"></a>

### 2.1 Golden component library (`fixtures/ds-react/`)

One component **spec**, implemented in **React + Vite on Storybook 10** (`@storybook/react-vite`, D-26). Until M5 this is the only implementation. **Vue 3**, **Lit** and **Angular** ports (Angular as the docgen/Compodoc outlier) come with the post-M5 renderer expansion. Each implementation is styled three ways where meaningful: plain CSS modules, CSS-in-JS (emotion — exercises late-injected rules for D-14), Tailwind (exercises utility classes, rings, `--tw-*` vars).

| Component | Exercises |
|---|---|
| Button (variant×size×state, leading/trailing icon, loading spinner) | variants, BOOLEAN visibility, TEXT label, INSTANCE_SWAP icon, states, ring focus |
| IconButton, Icon (sprite `<use>`, inline SVG, icon font) | SVG pipeline, icon extraction, split components |
| Input / Textarea (label, helper, error, prefix/suffix, placeholder) | `::placeholder`, native controls, text runs |
| Checkbox / Radio / Switch (native & custom) | `appearance`, `:checked`, accent-color, active state |
| Select (native) + Combobox (portal listbox) | portals, synthesized native select |
| Badge / Tag / Chip (inline) | inline boxes, `getClientRects`, HUG |
| Avatar / AvatarGroup (negative margins, overlap) | z-order, negative spacing, images `object-fit` |
| Card (image, title, body, actions; `margin-top:auto` footer) | margin strategies, FILL, clamp text |
| Alert / Toast | icons, multi-run text, close button |
| Tabs, Breadcrumbs, Pagination | horizontal stacks, separators via `::before/::after` |
| Tooltip / Popover / Modal | portals, shadows, backdrop blur, fixed positioning |
| Table (sticky header) | table → stacks, sticky |
| Grid layout (dashboard tiles: `fr`, `minmax`, spans, auto-fill) | Figma GRID mapping |
| Typography specimen (headings, `line-height: normal`, letter-spacing, truncation, line clamp, RTL, CJK, emoji) | D-17, fonts |
| Theme showcase (light/dark/brand) | modes, tokens, aliases |

### 2.2 Per-feature micro-fixtures (`fixtures/ds-react/src/micro/`: plain-markup stories in the React + Vite Storybook, D-26)

Each micro-fixture is one story that isolates one feature; ~200 total, grouped:

| Group | Cases |
|---|---|
| flex | row/column, reverse, wrap (row/column/wrap-reverse), gap/row-gap, every `justify-content`, every `align-items` incl. baseline, `align-self` overrides, grow equal/unequal, shrink, basis, `order`, auto margins (main/cross), negative margins, nested flex, inline-flex, anonymous text items |
| block flow | vertical stacks with margins (collapse), `margin: 0 auto`, floats (fallback), `display:contents`, `flow-root` |
| grid | fixed/fr/auto/minmax tracks, gaps, spans, explicit placement, auto-placement, `auto-fill/auto-fit`, `dense` (fallback), named areas (fallback), alignment props |
| sizing | width auto/%/fit-content/min/max-content, min/max clamps, box-sizing variants |
| positioning | absolute with each inset combo, centered by transform, fixed, sticky, z-index escapes, stacking contexts (opacity/transform/filter/isolation) |
| typography | font weights 100–900, italics, variable font axes, synthetic bold, `line-height` normal/unitless/px/%, letter-spacing, word-spacing, text-transform ×4, decorations (style/color/thickness/offset), text-shadow, `text-overflow`, `-webkit-line-clamp`, `white-space` ×6, `<br>`, mixed inline styles, links, `text-wrap: balance/pretty`, `text-box-trim`, RTL, CJK, emoji, icon fonts (PUA + ligatures) |
| borders | uniform, per-side widths, per-side colors, dashed/dotted/double/groove/ridge/inset/outset, outline + offset, radius per-corner/percent/elliptical/overflowing |
| backgrounds | solid with alpha, modern colors (oklch, color-mix, display-p3), linear (angles, corners, hard stops, transparent stops, `in oklch`), radial (shapes/sizes/positions), conic, repeating, multiple layers, background-clip (text/padding/content), background-image url with size/position/repeat |
| effects | box-shadow multi/inset/spread/ring, filter blur/drop-shadow/others (raster), backdrop-filter, opacity, mix-blend-mode, isolation |
| transforms | rotate, scale, skew, translate, nested, transform-origin, 3D (raster) |
| clipping | overflow hidden/clip/scroll + scroll offset, axis-specific overflow, clip-path inset/circle/polygon/path, mask-image (icon tint, gradient) |
| svg | inline, `currentColor`, `<use>` local/shadow-root/external sprite, gradients, clipPath, mask, filter (raster), `<text>`, `foreignObject` (raster) |
| images | img srcset/picture, object-fit ×5 + object-position, WebP/AVIF/SVG-as-img (rasterized), >4096px (downscaled), lazy-loaded, canvas, video poster |
| pseudo | ::before/::after (text, counters, attr(), images, positioned), ::marker (list types), ::placeholder, ::selection (ignored) |
| shadow DOM | open, closed (attachShadow hook), slots with fallback, nested hosts, adoptedStyleSheets, `::part` |
| portals | body-appended overlay, multiple portals, portal + backdrop |
| themes | class, data-attribute, JSX provider; CSS var aliases chains; `calc()`/`color-mix()` on vars (unbindable) |
| states | CSS `:hover` direct/ancestor (`.card:hover .icon`), `:focus-visible`, `:focus-within`, `:active`, JS-driven hover (`onMouseEnter`, Radix `data-state`), CSS-in-JS late rules |

### 2.3 Real-world design systems (dogfooding, nightly, not pass/fail on fidelity — tracked as trend)

Until M5, dogfooding runs only the React systems, on Storybook 10 (D-11, D-26). The non-React rows join with the post-M5 renderer expansion.

| DS | Why | Renderer | When |
|---|---|---|---|
| **MUI** | most-used React DS; emotion CSS-in-JS; ripples (JS state); portals | React | now |
| **shadcn/ui (Radix + Tailwind)** | Tailwind + rings + `data-state` driven states; huge adoption | React | now |
| **Ant Design** | dense component set, CSS-in-JS tokens, many variants | React | now |
| **Chakra UI v3** | CSS variables tokens + recipes → strong token/mode test | React | now |
| **Carbon (IBM)** | official public Storybook, React + Web Components, rigorous tokens | React, WC | now (React); WC post-M5 |
| **Web Awesome / Shoelace** | closed/open shadow DOM, CSS parts, CEM docgen | Lit / WC | post-M5 |
| **Spectrum Web Components (Adobe)** | shadow DOM at scale, themes, Lit | Lit / WC | post-M5 |
| **Angular Material** | Compodoc docgen, Angular dev-mode component detection (D-21) | Angular | post-M5 |
| **Vuetify** or **PrimeVue** | Vue 3 docgen, slots | Vue | post-M5 |

Selection criteria: public Storybook or buildable from source with a permissive license; covers each styling approach (and, post-M5, each renderer); ≥1 heavy shadow-DOM system; ≥2 token-driven theming systems. Each pinned to a commit in `fixtures/real/lock.json`; built once per pin and cached.

### 2.4 DCR golden fixtures (`fixtures/dcr/`) <a id="dcr-fixtures"></a>

Each case is a directory: `input/` holds the saved REST file JSON (`GET /v1/files/:key?plugin_data=shared`), the embedded baselines, the provenance side files ([15 §5.2](15-change-requests.md#provenance)) and `holotype.config.ts → dcr`. `expected/` holds `dcr.json` and `prompt.md` (plus `prompt.components.md` / `prompt.screens.md` when targets differ). The cases follow [15 §6.1](15-change-requests.md#dcr-ir) and cover one item kind each, then combinations:

| Case | Exercises |
|---|---|
| `modified-padding` | field diff, D-16 reverse arithmetic, token before/after, provenance file:line |
| `variant-added`, `property-added` | derived variants, duplicated `vk`/`nk` resolution |
| `component-new` | structure, nearest-component scoring, untokenized radius question |
| `screen-breakpoints-states` | naming convention + Sections, base/delta, `expectStates` question |
| `screen-interactions` | navigate / overlay / back / `CHANGE_TO` hover covered by code / unsupported actions |
| `screen-content-a11y` | copy vs lorem / `{{…}}` / component default; role, label, focus-order gaps |
| `instance-outdated`, `instance-deprecated` | `irh` mismatch, removed `vk`, `replacedBy` + `argMap`, no replacement |
| `targets-split` | separate screens repo: package imports, prompt split, `DCR_IMPORT_UNRESOLVED` |
| `injection` | designer strings with "ignore previous instructions", backticks, `</td>`, `{}`: still fenced/escaped, `DCR_NOTE_SUSPICIOUS` |
| `snippet/*` | one per row of the snippet table ([15 §7.3](15-change-requests.md#snippet)) → `*.jsx-sketch` |
| `parity` (after S-18) | the same file through plugin and REST: byte-identical `FigmaSnapshot` |

**Determinism test (D-35).** Each case runs 3 times: as is, and twice with input shuffled by a seeded permutation (object key order, `children`/`nodes`/`pages` array order where the order isn't semantic, variable and annotation order). All outputs must be **byte-identical** (sha256 of `dcr.json` and `prompt.md`); `header.generated` is omitted in tests. A second check re-runs extraction on its own output's file version and expects the same `dcrHash`, so item ids stay stable across re-extractions. Expected files change only through `pnpm test -u`, with reviewer sign-off (§1.2).

### 2.5 Agent-eval corpus <a id="agent-eval"></a>

The DCR goldens (§2.4) prove the request is right. The agent-eval corpus measures whether a coding agent can implement it.

- **Corpus:** ≥10 DCR fixtures on a throwaway repo cloned from `fixtures/ds-react`. Each is a designer branch with known intended items and a reference implementation.
- **Runs:** on a schedule (weekly, and before each slice demo), through ≥2 coding agents (for example Claude Code and Codex).
- **Results:** stored as `fixtures/agent-eval/results/<date>.json`.

| Metric | Definition |
|---|---|
| first-pass verify rate | items that pass `holotype verify` after one agent run, per item kind |
| false-change rate | changes the agent made that no item asked for |
| unrelated-diff size | lines changed outside the provenance files and new component dirs |
| token correctness | items that use the intended token, not a literal or a wrong token |
| provenance coverage | items whose code location was given in the request |

---

## 3. Storybook adapter integration tests

- **Sandboxes generated**, not hand-maintained: `npx storybook@<ver> sandbox <template>`-style templates (or `create-storybook` with pinned versions) for renderer **react-vite** (D-26) on SB **10.6.x** (primary, full suite, PR gate) and **11.x** (tracked from beta, full nightly; PR gate at GA), plus **8.6.x / 9.1.x** as smoke tests only (best-effort, D-11). SB 7.x is not run. vue3-vite, web-components-vite, angular and svelte-vite cells are added by the post-M5 renderer expansion. Our golden fixture stories are copied in.
- Both **dev server** and **static build** per SB 10/11 cell; static only for the nightly full matrix to save time.
- Assertions: index parse, metadata (args/argTypes/docgen incl. SB11 `docgenServer` path via `manifests/components.json`), render loop (setCurrentStory/updateStoryArgs/updateGlobals), readiness (storyFinished ?? storyRendered), errors mapped to `SB_*` codes, pseudo-state strategies, theme discovery.
- Matrix result published as a support table in docs (auto-generated).

---

## 4. Fidelity harness <a id="fidelity-harness"></a><a id="fidelity"></a><a id="harness"></a>

Real-Figma fidelity runs manually on the owner's Mac (desktop app) until a self-hosted runner is decided; the macOS bot runner (§4.4) is hardening. Fidelity metrics are tracked from slice demo L1 and gate only from M5 (README §4). "Nightly" below means nightly once the runner exists.

### 4.1 Tiers

| Tier | Compares | Where | Signal |
|---|---|---|---|
| **T0 — capture integrity** | Capture IR rects/text lines vs live DOM re-measure; Scene IR absolute geometry (after inference + simplification) vs Capture IR | Node/Chromium, every PR | catches mapper geometry bugs without Figma |
| **T0.5 — simulated layout** | `layout-sim(Scene IR)` child positions vs Capture IR | Node, every PR | auto-layout decisions consistent (D-15 capture side) |
| **T1 — Figma read-back** | real Figma `absoluteBoundingBox` of every managed node vs Capture IR rect; text node line count (`height / lineHeightPx`) vs browser lines | real Figma, nightly | geometry fidelity metric, text parity metric, layout-sim calibration |
| **T2 — pixels** | Figma `exportAsync({format:'PNG', constraint:{type:'SCALE', value:2}})` of each variant vs Playwright element screenshot @DPR 2 | real Figma, nightly | visual fidelity metric |

### 4.2 Scoring

Per variant *v*, nodes *N(v)*:

- **Box error** `e_n = max(|Δx|,|Δy|,|Δw|,|Δh|)` (px, page space). Variant geometry score `G(v) = p95_n e_n`. Metric: p95 over all nodes in corpus ≤1px (README §4).
- **Pixel score**: pixelmatch on alpha-composited RGBA (threshold 0.1, antialiasing detection on) → `P(v) = 1 − diffPixels/totalPixels`; **SSIM** (ssim.js, 8×8 windows, grayscale) → `S(v)`. Metric: median `S` ≥0.985, p10 ≥0.95.
- **Text masking**: text rasterization differs between Chromium and Figma even when geometry is perfect. T2 computes two scores: `S_full` and `S_masked`, where `S_masked` masks each text node's line boxes (from IR) with a flat color on both images; text is judged by T1 (line count + box error) instead. Report both; gates use `S_masked` and T1 text metrics.
- **Composite fidelity** shown in UI/report: `F(v) = 0.5·S_masked + 0.3·clamp(1 − G(v)/4) + 0.2·textParity(v)`; component score = min over its variants (worst variant surfaces).
- **Auto-layout coverage** = containers emitted with `layoutMode ≠ NONE` and kept after read-back / all containers with ≥2 children.
- **Property quality** = args classified BOOLEAN/TEXT/INSTANCE_SWAP/SLOT (verified) / args eligible (non-FIXED, non-IGNORED).

### 4.3 Ratchet CI

Inspired by figit's oracle/parity ratchet ([research](../research/dom-to-figma-brief.md)):

- `fidelity/baseline.json` stores per-fixture scores and diagnostic counts per code.
- Nightly run fails if any fixture's `F` drops by >0.005, any `G` rises by >0.25px, auto-layout coverage drops, or a diagnostic count *increases*, unless the PR that caused it updates the baseline with a justification label `fidelity-baseline-change`.
- Improvements auto-propose a baseline-bump PR (ratchet only moves forward).
- Trend dashboard (`tools/fidelity` → static HTML in CI artifacts / GitHub Pages).

### 4.4 Where real Figma runs

0. **Now: manual runs** on the owner's Mac in the desktop app, using the same harness mode as below, started by hand.
1. **Hardening: self-hosted macOS runner** with Figma desktop logged into a dedicated bot account (Professional or Organization plan to allow modes, D-18 tests), a fixed test file per suite. The dev plugin is imported from manifest; automation launches it via AppleScript/`osascript` keyboard shortcut ("Run last plugin") with `harness` mode stored in clientStorage. Harness mode: plugin pulls fixtures from the local server, applies, reads back boxes, exports PNGs, posts results to `/v1/fidelity`, closes. Dev plugins run reliably only in the desktop app (research: architecture brief).
2. **Experimental: Figma MCP `use_figma`** (S-11) — run builder code server-side against a test file; would remove the macOS runner. Constraints: 48 KB output per call, no images directly, beta/usage-based pricing.
3. **REST image export** (`GET /v1/images/:key?ids=…&format=png&scale=2`) as a fallback for T2 if `exportAsync` round-trips are a bottleneck. Tier 1 rate limit: only 10–20 req/min with Dev/Full seat; **20/month for View/Collab** → bot account must hold a Full seat; batch many ids per request.
4. Real-Figma conformance replay: the harness records the op log; `figma-fake` replays it; any divergence in thrown errors or final structure fails `figma-fake` contract tests (keeps the fake honest).

### 4.5 Competitive benchmark

Quarterly (and before launch): run the micro-fixture and golden corpus through **Figma code-to-canvas** (`generate_figma_design`) and, where licensing permits, story.to.design trial, into separate files; score with the same T1/T2 harness (geometry, SSIM, auto-layout coverage, layer count, naming quality sample). Publish methodology and results (marketing + honesty; [01](01-landscape.md)). The design-to-code direction is benchmarked separately (§4.6).

### 4.6 DCR bake-off <a id="bake-off"></a>

The same designer branch is implemented by the same agent twice:

- **(a)** with Figma MCP `get_design_context` + Code Connect (hand-written mappings for the fixture components);
- **(b)** with the Holotype DCR.

| Measure | How |
|---|---|
| verify pass rate | `holotype verify` on both results |
| unrelated-diff size | as in §2.5 |
| token correctness | as in §2.5 |
| new-vs-existing mistakes | new components built where an existing one fits, and the reverse |
| reviewer minutes | time a reviewer needs to approve the PR |

The bake-off is required before M-Loop exit ([14](14-roadmap.md#m-loop)). Results are published internally.

---

<a id="performance-budgets"></a>

## 5. Performance budgets

Reference machine: Apple M2 / 16 GB (local) and GitHub `ubuntu-latest` 4 vCPU (CI).

| Stage | Budget | Measured by |
|---|---|---|
| Preview init (first `iframe.html` load + `ready()`) | ≤3 s static, ≤6 s dev | `bench:storybook` |
| Metadata for 500 stories (`loadStory` loop) | ≤10 s | |
| Variant capture (warm page: args update → settled → serialized) | median ≤400 ms, p95 ≤1.2 s (README §4) | per-variant timing in report |
| Serializer on a 200-node component | ≤60 ms in-page | `performance.now` in page |
| CDP enrichment (platform fonts, matched styles) per variant | ≤80 ms | |
| Mapper per variant (200 nodes) | ≤15 ms; component alignment ≤50 ms for 50 variants | `bench:mapper` |
| Bundle size | ≤50 KB per 20-node variant before assets; assets deduped by sha256 | |
| Plugin apply, 20-node variant | ≤60 ms | harness timing |
| Plugin apply, 1,000 variants | ≤3 min, no main-thread slice >100 ms (target 16 ms slices) | S-06 harness |
| No-op re-sync | 0 writes, ≤2 s for 1,000 variants (index + hash compare) | |
| Memory: CLI capture | ≤1.5 GB RSS with 4 contexts | |
| Memory: plugin main | no growth >200 MB across 5 consecutive 1k-variant applies (S-06) | |

Benchmarks live in `bench/` (Vitest bench + Playwright), run nightly; >10% regression on any median opens an issue automatically.

---

<a id="diagnostics"></a>

## 6. Diagnostics catalog

### 6.1 Structure and process

```ts
// packages/shared/src/diagnostics.ts — single registry; codes are API (never renamed, only deprecated)
export interface DiagnosticDef {
  code: string;                 // UPPER_SNAKE, domain-prefixed
  domain: 'SB'|'PLAN'|'CAP'|'LAYOUT'|'TEXT'|'FONT'|'PAINT'|'SVG'|'TOKEN'|'APPLY'|'SYNC'|'NET'|'SEC'|'DCR';
  severity: 'info'|'warn'|'error';  // default; emitters may raise, never lower below 'info'. No 'fatal': run-aborting = 'error' + data.fatal: true
  audience: 'designer'|'developer'|'both';  // who the remedy is written for
  message: string;              // ICU template, e.g. "Font {family} {style} is not available in Figma; used {substitute}."
  fallback?: string;            // what we did instead
  remedyDesigner?: string;      // designer-facing remedy; the plugin shows it when it was never paired with a CLI
  docs: `/docs/diagnostics/${string}`;
  since: string;                // version introduced
  deprecated?: string;
}
// Emitted instance (see 06-ir): { code, severity, nodeKey?, variantKey?, sid?, message, data? }
```

Process: a new code is added to `diagnostics.ts` + a docs page `docs/diagnostics/<CODE>.md` (cause, example, fix, related config) in the same PR; a CI check fails on unregistered codes or missing docs pages. Severity semantics: **info** = lossless choice worth knowing; **warn** = visible approximation; **error** = component/variant not produced or produced incorrectly. There is no `fatal` severity: a run-aborting condition is an `error` with `data.fatal: true` (e.g. `SB_INDEX_UNREACHABLE`). The catalog below is the **complete** set. Every code used in any chapter appears here exactly once, under one canonical name chosen after the stage that emits it (`NOUN_CONDITION` style). A chapter that coins a code adds its row here in the same change. A CI check verifies that every code's **Defined in** chapter mentions the code; the owning chapters name the trigger site. Severities follow the defining chapter: where a chapter says a code fails the component or the run, it is an error. In these tables, *warning* is the registry's `'warn'`.

### 6.2 Catalog

**278 codes in 14 domains:** SB 27 · PLAN 43 · CAP 30 · LAYOUT 16 · TEXT 11 · FONT 8 · PAINT 16 · SVG 5 · TOKEN 21 · APPLY 21 · SYNC 21 · NET 9 · SEC 6 · DCR 44.

Columns: **Emitted by** is the package that raises the code ([02 §6](02-architecture.md#monorepo)). **User remedy** is the text the report, the plugin and the docs page lead with: what the user can do, in plain words. "Nothing to do" means the result is correct and the code is only there to explain a choice. **Defined in** is the chapter that specifies the behaviour.

#### Storybook (SB_) — 27

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `SB_INDEX_UNREACHABLE` | error | `storybook` | `index.json`/`stories.json` could not be loaded; aborts the run (`data.fatal: true`, exit 3) | Check the URL and that Storybook is running. For a static build, run `storybook build` and point Holotype at `storybook-static/` | [03](03-storybook.md) |
| `SB_IFRAME_UNREACHABLE` | error | `storybook` | `iframe.html` did not return 200 | Make sure your host serves `iframe.html` next to `index.json` (check base path and rewrite rules) | [03](03-storybook.md) |
| `SB_VERSION_UNSUPPORTED` | error | `storybook` | Storybook older than 8 (D-11) | Upgrade to Storybook 10 (8 and 9 work best-effort) | [03](03-storybook.md) |
| `SB_VERSION_UNTESTED` | warning | `storybook` | newer Storybook major than the newest adapter; the newest adapter was used | Update Holotype. If the output looks wrong, use **Copy diagnostic** and send it with the run's `report.json` to the support contact in Settings | [03](03-storybook.md) |
| `SB_MANIFEST_UNPARSEABLE` | info | `storybook` | the components manifest has an unknown shape; in-page docgen was used instead | Nothing to do. Update Holotype if props look incomplete | [03](03-storybook.md) |
| `SB_DOCGEN_DEGRADED` | warning | `storybook` | Storybook 11 dev server without its docgen service; argTypes are reduced | Capture from a static build (`storybook build`), or add `@storybook/addon-mcp` | [03](03-storybook.md) |
| `SB_REF_AUTH_REQUIRED` | warning | `storybook` | a composed Storybook ref needs a login; its stories were skipped | Run `holotype login --storybook <ref URL>`, then re-run | [03](03-storybook.md) |
| `SB_AUTH_FAILED` | error | `storybook` | 401/403 on `index.json` | Set `HOLOTYPE_SB_TOKEN` (or `HOLOTYPE_SB_HEADERS`) or run `holotype login --storybook <url>` | [03](03-storybook.md) |
| `SB_AUTH_REDIRECT` | error | `storybook` | `index.json` redirected to a login page | Run `holotype login --storybook <url>` and sign in once in the window that opens | [03](03-storybook.md) |
| `SB_STORY_LOAD_FAILED` | error | `storybook` | `loadStory` threw (CSF import error); the story was skipped | Open the story in Storybook and fix the import error shown in the report | [03](03-storybook.md) |
| `SB_METADATA_TIMEOUT` | error | `storybook` | a metadata batch hung for 30 s; retried on a fresh page | Look for a story file that hangs on import (top-level `await`, network call) and fix it, or leave it out with `exclude` | [03](03-storybook.md) |
| `SB_PREVIEW_INIT_TIMEOUT` | error | `storybook` | the preview never became ready | Open `iframe.html` in a browser and fix the errors in its console, then re-run | [03](03-storybook.md) |
| `SB_RENDER_TIMEOUT` | error | `storybook` | no `storyRendered`/`storyFinished` within `T.render` (15 s); retried twice, then the variant fails | Check loaders and play functions that wait on network or timers, and mock them for capture | [03](03-storybook.md) |
| `SB_STORY_UNRENDERABLE` | error | `storybook` | the story kept failing after three reloads; the component fails | Fix the story in Storybook, or tag it `!figma` to leave it out | [03](03-storybook.md) |
| `SB_STORY_ERROR` | error | `storybook` | Storybook reported `storyErrored`/`storyThrewException`; the variant fails (retried twice) | Open the story with the args in the report and fix the error message shown | [03](03-storybook.md) |
| `SB_PLAY_ERROR` | error | `storybook` | the play function threw; the variant fails | Fix the play function (the report shows its error and stack) | [03](03-storybook.md) |
| `SB_STORY_MISSING` | error | `storybook` | the story id is not in the index (renamed or removed) | Re-run after rebuilding Storybook; update ids pinned in config | [03](03-storybook.md) |
| `SB_CONSOLE_ERROR` | info | `storybook` | console errors were logged during the render | Nothing to do unless the render looks blank; then read the logged errors | [03](03-storybook.md) |
| `SB_URL_ARG_UNENCODABLE` | warning | `planner` | in URL-fallback mode an arg value cannot be encoded in the URL; the variant was skipped | Drop `--no-channel` (or use a build where the preview API works), or limit values to letters, digits, space, `_` and `-` | [03](03-storybook.md) |
| `SB_ARG_UNKNOWN` | warning | `planner` | a configured arg has no argType; it was dropped | Fix the arg name in config, or add an argType for it | [03](03-storybook.md) |
| `SB_DECORATOR_PAINTS` | info | `storybook` | a decorator paints a background; it is used as the canvas background, not part of the component | Nothing to do. Remove the background from the decorator if you want a transparent canvas | [03](03-storybook.md) |
| `SB_COMPONENT_MULTI_TITLE` | info | `storybook` | one component appears under several titles; they were not merged | To merge them into one component set, set `component:` in config | [03](03-storybook.md) |
| `SB_HOST_NOT_ALLOWED` | error | `storybook` | the Storybook dev server rejected our host (its `allowedHosts` check) | Add the host to `core.allowedHosts` in `.storybook/main` | [03](03-storybook.md) |
| `SB_HMR_DURING_CAPTURE` | warning | `storybook` | the dev server reloaded mid-run; the component was retried once | Avoid saving files during a run, or capture from a static build | [03](03-storybook.md) |
| `SB_ROOT_NOT_FOUND` | error | `storybook` | the capture root selector matched nothing | Fix `parameters.holotype.rootSelector` (or remove it to use `#storybook-root`) | [03](03-storybook.md) |
| `SB_PORTAL_AMBIGUOUS` | warning | `storybook` | several candidate portal roots; their union was used | Set `parameters.holotype.portal.selector` to the right overlay | [03](03-storybook.md#portals-and-overlays) |
| `SB_NOT_A_STORYBOOK` | error | `cli` (hosted) | the target has no `index.json` plus `iframe.html` with a Storybook preview | Point Holotype at the root URL of a Storybook | [13](13-security-legal.md) |

#### Planner, config and mapper structure (PLAN_) — 43

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `PLAN_CONFIG_INVALID` | error | `cli` | a config value fails the schema; the run stops (exit 2) | Fix the value at the JSON pointer printed with the error | [02](02-architecture.md) |
| `PLAN_CONFIG_UNKNOWN_KEY` | warning | `cli` | unknown key in `holotype.config.ts`; ignored | Check the spelling against the "did you mean…" hint | [02](02-architecture.md) |
| `PLAN_PARAM_UNKNOWN_KEY` | warning | `planner` | unknown key in `parameters.holotype`; ignored | Check the spelling; the addon's types catch this while you type | [04](04-variant-model.md) |
| `PLAN_ENUM_UNRESOLVED` | warning | `planner` | docgen gave a type alias that cannot be enumerated; the arg was not made an axis | Add `options` to the argType | [04](04-variant-model.md) |
| `PLAN_ARG_NOT_ENUMERABLE` | info | `planner` | a text, object or node arg was fixed at its `initialArgs` value | Nothing to do. To make it an axis, list its values in `args.<name>.values` | [04](04-variant-model.md) |
| `PLAN_ARG_NO_VISUAL_EFFECT` | info | `planner` | the arg never changes the render (e.g. `onClick`, `aria-*`); ignored | Nothing to do | [04](04-variant-model.md) |
| `PLAN_BOOLEAN_PROMOTED_TO_VARIANT` | info | `planner` | a boolean does more than show/hide a layer, so it became a variant axis | Nothing to do. To get a Figma boolean, make the prop only toggle visibility | [04](04-variant-model.md) |
| `PLAN_CLASSIFICATION_REJECTED` | warning | `planner` | a classification you forced in config failed render-and-diff; VARIANT was used | Remove the forced classification, or change the component so the prop matches it | [04](04-variant-model.md) |
| `PLAN_TEXT_PARTIAL` | warning | `planner` | the arg is part of a larger text (e.g. `"{count} items"`); the property holds the whole text | Render the arg in its own element if designers should edit it alone | [04](04-variant-model.md) |
| `PLAN_TEXT_MULTI_NODE` | warning | `planner` | the arg text appears in several layers; only the first is bound | Nothing to do, or drop the duplicate (e.g. a tooltip echoing the label) | [04](04-variant-model.md) |
| `PLAN_TEXT_UNBOUND` | info | `planner` | a string arg could not be bound to a text layer; it was fixed | Make sure the arg renders as plain text in one element | [04](04-variant-model.md) |
| `PLAN_SWAP_OPTION_UNRESOLVED` | warning | `planner` | an instance-swap option has no matching component | Import that component too, or remove the option | [04](04-variant-model.md) |
| `PLAN_SLOT_UNVERIFIED` | info | `planner` | a slot was inferred without an empty-content probe | Nothing to do. Allow empty children in the story to verify it | [04](04-variant-model.md) |
| `PLAN_VALUES_MERGED` | info | `planner` | two values of an axis render the same; merged under the first label | Nothing to do, or make the values look different | [04](04-variant-model.md) |
| `PLAN_PROPERTY_INCONSISTENT` | warning | `planner` | a property behaved differently on a non-default variant; demoted to VARIANT | Check the variant named in the report; the prop changes more than expected there | [04](04-variant-model.md) |
| `PLAN_UNVERIFIED_CLASSIFICATION` | info | `planner` | `classification: 'fast'` used priors without probes | Use the default classification for the final sync | [04](04-variant-model.md) |
| `PLAN_SPARSE_SET` | warning | `planner` | the set has missing combinations; switching to one snaps to the nearest | Raise `budget.max`, or accept the sparse set | [04](04-variant-model.md) |
| `PLAN_AXIS_DROPPED_BUDGET` | warning | `planner` | an axis was pinned to its default to stay within budget | Use "include" in the report, or raise `budget.max` | [04](04-variant-model.md) |
| `PLAN_BUDGET_EXCEEDED` | error | `planner` | the matrix is over `budget.hardLimit`; the component was refused | Reduce axes or values, or pass `--force` | [04](04-variant-model.md) |
| `PLAN_PROBE_BUDGET` | warning | `planner` | the probe budget ran out; the remaining args were classified by priors | Raise `budget.maxProbes`, or classify those args in config | [04](04-variant-model.md) |
| `PLAN_CONDITIONAL_DUPLICATE` | info | `planner` | an argType `if` collapses combinations; the duplicates are built as clones | Nothing to do, or set `conditional: 'sparse'` to omit them | [04](04-variant-model.md) |
| `PLAN_DUPLICATE_VARIANT` | info | `planner` | two combinations produced the same render; reported by render-hash dedup | Nothing to do, or remove the redundant arg values | [04](04-variant-model.md) |
| `PLAN_AXIS_NO_EFFECT` | warning | `planner` | every value of an axis renders the same; the axis was removed | Check the arg is wired to the component; remove it from config if unused | [04](04-variant-model.md) |
| `PLAN_STATE_NO_EFFECT` | info | `planner` | a pseudo-state looks the same as default; dropped | Nothing to do | [04](04-variant-model.md) |
| `PLAN_THEME_AS_AXIS` | warning | `planner` | theme differences are not explained by tokens, so themes became a `Theme` variant axis | Move the listed hard-coded values into tokens to get Figma modes instead | [04](04-variant-model.md) |
| `PLAN_VIEWPORT_STRUCTURE_CHANGE` | info | `planner` | the layout changes structure across viewports | Consider `viewports.as: 'components'` | [04](04-variant-model.md) |
| `PLAN_STORY_SPLIT` | info | `planner` | too many unexplained stories; split into separate components | Nothing to do, or add args so the stories become variants | [04](04-variant-model.md) |
| `PLAN_COMPAT_SPLIT` | info | `planner` | a story.to.design setting was mapped to a split into components | Nothing to do | [04](04-variant-model.md) |
| `PLAN_COMPAT_UNSUPPORTED` | warning | `planner` | a story.to.design setting has no equivalent (e.g. `:tap`) | Replace it with an arg, as the hint says | [04](04-variant-model.md) |
| `PLAN_CHROMATIC_DISABLED_HINT` | info | `planner` | Chromatic `disableSnapshot` seen; the story is still captured | Tag the story `!figma` if you want it left out | [04](04-variant-model.md) |
| `PLAN_SUGGEST_MERGE_AXES` | info | `planner` | exclusive booleans could become one axis | Accept the suggestion in config (`args.<name>.values`) | [04](04-variant-model.md) |
| `PLAN_ICON_SPLIT` | info | `planner` | an icon enum was split into one component per value | Nothing to do | [04](04-variant-model.md) |
| `PLAN_FEATURE_DOWNGRADED` | warning | `cli` | the plugin lacks an IR feature, so the output was downgraded (e.g. slots → frames) | Update the Figma plugin | [06](06-ir.md) |
| `PLAN_COMPONENT_TOO_LARGE` | warning (error over 8 MB) | `planner` | a `SceneComponent` file is over 2 MB; variants were reduced | Lower the variant budget or split the component | [06](06-ir.md) |
| `PLAN_BUNDLE_LARGE` | warning | `cli` | the bundle is over 100 MB (rejected above 200 MB with `APPLY_BUNDLE_REJECTED`) | Sync fewer components per run, or split by `include` | [02](02-architecture.md) |
| `PLAN_INVARIANT_VIOLATION` | error | `mapper` | the mapper produced invalid output (a Holotype bug); the component was skipped | Use **Copy diagnostic** and send it with `report.json` to the support contact in Settings; the other components are unaffected | [06](06-ir.md) |
| `PLAN_MAPPER_FAILED` | error | `mapper` | the mapper threw (a Holotype bug); the component failed | Use **Copy diagnostic** (it includes the stack) and send it to the support contact in Settings; the other components are unaffected | [02](02-architecture.md) |
| `PLAN_ALIGNMENT_ANCHOR_CONFLICT` | warning | `mapper` | two layers share an anchor (e.g. a `data-testid`) across variants | Make test ids unique within the component | [07](07-mapping.md#alignment) |
| `PLAN_ALIGNMENT_DIVERGENT` | warning | `mapper` | variants are structurally unrelated; kept as separate subtrees | Consider splitting them into separate components | [07](07-mapping.md#alignment) |
| `PLAN_ALIGNMENT_ORDER_CONFLICT` | warning | `mapper` | variants disagree on layer order; that variant's parent fell back to absolute | Nothing to do, or avoid z-index changes between states | [07](07-mapping.md#alignment) |
| `PLAN_PROPERTY_UNBOUND` | warning | `mapper` | a planned property bound to no layer; it was dropped | Check the arg renders something; see the report for the property | [07](07-mapping.md) |
| `PLAN_INSTANCE_PROPS_UNMAPPED` | info | `mapper` | a nested component's props don't map to its properties; kept as a frame | Expose those props as args on the nested component | [07](07-mapping.md) |
| `PLAN_INSTANCE_MISMATCH` | info | `mapper` | a nested component's capture differs from its own story; kept as a frame | Nothing to do; it is retried once the nested component is imported | [07](07-mapping.md) |

#### Capture (CAP_) — 30

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `CAP_PAGE_CRASHED` | warning | `capture` | the browser page crashed; the variant was retried once | Nothing to do if it passed on retry; otherwise look for memory-heavy stories | [05](05-capture.md) |
| `CAP_SR_ONLY_SKIPPED` | info | `capture` | screen-reader-only content was skipped (counted only) | Nothing to do | [05](05-capture.md#walk) |
| `CAP_CLIPPED_CULLED` | info | `capture` | a node fully hidden by an ancestor's clip was removed | Nothing to do. Planner-bound layers are always kept | [05](05-capture.md#walk) |
| `CAP_IFRAME_RASTERIZED` | warning | `capture` | an iframe (e.g. cross-origin) could not be walked and was captured as an image | Render the content without an iframe in the story if you need editable layers | [05](05-capture.md) |
| `CAP_NON_AFFINE_RASTERIZED` | warning | `capture` | a 3D or perspective transform subtree was captured as an image | Nothing to do, or provide a flat story state for Figma | [05](05-capture.md) |
| `CAP_ANIMATED_GIF` | info | `capture` | an animated GIF keeps only its first frame | Nothing to do | [05](05-capture.md) |
| `CAP_ANIMATION_FROZEN` | info | `capture` | an infinite animation was frozen at t=0 | Nothing to do | [03](03-storybook.md) |
| `CAP_IMAGE_DOWNSCALED` | info | `capture` | an image over 4096 px was downscaled (Figma's limit) | Nothing to do, or ship a smaller source image | [05](05-capture.md) |
| `CAP_IMAGE_TRANSCODED` | info | `capture` | a WebP/AVIF/HEIC/ICO/BMP image was re-encoded as PNG or JPEG | Nothing to do | [05](05-capture.md) |
| `CAP_CANVAS_RASTERIZED` | info | `capture` | a `<canvas>` was captured as an image | Nothing to do | [05](05-capture.md) |
| `CAP_PSEUDO_UNMEASURED` | warning | `capture` | a `::before`/`::after` could not be measured and was left out | Use a real element instead of the pseudo-element if it matters in Figma | [05](05-capture.md) |
| `CAP_PSEUDO_MATERIALIZED` | info | `capture` | a pseudo-element was measured through the materialization fallback | Nothing to do | [05](05-capture.md) |
| `CAP_FOCUS_VISIBLE_UNREACHED` | warning | `capture` | Tab navigation never reached the target; focus was set directly, so `:focus-visible` may not show | Make the element keyboard-focusable, or set `stateTarget` | [05](05-capture.md) |
| `CAP_STATE_LOST` | warning | `capture` | a forced hover/focus state was lost because the framework re-rendered | Check that variant in Figma; avoid re-mounting on hover in the story | [05](05-capture.md) |
| `CAP_STATE_PORTAL_IGNORED` | info | `capture` | a state opened a portal (e.g. a tooltip) that was left out | Set `states.includePortals: true` to include it | [04](04-variant-model.md) |
| `CAP_PROBE_REMOUNTED` | info | `capture` | the component re-mounted during the layout probe; nodes matched by path | Nothing to do | [05](05-capture.md) |
| `CAP_SERIALIZE_FAILED` | error | `capture` | the serializer threw twice; the variant failed | Use **Copy diagnostic** (it includes the stack) and send it to the support contact in Settings | [05](05-capture.md) |
| `CAP_NONFINITE_VALUE` | error | `capture` | a `NaN`/`Infinity` value reached the IR; the variant failed | Check the story for a broken CSS value; otherwise use **Copy diagnostic** and send it to the support contact in Settings (usually a Holotype bug) | [06](06-ir.md) |
| `CAP_BOX_MODEL_FAILED` | info | `capture` | the CDP box model was unavailable; the fast-path rect was used | Nothing to do | [05](05-capture.md) |
| `CAP_ASSET_FETCH_FAILED` | warning | `capture` | an image or asset could not be loaded; a grey placeholder fill was used | Check the asset URL and auth; make sure the asset is served with the Storybook | [05](05-capture.md) |
| `CAP_DOC_TOO_LARGE` | warning | `capture` | over 20 MB or 5,000 nodes; the largest subtrees were rasterized | Split the story into smaller components | [05](05-capture.md) |
| `CAP_NONDETERMINISTIC` | warning | `capture` | two captures of the same story differ (cache verification) | Remove randomness, dates or animations from the story (see the node paths in the report) | [05](05-capture.md) |
| `CAP_UNSTABLE_RENDER` | warning | `capture` | the root kept changing size after settle | Wait for data in loaders, or disable animations for capture | [03](03-storybook.md) |
| `CAP_VIEWPORT_GROWN` | info | `capture` | the viewport was enlarged to fit the root | Nothing to do | [03](03-storybook.md) |
| `CAP_FIXED_IN_ROOT` | info | `capture` | `position:fixed` content found; the viewport was not grown | Nothing to do, or use `portal.frame: 'viewport'` for modals | [03](03-storybook.md) |
| `CAP_CHROMIUM_MISMATCH` | warning | `capture` | `--chromium-path` differs from the pinned version; fidelity not guaranteed | Use the pinned Chromium (`holotype install-browser`) | [02](02-architecture.md) |
| `CAP_CLOSED_SHADOW_LATE` | warning | `capture` | a closed shadow root was created before our hook; read through CDP instead | Nothing to do unless content is missing; then use **Copy diagnostic** and send it to the support contact in Settings | [05](05-capture.md) |
| `CAP_CSS_UNSUPPORTED` | warning | `capture` | a CSS property has no Figma equivalent (`data.property`); it was ignored | Check the affected layer; avoid the property for design-relevant styling | [05](05-capture.md) |
| `CAP_TRANSFORM_SKEW` | info | `capture` | a skew is expressed through `relativeTransform` | Nothing to do | [07](07-mapping.md) |
| `CAP_NATIVE_CONTROL_SYNTHESIZED` | info | `capture` | a native control (input, checkbox, select) was rebuilt from frames and vectors | Nothing to do | [07](07-mapping.md) |

#### Layout (LAYOUT_) — 16

Auto-layout relaxations and read-back fallbacks in the plugin are `APPLY_LAYOUT_RELAXED` / `APPLY_LAYOUT_FALLBACK` (APPLY_ table).

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `LAYOUT_SIM_MISMATCH` | info | `mapper` | no auto-layout candidate matched the browser in simulation (`data.maxDelta`); the container is absolute | Nothing to do; pixels match. For a resizable frame, simplify that container's CSS (flex or grid with uniform gaps) | [07](07-mapping.md) |
| `LAYOUT_IRREGULAR_GAPS` | info | `mapper` | margins could not be expressed as gaps, padding, wrappers or splits; the container is absolute | Use `gap` instead of per-child margins, or set `mapper.allowSpacers` | [07](07-mapping.md) |
| `LAYOUT_ALIGN_SELF_WRAPPED` | info | `mapper` | per-child `align-self` was expressed with a wrapper frame | Nothing to do | [07](07-mapping.md) |
| `LAYOUT_GROW_RATIO_FIXED` | info | `mapper` | unequal `flex-grow` became FIXED sizes; pixels match, resizing differs | Nothing to do, or use equal `flex: 1` for Figma-style fill | [07](07-mapping.md) |
| `LAYOUT_SPACE_AROUND_APPROX` | info | `mapper` | `space-around`/`space-evenly` became measured spacing (does not adapt on resize) | Nothing to do | [07](07-mapping.md) |
| `LAYOUT_WRAP_REVERSE_UNSUPPORTED` | info | `mapper` | `wrap-reverse` (or an unverifiable wrap) fell back to absolute | Nothing to do, or use normal `wrap` | [07](07-mapping.md) |
| `LAYOUT_FLOAT_ABSOLUTE` | info | `mapper` | a float container became absolute | Use flex or grid instead of floats for resizable frames | [07](07-mapping.md) |
| `LAYOUT_PERCENT_RESOLVED` | info | `mapper` | a `%` min/max size was resolved to px | Nothing to do | [07](07-mapping.md) |
| `LAYOUT_RTL_REVERSED` | info | `mapper` | an RTL row was emitted as reversed order | Nothing to do | [07](07-mapping.md) |
| `LAYOUT_BREAKPOINT_IN_PROBE` | info | `mapper` | a media/container query breakpoint limits the layout probe; crossing widths were skipped | Nothing to do. Breakpoints become viewport variants ([04](04-variant-model.md)) | [07](07-mapping.md) |
| `LAYOUT_GRID_MINMAX_FIXED` | info | `mapper` | a `minmax()` track became a fixed size | Nothing to do | [07](07-mapping.md) |
| `LAYOUT_GRID_AUTOFILL_FROZEN` | info | `mapper` | the `auto-fill`/`auto-fit` track count was frozen at the capture width | Nothing to do; add viewports if the count should change | [07](07-mapping.md) |
| `LAYOUT_GRID_UNREPRESENTABLE` | warning | `mapper` | a grid feature (dense, areas, subgrid, overlap) has no Figma equivalent; stacks or absolute used | Check the grid in Figma; simplify the grid if designers need to edit it | [07](07-mapping.md) |
| `LAYOUT_ZINDEX_HOIST` | warning | `mapper` | a layer painting above its ancestor's sibling was moved up the tree as absolute | Nothing to do unless the layer order matters to designers; avoid z-index escapes | [07](07-mapping.md) |
| `LAYOUT_ZORDER_FLOW_CONFLICT` | warning | `mapper` | paint order differs from flow order; the container is absolute | Avoid z-index reordering of in-flow children | [07](07-mapping.md) |
| `LAYOUT_OVERFLOW_AXIS_APPROX` | warning | `mapper` | overflow hidden on one axis only; Figma clips both | Check for clipped content in Figma; set overflow on both axes | [07](07-mapping.md) |

#### Text (TEXT_) — 11

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `TEXT_LINE_MISMATCH` | warning | `plugin` | Figma wraps the text into a different number of lines than the browser, even after buffering | Switch that text to locked-lines mode, or check that the font matches (see `FONT_*`) | [09](09-plugin.md) |
| `TEXT_WIDTH_BUFFERED` | info | `plugin` | the text box was widened by a few px to match the browser's line count | Nothing to do | [09](09-plugin.md) |
| `TEXT_CASE_BAKED` | info | `mapper` | `text-transform` was baked into the characters (CSS and Figma casing differ here) | Nothing to do; edit the source text in code | [07](07-mapping.md) |
| `TEXT_SPLIT_MIDLINE` | info | `mapper` | inline content was split into one text layer per line | Nothing to do | [07](07-mapping.md) |
| `TEXT_OVERLINE_OVERLAY` | info | `mapper` | an overline was drawn as a 1 px rectangle | Nothing to do | [07](07-mapping.md) |
| `TEXT_DECORATION_STYLE_APPROX` | info | `mapper` | a `double`/`dashed` underline became solid | Nothing to do | [07](07-mapping.md) |
| `TEXT_OVERLAY_LOCKED` | info | `mapper` | text with overlays was switched to locked lines | Nothing to do | [07](07-mapping.md) |
| `TEXT_SHADOW_RANGE_APPROX` | warning | `mapper` | text shadows differ across ranges; the dominant one was used | Use one text shadow per text element | [07](07-mapping.md) |
| `TEXT_WORD_SPACING_DROPPED` | warning | `mapper` | `word-spacing` has no Figma equivalent and was dropped | Use `letter-spacing`, or accept the difference | [07](07-mapping.md) |
| `TEXT_BASELINE_SHIFT_DROPPED` | warning | `mapper` | `vertical-align: super/sub` was dropped (Figma has no baseline shift) | Render super/subscript in its own element | [07](07-mapping.md) |
| `TEXT_OPENTYPE_UNSUPPORTED` | warning | `mapper` | OpenType features (e.g. `tnum`) cannot be written through the Plugin API | Nothing to do; numeric widths use the text width buffer | [07](07-mapping.md) |

#### Fonts (FONT_) — 8

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `FONT_LOAD_FAILED` | warning | `capture` | a web font failed to load in the browser (`data.src`) | Check the font URL and CORS; the capture used whatever font the browser fell back to | [03](03-storybook.md) |
| `FONT_FALLBACK_USED` | info | `capture` | some characters were drawn by a fallback font; the run was split by script | Nothing to do, or load a font that covers those characters | [05](05-capture.md) |
| `FONT_SYNTHETIC` | warning | `capture` | the browser faked bold or italic; Figma will use the real style | Load the real bold/italic face in Storybook so both match | [05](05-capture.md) |
| `FONT_UNRESOLVED` | warning | `capture` | the platform font could not be identified; the first family in the stack was used | Name an explicit web font in `font-family` | [05](05-capture.md) |
| `FONT_ICON_VECTORIZED` | info | `cli` | icon-font glyphs were converted to vector paths | Nothing to do | [05](05-capture.md) |
| `FONT_MISSING` | warning | `plugin` (forecast by `holotype doctor`) | a font is not available in Figma; the fallback was applied | Install the font for your Figma team, or map it in the **Fonts** screen; a re-sync restores the original | [09](09-plugin.md) |
| `FONT_SUBSTITUTED` | info | `plugin` | a font was mapped through your saved or chosen mapping | Nothing to do; change the mapping in the **Fonts** screen | [09](09-plugin.md) |
| `FONT_AXIS_DROPPED` | info | `mapper` | a `font-variation-settings` axis the Figma family lacks was dropped | Nothing to do | [07](07-mapping.md) |

#### Paint and effects (PAINT_) — 16

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `PAINT_COLOR_READBACK` | info | `capture` | a color was resolved through canvas read-back and clipped to sRGB | Nothing to do | [05](05-capture.md) |
| `PAINT_COLOR_GAMUT_MAPPED` | info | `mapper` | an out-of-sRGB color was gamut-mapped | Nothing to do | [07](07-mapping.md) |
| `PAINT_GRADIENT_APPROX` | info | `mapper` | a gradient interpolation space (e.g. `in oklch`) was approximated with extra stops | Nothing to do | [07](07-mapping.md) |
| `PAINT_CONIC_APPROX` | info | `mapper` | a conic gradient's origin or direction is approximate (until S-03) | Check the gradient in Figma | [07](07-mapping.md) |
| `PAINT_REPEATING_CAPPED` | info | `mapper` | a repeating gradient was capped at 256 stops | Nothing to do | [07](07-mapping.md) |
| `PAINT_TABLE_BORDER_APPROX` | info | `mapper` | `border-collapse` was drawn by giving shared borders to one side | Nothing to do | [07](07-mapping.md) |
| `PAINT_DASH_APPROX` | info | `mapper` | dashed borders use a Figma dash pattern; corners phase differently | Nothing to do | [07](07-mapping.md) |
| `PAINT_BORDER_DECOMPOSED` | info | `mapper` | per-side border colors or styles became four vector layers | Nothing to do | [07](07-mapping.md) |
| `PAINT_BORDER_DOMINANT` | warning | `mapper` | per-side borders on a rounded box use the dominant color | Set `mapper.exactBorders: true` for exact paths | [07](07-mapping.md) |
| `PAINT_BORDER_STYLE_APPROX` | info | `mapper` | a `double`/`groove`/`ridge`/`inset`/`outset` border was approximated | Nothing to do | [07](07-mapping.md) |
| `PAINT_ELLIPTICAL_RADIUS_APPROX` | warning | `mapper` | elliptical corner radii used the smaller radius | Set `mapper.exactRadii: true` for an exact path | [07](07-mapping.md) |
| `PAINT_SPREAD_BACKING_RECT` | info | `mapper` | a shadow spread was moved to a backing rectangle | Nothing to do | [07](07-mapping.md) |
| `PAINT_RING_PROMOTED` | info | `mapper` | a ring shadow (e.g. Tailwind `ring-*`) became an outside stroke | Nothing to do | [07](07-mapping.md) |
| `PAINT_FILTER_RASTERIZED` | warning | `mapper` | a CSS filter other than blur/drop-shadow was rasterized | Nothing to do, or apply the effect to an image asset instead | [07](07-mapping.md) |
| `PAINT_BLEND_UNSUPPORTED` | warning | `mapper` | a blend mode (e.g. `plus-lighter`) has no exact Figma match | Check the layer in Figma; use a standard blend mode | [07](07-mapping.md) |
| `PAINT_SUBTREE_RASTERIZED` | warning | `mapper` | a subtree was captured as an image (`data.reason`); layers inside are not editable | Check `data.reason`; avoid that CSS on design-relevant parts | [07](07-mapping.md) |

#### SVG (SVG_) — 5

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `SVG_RASTERIZED` | warning | `mapper` | an SVG with a filter, mask or `foreignObject` was rasterized | Set `capture.svg.rasterizeFilters: false` to try vectors, or simplify the SVG | [07](07-mapping.md) |
| `SVG_USE_UNRESOLVED` | warning | `capture` | an SVG `<use>` target was not found | Make sure the referenced symbol is in the page or the same shadow root | [05](05-capture.md) |
| `SVG_ICON_FONT_RASTERIZED` | warning | `cli` | an icon-font glyph could not be shaped and was captured as an image | Make sure the icon font file is reachable, or use SVG icons | [05](05-capture.md) |
| `SVG_ICON_EXTRACTED` | info | `mapper` | a repeated SVG was promoted to an icon component | Nothing to do | [07](07-mapping.md) |
| `SVG_IMPORT_FAILED` | warning | `plugin` | Figma could not import the SVG; a raster fallback was used | Simplify the SVG (it is in the report), or use **Copy diagnostic** and send it to the support contact in Settings | [09](09-plugin.md) |

#### Tokens (TOKEN_) — 21

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `TOKEN_AUTHORED_UNAVAILABLE` | info | `capture` | no matched styles for a node (e.g. inside a shadow root); its token bindings are degraded | Nothing to do | [05](05-capture.md) |
| `TOKEN_UNUSED` | info | `mapper` | a discovered token is not used by any imported component (counted only) | Nothing to do; set `tokens.include: 'all'` to export it anyway | [08](08-tokens.md) |
| `TOKEN_FALLBACK_USED` | info | `mapper` | `var(--x, fallback)` used its fallback because `--x` is undefined; a literal was emitted | Define the variable, or remove the dead `var()` | [08](08-tokens.md) |
| `TOKEN_EXPRESSION_UNBOUND` | info | `mapper` | a value comes from `calc()`, `color-mix()` or several vars; no variable can express it | Add a token for the computed value if designers need it | [08](08-tokens.md) |
| `TOKEN_CLAMPED_UNBOUND` | info | `mapper` | a radius or size token was clamped by layout, so it was not bound | Nothing to do | [08](08-tokens.md) |
| `TOKEN_PROVENANCE_MISMATCH` | warning | `mapper` | CSS says `var(--x)` but the rendered value differs (opacity, filter, redeclaration); not bound | Check the node named in the report for opacity, filters or a local redeclaration | [08](08-tokens.md) |
| `TOKEN_PRIVATE_CHAIN` | info | `mapper` | the value only resolves through component-private vars; not bound | Point the private var at a global token | [08](08-tokens.md) |
| `TOKEN_ALIAS_CYCLE` | warning | `mapper` | tokens alias each other in a cycle; broken with a literal | Fix the cyclic definitions in your token source | [08](08-tokens.md) |
| `TOKEN_TYPE_CONFLICT` | warning | `mapper` | a token is used as incompatible types, or an alias changes type | Give each use its own token of the right type | [08](08-tokens.md) |
| `TOKEN_NAME_COLLISION` | warning | `mapper` | two CSS names map to the same Figma name; a numeric suffix was added | Rename one of the tokens | [08](08-tokens.md) |
| `TOKEN_MODE_UNTOKENIZED_DIFF` | warning | `mapper` | a property changes between themes (or viewports) without a token, so modes can't express it | Move the listed value into a token, or set `tokens.themeFallback: "variant-axis"` | [08](08-tokens.md) |
| `TOKEN_MODE_LIMIT` | warning | `plugin` | your Figma plan's mode (or variable) limit was hit; the overflow policy was applied | Choose an option in the plugin (first N as modes, or a Theme axis), reduce themes, or upgrade the plan | [08](08-tokens.md) |
| `TOKEN_EFFECT_MODE_DIFF` | info | `mapper` | a shadow differs per mode, but Figma effect styles have no modes | Build the shadow from tokens so each part can be bound | [08](08-tokens.md) |
| `TOKEN_PADDING_BORDER_OFFSET` | info | `mapper` | padding is not bound because Scene padding includes the border width (D-16) | Nothing to do | [08](08-tokens.md) |
| `TOKEN_RELATIVE_UNIT` | info | `mapper` | an `em`/`%` token has no stable px value; not bound | Use a px or rem token for design-relevant sizes | [08](08-tokens.md) |
| `TOKEN_LIBRARY_VALUE_DRIFT` | warning | `plugin` | a library variable bound here has a different value than code; it was not changed | Update the library file, or the code | [08](08-tokens.md) |
| `TOKEN_VALUE_AMBIGUOUS` | info | `mapper` | value-equality matching found several candidate tokens; not bound | Use `var()` in code for that property | [08](08-tokens.md) |
| `TOKEN_VALUE_MATCHED` | info | `mapper` | a binding was made by value equality only (opt-in, lower confidence) | Nothing to do; use `var()` in code for an exact binding | [08](08-tokens.md) |
| `TOKEN_SOURCE_CSS_MISMATCH` | warning | `mapper` | the tokens file and the CSS computed value differ | Rebuild your tokens, or fix the CSS that overrides them | [08](08-tokens.md) |
| `TOKEN_BIND_FAILED` | warning | `plugin` | Figma refused a binding (field unsupported or variable scope mismatch); the literal was kept | Widen the variable's scopes in Figma, or nothing to do | [08](08-tokens.md) |
| `TOKEN_ORPHANED` | info | `plugin` | a linked variable no longer exists in code | Delete or deprecate the variable in Figma | [08](08-tokens.md) |

#### Apply (APPLY_) — 21

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `APPLY_IR_VERSION_UNSUPPORTED` | error | `plugin` | the bundle's (or a DCR's) IR major is not supported by this plugin or CLI; nothing is applied | Update whichever side is older: the plugin, or the CLI (`npx @holotype/cli@latest`) | [09](09-plugin.md#preflight) |
| `APPLY_UNSUPPORTED_FEATURE` | error | `cli`, `plugin` | the config requires an IR feature the plugin does not support (CLI), or a bundle lists a required feature the plugin does not know (plugin, [02 §4.3](02-architecture.md#protocol)) | Update the Figma plugin, or turn off the feature in config | [06](06-ir.md) |
| `APPLY_BUNDLE_CORRUPT` | error | `plugin` | a bundle file's sha256 does not match `integrity`; the file was rejected | Re-export the bundle, or re-send it from the CLI | [02](02-architecture.md) |
| `APPLY_BUNDLE_REJECTED` | error | `plugin` | the bundle breaks a safety limit (size, nodes, string length, zip ratio) | Split the run into smaller bundles; if you didn't create the file, don't import it | [13](13-security-legal.md) |
| `APPLY_COMPONENT_FAILED` | error | `plugin` | the Figma API threw while applying a component; partial state left for resume | Re-run the sync to resume. If it repeats, use **Copy diagnostic** and send it to the support contact in Settings | [09](09-plugin.md#resume) |
| `APPLY_CANCELLED` | info | `plugin` | you cancelled; finished components are kept, the rest are marked partial | Re-run the sync to finish | [09](09-plugin.md) |
| `APPLY_VARIANT_ADD_FAILED` | error | `plugin` | a variant could not be added to the existing set without breaking instance links | Retry; if it fails again, Detach the old variant and re-sync (instances of that variant will need swapping) | [09](09-plugin.md) |
| `APPLY_VARIANT_NAME_COLLISION` | error | `plugin` | two variants resolve to the same `Prop=Value` name | Give the colliding arg values distinct labels in config | [09](09-plugin.md) |
| `APPLY_SET_LARGE` | info | `plugin` | a set has more than 500 variants; Figma may get slow | Lower the variant budget, or split the component | [09](09-plugin.md) |
| `APPLY_PROPERTY_BIND_FAILED` | warning | `plugin` | Figma rejected a component-property binding (type or node mismatch) | Nothing to do; the layer stays without that property. If it repeats, use **Copy diagnostic** and send it to the support contact in Settings | [09](09-plugin.md) |
| `APPLY_SLOT_UNSUPPORTED` | info | `plugin` | this Figma client has no slots; the slot became fixed content | Update Figma, or nothing to do | [09](09-plugin.md) |
| `APPLY_INSTANCE_TARGET_MISSING` | warning | `plugin` | a nested component is not in the file; a frame was built instead | Import the nested component, then re-sync | [09](09-plugin.md) |
| `APPLY_INSTANCE_MISMATCH` | warning | `plugin` | the created instance's geometry differs from the capture (read-back); a frame was built instead | Nothing to do; the next run learns from it. Check the nested component's own story matches its usage | [09](09-plugin.md) |
| `APPLY_INSTANCE_OVERRIDE` | info | `plugin` | a literal override was applied on an instance | Expose that text or toggle as a prop on the nested component | [09](09-plugin.md) |
| `APPLY_INSTANCE_CYCLE` | warning | `plugin` | components nest each other in a cycle; broken with frames | Nothing to do | [09](09-plugin.md) |
| `APPLY_IMAGE_REJECTED` | warning | `plugin` | Figma refused an image (format or size) | Use **Copy diagnostic** (it includes the asset hash) and send it to the support contact in Settings | [09](09-plugin.md) |
| `APPLY_IMAGE_SKIPPED` | warning | `plugin` | an image was not applied (`use_figma` path or upload failure) | Re-run through the plugin to get the images | [09](09-plugin.md) |
| `APPLY_LAYOUT_RELAXED` | info | `plugin` | HUG/FILL sizing was relaxed to FIXED to pass read-back | Nothing to do | [09](09-plugin.md) |
| `APPLY_LAYOUT_FALLBACK` | warning | `plugin` | auto layout failed read-back in Figma; the container became absolute | Nothing to do; pixels match. If it repeats, use **Copy diagnostic** and send it to the support contact in Settings | [09](09-plugin.md) |
| `APPLY_MIXED_VALUE` | info | `plugin` | Figma returned `figma.mixed`; it was normalized | Nothing to do | [09](09-plugin.md) |
| `APPLY_NO_EDIT_ACCESS` | error | `plugin` | the file is view-only, open in Dev Mode, or not in a Design editor | Holotype builds components. Open this file in Design mode with edit access | [09](09-plugin.md) |

#### Sync (SYNC_) — 21

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `SYNC_CONFLICT` | warning | `plugin` | a designer edited a managed layer that code also changed; kept ("Keep mine") | Resolve it in the diff: Keep mine, Take code, Fork or Lock | [10](10-sync.md) |
| `SYNC_CONFLICT_OVERWRITTEN` | warning | `plugin` | you chose "Take code"; the designer's change was replaced (old values are in the report) | Nothing to do, or use Fork next time to keep a copy | [11](11-ux.md) |
| `SYNC_KEEP_STALE` | warning | `plugin` | a layer you kept changed in code again | Decide again in the diff | [10](10-sync.md) |
| `SYNC_LOCKED_SKIPPED` | info | `plugin` | a locked subtree was skipped | Nothing to do; unlock it to receive code changes | [10](10-sync.md) |
| `SYNC_MANAGED_NODE_DELETED` | info | `plugin` | a designer deleted a managed layer; it was re-created (or kept deleted under `keep`) | Nothing to do; lock or unmanage the layer to keep it gone | [10](10-sync.md) |
| `SYNC_NODE_REMOVED` | info | `plugin` | a managed layer no longer exists in code and was removed (impact: instance count) | Nothing to do, or set `sync.orphans: 'hide'` | [10](10-sync.md) |
| `SYNC_TYPE_CHANGE_RECREATE` | warning | `plugin` | a layer changed type and was re-created; overrides restored/dropped are counted | Check instances that overrode that layer | [10](10-sync.md) |
| `SYNC_OVERRIDE_NOT_RESTORED` | warning | `plugin` | an instance override could not be restored after a structural change | Re-apply the override on the instance listed in the report | [10](10-sync.md) |
| `SYNC_OVERRIDES_AT_RISK` | warning | `plugin` | a change may drop overrides in files that use this library | Review before publishing the library; tell consumers | [10](10-sync.md) |
| `SYNC_BREAKING_CHANGE` | warning | `plugin` | the plan contains a breaking change; it needs acknowledgement | Review it in the diff, then acknowledge | [10](10-sync.md) |
| `SYNC_RENAME_DETECTED` | info | `plugin` | a component or variant was renamed in place; instances keep working | Nothing to do | [10](10-sync.md) |
| `SYNC_RENAME_AMBIGUOUS` | info | `plugin` | a possible rename scored below the automatic threshold | Confirm or reject the rename in the diff | [10](10-sync.md) |
| `SYNC_DEPRECATED` | info | `plugin` | a component removed from code was moved to "Deprecated" (D-20) | Swap its instances, then delete it when unused | [10](10-sync.md) |
| `SYNC_UNDEPRECATED` | info | `plugin` | a deprecated component is back in code and was restored | Nothing to do | [10](10-sync.md) |
| `SYNC_DUPLICATE_SID` | warning | `plugin` | more than one set claims the same component id (e.g. a copy-paste) | Unmanage the copy when the plugin offers it | [10](10-sync.md) |
| `SYNC_REGISTRY_REPAIRED` | info | `plugin` | the registry was missing or corrupt and was rebuilt from layer data | Nothing to do | [10](10-sync.md) |
| `SYNC_LEASE_HELD` | warning | `plugin` | another session is syncing this file | Wait for it to finish, then retry | [10](10-sync.md) |
| `SYNC_STALE_PLAN` | info | `plugin` | the file changed since planning; re-planned automatically | Nothing to do | [10](10-sync.md) |
| `SYNC_UNMANAGED_AFFECTS_LAYOUT` | info | `plugin` | a layer a designer added caused a layout fallback | Move the added layer outside the auto-layout frame, or nothing to do | [10](10-sync.md) |
| `SYNC_LEGACY_NAMESPACE` | info | `plugin` | reserved for a future plugin-data namespace migration; not emitted today | Nothing to do | [13](13-security-legal.md) |
| `SYNC_BRANCH_RESIDUE` | warning | `plugin` | the library file carries `branch:meta`/`base:*` (a branch was merged into it) | This library contains leftovers of a merged branch. Review the cleanup list, then Re-sync | [10](10-sync.md#branch-residue) |

#### Network (NET_) — 9

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `NET_SERVER_UNREACHABLE` | warning | `plugin` | no Holotype server answered on the local ports | Run `holotype serve`, or import a bundle file instead | [09](09-plugin.md) |
| `NET_LNA_BLOCKED` | error | `plugin` | the browser blocked local network access from Figma | Use the Figma desktop app, allow "Apps on device" for figma.com, or import a file | [11](11-ux.md) |
| `NET_DOMAIN_NOT_ALLOWED` | error | `plugin` | the plugin manifest does not allow this address (a Holotype bug) | Import a file meanwhile; use **Copy diagnostic** and send it to the support contact in Settings | [02](02-architecture.md) |
| `NET_PAIRING_FAILED` | error | `plugin` | the pairing code was wrong or expired | Copy a fresh code from the `holotype serve` output | [09](09-plugin.md) |
| `NET_PROTOCOL_MISMATCH` | error | `plugin` | the plugin and CLI share no protocol version | Update whichever side the message names (CLI or plugin) | [02](02-architecture.md) |
| `NET_PORT_IN_USE` | error | `cli` | the CLI could not bind any of ports 47321–47323 | Stop the other `holotype serve` (or the app using the port) and retry | [11](11-ux.md) |
| `NET_HOST_REJECTED` | error | `cli` | the local server refused a request with a foreign Host header (DNS-rebinding guard); answers 421 | Nothing to do if you didn't expect it: a web page tried to reach your local server. Use `127.0.0.1` or `localhost` | [13](13-security-legal.md) |
| `NET_FIGMA_TOKEN_MISSING` | error | `cli` | no Figma token for REST reads | Holotype needs a read-only Figma token. Create one in Figma ▸ Settings ▸ Security ▸ Personal access tokens (scope: File content, read), then run `holotype login --figma` | [13](13-security-legal.md#secrets) |
| `NET_FIGMA_TOKEN_EXPIRING` | warning | `cli` | the stored token expires within 14 days (personal access tokens last at most 90 days) | Create a new token, or use a plan access token in CI | [13](13-security-legal.md#secrets) |

#### Security (SEC_) — 6

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `SEC_SECRET_IN_CONFIG` | error | `cli` | the config file contains a token- or password-like literal; the run stops | Move the secret to an env variable (`HOLOTYPE_SB_TOKEN`) or `holotype login`, and rotate it if the file was shared | [02](02-architecture.md) |
| `SEC_SECRET_ON_ARGV` | warning | `cli` | a secret was passed with `--header`/`--basic-auth`, where process lists and shell history can show it | Use an env variable or `holotype login` instead | [13](13-security-legal.md#secrets) |
| `SEC_SECRET_REDACTED` | info | `capture` | input and password values were blanked by the redaction setting | Nothing to do; see `redaction.inputs` | [13](13-security-legal.md) |
| `SEC_PUBLIC_REGISTRY` | warning | `cli` | `holotype publish` targets a public registry while the Storybook is private | Publish to a private registry, unless the UI is meant to be public | [13](13-security-legal.md) |
| `SEC_EGRESS_BLOCKED` | warning | `cli` (hosted) | the hosted worker blocked a request to a private address | Host the assets on a public URL, or run Holotype locally | [13](13-security-legal.md) |
| `SEC_LICENSE_DENIED` | error | CI (`license-checker`) | a dependency's license is not on the allow-list; the build fails | Replace the dependency, or get the license reviewed | [13](13-security-legal.md) |

#### Design change requests (DCR_) — 44

Reused from other domains: `SYNC_DUPLICATE_SID`, `SYNC_LOCKED_SKIPPED`, `SYNC_MANAGED_NODE_DELETED`, `SYNC_LEASE_HELD`, `NET_SERVER_UNREACHABLE`, `SEC_SECRET_IN_CONFIG`, `SEC_SECRET_ON_ARGV`, `APPLY_IR_VERSION_UNSUPPORTED`.

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `DCR_NOT_BRANCH_FILE` | error | `dcr` | this Figma file has no branch metadata (it is a library file) | Run `holotype branch link` on the branch file | [15](15-change-requests.md#diagnostics) |
| `DCR_GIT_BRANCH_MISMATCH` | error | `cli` | the request's branch differs from the CLI's current git branch | Run `git switch <branch>`, then retry. Or download the request | [15](15-change-requests.md#diagnostics) |
| `DCR_BRANCH_FILE_COPIED` | warning | `plugin` | `figma.fileKey`/`fileId` differs from `branch:meta` (a copy of a branch file) | "This is a copy of branch file <branch>." Choose **Link this copy** or **Treat as library** | [15](15-change-requests.md#diagnostics) |
| `DCR_CONFIG_DRIFT` | warning | `cli` | the local `dcr` config hash differs from `branch:meta.dcrConfig` | This branch file uses older request settings. Run `holotype branch refresh` | [15](15-change-requests.md#diagnostics) |
| `DCR_NO_SUBMITTED_REQUEST` | error | `cli` | `holotype dcr --pull` found no `branch:meta.lastDcr` | Nothing was submitted from this file yet. Ask the designer to press **Submit** | [15](15-change-requests.md#diagnostics) |
| `DCR_BASELINE_MISSING` | error | `dcr` | no embedded snapshot and no CLI-cache baseline for a variant | Run `holotype branch refresh` | [15](15-change-requests.md#diagnostics) |
| `DCR_BASELINE_EXTERNAL` | warning | `dcr` | the snapshot was over budget and is only in the CLI cache; REST-only extraction is incomplete | Run `dcr` on the machine that generated the branch, or raise the snapshot budget | [15](15-change-requests.md#diagnostics) |
| `DCR_BASELINE_SHIFTED` | warning | `dcr` | code changed a layer the designer also edited (after refresh) | Review both values in the item before handing it to the agent | [15](15-change-requests.md#diagnostics) |
| `DCR_BASELINE_DIRTY` | info | `dcr` | the baseline was generated from uncommitted code | Commit before `holotype branch start` next time | [15](15-change-requests.md#diagnostics) |
| `DCR_SNAPSHOT_PARITY` | warning | `dcr` | plugin and REST snapshots differ for the same version | Extract from the plugin (preferred); use **Copy diagnostic** and send it to the support contact in Settings | [15](15-change-requests.md#diagnostics) |
| `DCR_SCOPE_EMPTY` | info | `dcr` | nothing is in scope (e.g. no frame marked Ready for dev) | Mark frames Ready for dev, or change the scope | [15](15-change-requests.md#diagnostics) |
| `DCR_NODE_AMBIGUOUS` | info | `dcr` | duplicated layer ids were resolved by canonical order | Nothing to do | [15](15-change-requests.md#diagnostics) |
| `DCR_REMOTE_COMPONENT_UNRESOLVED` | warning | `dcr` | a library instance's key is not in the registry `keys.json` | Export keys from the library file, then extract again | [15](15-change-requests.md#diagnostics) |
| `DCR_PROPERTY_UNMAPPED` | warning | `dcr` | an instance property value has no arg mapping; kept as an open question | Answer the question in the DCR | [15](15-change-requests.md#diagnostics) |
| `DCR_FIELD_UNMAPPABLE` | warning | `dcr` | a Figma field has no CSS equivalent (e.g. corner smoothing) | Answer the open question, or describe the intent in an annotation | [15](15-change-requests.md#diagnostics) |
| `DCR_VALUE_UNTOKENIZED` | warning | `dcr` | a raw value is used; matching tokens are listed | Bind the variable in Figma, or pick a token in the question | [15](15-change-requests.md#diagnostics) |
| `DCR_VALUE_NO_TOKEN` | warning | `dcr` | a raw value matches no token | Answer the question: new token or literal | [15](15-change-requests.md#diagnostics) |
| `DCR_NEAREST_COMPONENT` | info | `dcr` | a new component looks like an existing one (similarity ≥ 0.6) | Answer the question: extend the existing one or create a new one | [15](15-change-requests.md#diagnostics) |
| `DCR_PROVENANCE_MISSING` | warning | `dcr` | no code location (no CDP or source map, or plugin-only extraction) | Capture from the dev server through the CLI | [15](15-change-requests.md#diagnostics) |
| `DCR_PROVENANCE_MINIFIED` | info | `dcr` | code locations point at built CSS (static build) | Use the dev server for branch mode | [15](15-change-requests.md#diagnostics) |
| `DCR_PROVENANCE_NO_SOURCEMAP` | warning | `capture` | a dev-server stylesheet has no `sourceMapURL` / `data-vite-dev-id` | Enable `css.devSourcemap` (Holotype does this automatically in branch mode); check a custom Vite config | [05](05-capture.md) |
| `DCR_PROVENANCE_STALE` | warning | `cli` | a code location could not be remapped from `baseCommit` to HEAD | Code moved since this file was built. Run `holotype branch refresh` | [15](15-change-requests.md#diagnostics) |
| `DCR_UNKNOWN_CHANGE` | warning | `dcr` | a change could not be classified; listed raw | Add an annotation that says what you meant | [15](15-change-requests.md#diagnostics) |
| `DCR_TOO_LARGE` | warning | `dcr` | more than 200 items | Split by component with `--split` | [15](15-change-requests.md#diagnostics) |
| `DCR_NOTE_SUSPICIOUS` | info | `dcr` | designer text looks like instructions to the AI (still fenced as data) | Nothing to do; reword the note if it wasn't meant that way | [15](15-change-requests.md#diagnostics) |
| `DCR_VERIFY_PARTIAL` | warning | `cli` | some items are only partly implemented; a follow-up DCR was written | Hand the follow-up DCR to the agent and verify again | [15](15-change-requests.md#verify) |
| `DCR_VERIFY_PENDING` | error | `cli` | items have no implementation | Implement them (or have the agent do it), then run `holotype verify` again | [15](15-change-requests.md#verify) |
| `DCR_VERIFY_NO_STORY` | error | `cli` | a new item has no story that `implements` it | Add the story | [15](15-change-requests.md#verify) |
| `DCR_VERIFY_NOT_VERIFIABLE` | info | `cli` | the item can't be verified automatically (e.g. a screen without a story) | Check it by hand in review | [15](15-change-requests.md#verify) |
| `DCR_VERIFY_REGRESSED` | warning | `cli` | a non-target variant of a touched component no longer matches its baseline | Scope the change to the listed variants | [15](15-change-requests.md#verify) |
| `DCR_SCREEN_NAME_UNPARSED` | info | `dcr` | a screen appears at several widths, but its frame names have no breakpoint or state | Rename frames to `Screen / Breakpoint / State`, or group them in a Section | [15](15-change-requests.md#screens) |
| `DCR_SCREEN_VARIANT_DUPLICATE` | warning | `dcr` | two frames map to the same screen, breakpoint and state; the later one became `#2` | Rename one of the frames | [15](15-change-requests.md#screens) |
| `DCR_SCREEN_STATE_MISSING` | info | `dcr` | a state listed in `dcr.screens.expectStates` isn't designed | Design it, or answer the question to let the agent decide | [15](15-change-requests.md#screens) |
| `DCR_INTERACTION_UNSUPPORTED` | info | `dcr` | a prototype action has no v1 mapping (set variable, conditional…); kept raw | Describe the behaviour in an annotation | [15](15-change-requests.md#interactions) |
| `DCR_INTERACTION_TARGET_OUT_OF_SCOPE` | info | `dcr` | an interaction's destination is not in the DCR scope | Add the destination to the scope, or accept a placeholder route | [15](15-change-requests.md#interactions) |
| `DCR_CONTENT_PLACEHOLDER` | info | `dcr` | a screen still holds placeholder text (lorem, `{{…}}`, component default) | Replace it with final copy, or mark it as dynamic data | [15](15-change-requests.md#content) |
| `DCR_A11Y_UNKNOWN_ROLE` | info | `dcr` | an annotated role is not a WAI-ARIA 1.2 role | Fix the role in the annotation | [15](15-change-requests.md#content) |
| `DCR_A11Y_FOCUS_ORDER_GAP` | info | `dcr` | the focus order has duplicates or gaps in a screen variant | Fix the focus-order annotations | [15](15-change-requests.md#content) |
| `DCR_INSTANCE_OUTDATED` | info | `dcr` | instances of an older component version; the current one is used | Optionally update the instances in Figma | [15](15-change-requests.md#instance-versions) |
| `DCR_INSTANCE_DEPRECATED` | warning | `dcr` | instances of a deprecated component; its replacement is used | Optionally swap the instances in Figma | [15](15-change-requests.md#instance-versions) |
| `DCR_DEPRECATED_NO_REPLACEMENT` | warning | `dcr` | a deprecated component has no replacement on record | Add `parameters.holotype.replacedBy` (or a `dcr.deprecations` entry), or answer the question | [15](15-change-requests.md#instance-versions) |
| `DCR_IMPORT_UNRESOLVED` | warning | `dcr` | no import path for a component used in a screen | Set `dcr.targets.components.package`, or export the component | [15](15-change-requests.md#targets) |
| `DCR_NOT_APPROVED` | error | `dcr` | `dcr.requireApproval` is on and this DCR is not approved | Ask a reviewer to approve it in the plugin preview | [15](15-change-requests.md#diagnostics) |
| `DCR_APPROVAL_STALE` | warning | `dcr` | the approval was for an earlier version; the DCR changed since | Ask the reviewer to approve again | [15](15-change-requests.md#diagnostics) |

---

<a id="observability"></a>

## 7. Observability

### 7.1 `RunReport` (CLI `--json`, Action, plugin export; TypeBox in `ir`)

`RunReport` is the CLI `--json` output and the observability record. It embeds `BundleReport` ([06 §4.4](06-ir.md#bundle-report)) under `bundle`. `report.json` in a bundle is `BundleReport`.

```ts
interface RunReport {
  reportVersion: '1';
  run: { id: string; startedAt: string; durationMs: number; surface: 'cli'|'action'|'plugin'|'mcp';
         generator: { name: string; version: string; chromium: string; playwright: string };
         storybook: { version: string; renderer: string; source: string /* redacted to origin */; indexHash: string } };
  totals: { components: number; ok: number; failed: number; variants: number; nodes: number;
            autoLayoutCoverage: number; fidelity?: { median: number; p10: number } };
  components: Array<{ sid: string; name: string; status: 'ok'|'partial'|'failed'|'skipped';
                      variants: number; properties: Record<string, string>;
                      timingsMs: { capture: number; map: number; apply?: number };
                      fidelity?: { F: number; S_masked: number; G: number; textParity: number };
                      diagnostics: Diagnostic[] }>;
  diagnosticsByCode: Record<string, number>;
  budgets: Array<{ name: string; value: number; limit: number; ok: boolean }>;
  bundle?: BundleReport;        // 06 §4.4; absent when the command wrote no bundle
}
```

- `report.html`: static single file (no network), filters by code/component/severity, thumbnails (capture screenshot vs Figma export when available), links to docs pages.
- Plugin report: §6.9 of [11](11-ux.md); summary persisted to document root.
- Action: job summary markdown + annotations per `error`/`warn` mapped to story `importPath` when known.

### 7.2 Telemetry (opt-in, D-23)

Endpoint on our own domain (listed in manifest `allowedDomains` only when telemetry ships). Events, anonymous, no story names/text/URLs/images:

| Event | Fields |
|---|---|
| `run_completed` | surface, versions (cli, sb major, renderer, chromium major), counts (components, variants, nodes), durations (p50/p95 buckets), autoLayoutCoverage bucket |
| `diagnostic_counts` | map code → count |
| `apply_completed` | variants, writes, duration bucket, cancelled bool |
| `sync_outcome` | conflicts count, policy chosen, overrides lost count |
| `error_crash` | error class, package, version, stack hash (no message text) |

Install id = random UUID stored locally. `CI=true` or `DO_NOT_TRACK=1` force telemetry off, with no override (D-23). `holotype telemetry status|enable|disable`.

---

## 8. Release quality gates

**Slice gates (L-demos):** determinism suite (§1.2), DCR goldens (§2.4), an agent-eval run (§2.5), and designer acceptance of 10–15 real components (owner + designer). Fidelity gates apply from M5.

A release (any `@holotype/*` minor/major, plugin publish) requires:

1. L0–L4 green on the full sandbox matrix for first-class SB versions (SB 10 react-vite; 11 once GA) and smoke green on 8.6/9.1 (D-11, D-26).
2. Nightly fidelity within ratchet baseline; README §4 targets met from M5 onward (before: tracked, not gating).
3. Sync e2e (L6): 100% override retention on the unchanged-structure suite; no unexpected `SYNC_OVERRIDE_NOT_RESTORED`.
4. Perf budgets (§5) within 10% of baseline.
5. Schema: JSON Schema diff reviewed; IR major bump only with migration + plugin compatibility window (plugin reads current and previous major, [06](06-ir.md)).
6. Security checklist ([13](13-security-legal.md)): manifest domains unchanged or reviewed, no new outbound hosts, dependency audit clean.
7. Docs: every new diagnostic code documented; changelog via changesets.
