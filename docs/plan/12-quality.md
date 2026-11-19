# 12 — Quality, fidelity, performance, diagnostics, observability

> This chapter defines how we *know* holotype works: the test pyramid, the fixture corpus, the fidelity harness that measures README §4 metrics, performance budgets, the diagnostics catalog, observability and release gates.

---

## 1. Test pyramid <a id="pyramid"></a>

| Layer | What | Tools | Runs |
|---|---|---|---|
| **L0 static** | types (strict), Biome lint/format, schema emission diff (TypeBox → JSON Schema committed; CI fails if regenerated schema differs) | tsc, Biome | every PR |
| **L1 unit** | pure functions per package | Vitest | every PR |
| **L2 property-based** | invariants of canonical JSON, hashing, layout-sim, gradient math, color conversion | fast-check + Vitest | every PR |
| **L3 snapshot** | DOM fixture → Capture IR; Capture IR → Scene IR; Scene IR → `figma-fake` scene graph | Vitest file snapshots (deterministic JSON, sorted keys) | every PR |
| **L4 integration** | Storybook adapter against generated sandboxes per SB version (react-vite until M5, D-26); capture end-to-end in Chromium | Playwright (pinned Chromium, D-05) | every PR (smoke subset), nightly (full matrix) |
| **L5 fidelity** | T0/T1/T2 harness (§4) in real Figma | macOS runner + Figma desktop; S-11 path | nightly + release |
| **L6 sync e2e** | apply → designer-edit simulation → re-sync → assert overrides/conflicts | real Figma (harness mode) + `figma-fake` mirror | nightly |
| **L7 usability** | scripted tasks with 5 DS engineers + 5 designers per milestone M3, M5, M8 | moderated sessions | milestone |

### 1.1 Per-package matrix

| Package | L1 unit focus | L2 properties | L3 snapshots | L4/L5 |
|---|---|---|---|---|
| `ir` | schema validation, migrations `vN→vN+1` | canonicalJSON idempotent, key-order independence, `hash(x)=hash(roundtrip(x))`, NaN/−0/float normalization | schema fixtures (valid/invalid corpus) | — |
| `shared` | diagnostic registry (unique codes, templates render) | — | — | — |
| `storybook` | index parsing v3/v4/v5, URL args encode/decode, argTypes inference, `if` evaluation | buildArgsParam∘parse = id on safe values | metadata extraction per SB version (recorded) | sandbox matrix (§3.3) |
| `capture` | text-run extraction, whitespace collapse, pseudo `content` resolution, affineFromQuad, color parse/convert, gradient parse | color convert in-gamut round trips; quad→affine→quad | **DOM micro-fixture → Capture IR** | Chromium real render |
| `planner` | matrix building, `if` pruning, budgets, pairwise generator, classification decision table | pairwise covers all value pairs; budget never exceeded | plan for fixture components | render-and-diff in Chromium |
| `mapper` | flex/grid/block classification, sizing decisions, margin strategies, alignment across variants, naming chain, token binding | simplification preserves absolute geometry (every node's abs rect unchanged by collapse) | **Capture IR → Scene IR** | — |
| `layout-sim` | auto layout + wrap + grid algorithm | `simulate(spec(rects)) == rects` for generated specs; monotonicity under FIXED sizes | — | calibrated vs real Figma (T1) nightly |
| `plugin` (applier) | build-order rules (append before FILL, layoutMode before padding…), font/image dedupe, reconciliation diff | reconcile(plan, plan) → zero writes; reconcile is order-independent for keyed children | **Scene IR → figma-fake graph + op log** | real Figma T1/T2, L6 |
| `figma-fake` | contract tests: each `FigmaPort` method throws exactly where Figma throws (e.g. FILL without auto-layout parent, HUG on non-AL frame) — table generated from S-05/S-06 observations | — | — | conformance replay vs real Figma (record ops in harness, replay in fake, compare final graph) |
| `cli` | flag parsing, exit codes, config loading | — | `--json` output snapshots | e2e on fixture Storybook |
| `storybook-addon` | parameter typing, manifest emission | — | — | sandbox build |
| `dcr` | identification, field diff + noise filter, classification, reverse prop mapping, screen grouping, interaction mapping, placeholder rules, a11y grammar, `importSpecifier`, `renderSnippet`, `renderPrompt` | **shuffle invariance** (§2.4); `normalizeRest(x)` ≡ `normalizePlugin(x)` on the parity fixture; escaping never lets designer text leave its fence or cell | **`fixtures/dcr/*` → `dcr.json` + `prompt.md`** (§2.4) | `holotype verify` e2e on the react-vite fixture branch |

### 1.2 Determinism requirements (prerequisite for snapshots and caching)

- Pinned Chromium + Playwright (D-05), fonts installed in CI image from a lockfile (`fixtures/fonts.lock`), D-24 context options, `page.clock` pinned, `Math.random` seeded via init script.
- Canonical JSON (sorted keys, numbers rounded to 1/256 px for geometry and 1e-6 for colors in hashes; raw values kept in IR) — exact rule in [06](06-ir.md).
- Snapshot updates only via `pnpm test -u` with reviewer sign-off; snapshot diffs rendered in PR as a summary (counts of changed nodes per fixture).

---

## 2. Fixture corpus <a id="fixtures"></a>

### 2.1 Golden component library (`fixtures/`)

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

### 2.2 Per-feature micro-fixtures (`fixtures/micro/` — plain-markup stories in the React + Vite Storybook, D-26)

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

---

## 3. Storybook adapter integration tests

- **Sandboxes generated**, not hand-maintained: `npx storybook@<ver> sandbox <template>`-style templates (or `create-storybook` with pinned versions) for renderer **react-vite** (D-26) on SB **10.6.x** (primary, full suite, PR gate) and **11.x** (tracked from beta, full nightly; PR gate at GA), plus **8.6.x / 9.1.x** as smoke tests only (best-effort, D-11). SB 7.x is not run. vue3-vite, web-components-vite, angular and svelte-vite cells are added by the post-M5 renderer expansion. Our golden fixture stories are copied in.
- Both **dev server** and **static build** per SB 10/11 cell; static only for the nightly full matrix to save time.
- Assertions: index parse, metadata (args/argTypes/docgen incl. SB11 `docgenServer` path via `manifests/components.json`), render loop (setCurrentStory/updateStoryArgs/updateGlobals), readiness (storyFinished ?? storyRendered), errors mapped to `SB_*` codes, pseudo-state strategies, theme discovery.
- Matrix result published as a support table in docs (auto-generated).

---

## 4. Fidelity harness <a id="fidelity-harness"></a><a id="fidelity"></a><a id="harness"></a>

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

1. **Primary: self-hosted macOS runner** with Figma desktop logged into a dedicated bot account (Professional or Organization plan to allow modes, D-18 tests), a fixed test file per suite. The dev plugin is imported from manifest; automation launches it via AppleScript/`osascript` keyboard shortcut ("Run last plugin") with `harness` mode stored in clientStorage. Harness mode: plugin pulls fixtures from the local server, applies, reads back boxes, exports PNGs, posts results to `/v1/fidelity`, closes. Dev plugins run reliably only in the desktop app (research: architecture brief).
2. **Experimental: Figma MCP `use_figma`** (S-11) — run builder code server-side against a test file; would remove the macOS runner. Constraints: 48 KB output per call, no images directly, beta/usage-based pricing.
3. **REST image export** (`GET /v1/images/:key?ids=…&format=png&scale=2`) as a fallback for T2 if `exportAsync` round-trips are a bottleneck. Tier 1 rate limit: only 10–20 req/min with Dev/Full seat; **20/month for View/Collab** → bot account must hold a Full seat; batch many ids per request.
4. Real-Figma conformance replay: the harness records the op log; `figma-fake` replays it; any divergence in thrown errors or final structure fails `figma-fake` contract tests (keeps the fake honest).

### 4.5 Competitive benchmark

Quarterly (and before launch): run the micro-fixture and golden corpus through **Figma code-to-canvas** (`generate_figma_design`) and, where licensing permits, story.to.design trial, into separate files; score with the same T1/T2 harness (geometry, SSIM, auto-layout coverage, layer count, naming quality sample). Publish methodology and results (marketing + honesty; [01](01-landscape.md)).

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
  severity: 'info'|'warn'|'error';  // default; emitters may raise, never lower below 'info'
  message: string;              // ICU template, e.g. "Font {family} {style} is not available in Figma; used {substitute}."
  fallback?: string;            // what we did instead
  docs: `/docs/diagnostics/${string}`;
  since: string;                // version introduced
  deprecated?: string;
}
// Emitted instance (see 06-ir): { code, severity, nodeKey?, variantKey?, sid?, message, data? }
```

Process: a new code is added to `diagnostics.ts` + a docs page `docs/diagnostics/<CODE>.md` (cause, example, fix, related config) in the same PR; a CI check fails on unregistered codes or missing docs pages. Severity semantics: **info** = lossless choice worth knowing; **warn** = visible approximation; **error** = component/variant not produced or produced incorrectly. The catalog below is the **complete** set. Every code used in any chapter appears here exactly once, under one canonical name chosen after the stage that emits it (`NOUN_CONDITION` style). A chapter that coins a code adds its row here in the same change. Severities follow the defining chapter: where a chapter says a code fails the component or the run, it is an error. In these tables, *warning* is the registry's `'warn'`.

### 6.2 Catalog

**265 codes in 14 domains:** SB 27 · PLAN 43 · CAP 30 · LAYOUT 16 · TEXT 10 · FONT 7 · PAINT 16 · SVG 5 · TOKEN 21 · APPLY 20 · SYNC 20 · NET 7 · SEC 6 · DCR 37.

Columns: **Emitted by** is the package that raises the code ([02 §6](02-architecture.md#monorepo)). **User remedy** is the text the report, the plugin and the docs page lead with: what the user can do, in plain words. "Nothing to do" means the result is correct and the code is only there to explain a choice. **Defined in** is the chapter that specifies the behaviour.

#### Storybook (SB_) — 27

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `SB_INDEX_UNREACHABLE` | error | `storybook` | `index.json`/`stories.json` could not be loaded; fatal for the run (exit 3) | Check the URL and that Storybook is running. For a static build, run `storybook build` and point Holotype at `storybook-static/` | [03](03-storybook.md) |
| `SB_IFRAME_UNREACHABLE` | error | `storybook` | `iframe.html` did not return 200 | Make sure your host serves `iframe.html` next to `index.json` (check base path and rewrite rules) | [03](03-storybook.md) |
| `SB_VERSION_UNSUPPORTED` | error | `storybook` | Storybook older than 8 (D-11) | Upgrade to Storybook 10 (8 and 9 work best-effort) | [03](03-storybook.md) |
| `SB_VERSION_UNTESTED` | warning | `storybook` | newer Storybook major than the newest adapter; the newest adapter was used | Update Holotype. If the output looks wrong, report it with the run's `report.json` | [03](03-storybook.md) |
| `SB_MANIFEST_UNPARSEABLE` | info | `storybook` | the components manifest has an unknown shape; in-page docgen was used instead | Nothing to do. Update Holotype if props look incomplete | [03](03-storybook.md) |
| `SB_DOCGEN_DEGRADED` | warning | `storybook` | Storybook 11 dev server without its docgen service; argTypes are reduced | Capture from a static build (`storybook build`), or add `@storybook/addon-mcp` | [03](03-storybook.md) |
| `SB_REF_AUTH_REQUIRED` | warning | `storybook` | a composed Storybook ref needs a login; its stories were skipped | Run `holotype login <ref URL>`, then re-run | [03](03-storybook.md) |
| `SB_AUTH_FAILED` | error | `storybook` | 401/403 on `index.json` | Set `HOLOTYPE_SB_TOKEN` (or headers) or run `holotype login <url>` | [03](03-storybook.md) |
| `SB_AUTH_REDIRECT` | error | `storybook` | `index.json` redirected to a login page | Run `holotype login <url>` and sign in once in the window that opens | [03](03-storybook.md) |
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
| **Planner (PLAN_)** | | |
| `PLAN_BUDGET_EXCEEDED` | warn | matrix > budget; reduced via pairwise/priority |
| `PLAN_AXIS_NO_VISUAL_EFFECT` | info | arg values render identically; axis dropped |
| `PLAN_STATE_NO_VISUAL_EFFECT` | info | pseudo-state render identical to default; dropped |
| `PLAN_CLASSIFICATION_REJECTED` | warn | forced BOOLEAN/TEXT failed render-and-diff; used VARIANT |
| `PLAN_ARG_NOT_ENUMERABLE` | info | text/object/node arg fixed at initialArgs |
| `PLAN_CONDITIONAL_ARG_PRUNED` | info | combos removed by argType `if` |
| `PLAN_DUPLICATE_VARIANT` | info | two combos produced identical Scene; deduped |
| **Capture (CAP_)** | | |
| `CAP_CLOSED_SHADOW_LATE` | warn | closed shadow root created before hook; used CDP pierce |
| `CAP_CROSS_ORIGIN_IFRAME` | warn | iframe content via screenshot |
| `CAP_RASTERIZED` | warn | subtree rasterized (data.reason: filter, 3d-transform, foreignObject, canvas-tainted …) |
| `CAP_CSS_UNSUPPORTED` | warn | property has no Figma equivalent (data.property) |
| `CAP_TRANSFORM_SKEW` | info | skew via relativeTransform |
| `CAP_NATIVE_CONTROL_SYNTH` | info | native control synthesized |
| `CAP_IMAGE_FORMAT_CONVERTED` | info | WebP/AVIF/SVG-img → PNG |
| `CAP_IMAGE_DOWNSCALED` | warn | >4096px downscaled |
| `CAP_IMAGE_LOAD_FAILED` | warn | image failed to load; placeholder fill |
| `CAP_OVERFLOW_AXIS` | warn | axis-specific overflow approximated as clip |
| `CAP_ZINDEX_HOIST` | warn | node hoisted to stacking-context root as absolute |
| `CAP_PSEUDO_MATERIALIZED` | info | pseudo measured via materialization fallback |
| **Layout (LAYOUT_)** | | |
| `LAYOUT_FALLBACK_SIMULATION` | info | auto layout rejected by capture-side simulation (data.maxDelta) |
| `LAYOUT_FALLBACK_READBACK` | warn | auto layout reverted after plugin read-back |
| `LAYOUT_FALLBACK_MARGIN` | info | irregular margins → wrapper/split/absolute |
| `LAYOUT_FALLBACK_ALIGN_SELF` | info | per-child align-self → wrapper/absolute |
| `LAYOUT_FLEX_GROW_UNEQUAL` | info | unequal grow → FIXED sizes |
| `LAYOUT_SPACE_AROUND_APPROX` | info | space-around/evenly → measured spacing (non-responsive) |
| `LAYOUT_WRAP_UNSUPPORTED` | info | wrap-reverse / unverifiable wrap → fallback |
| `LAYOUT_GRID_UNSUPPORTED` | warn | dense/areas/subgrid/overlap → stacks/absolute |
| `LAYOUT_GRID_AUTO_FILL_FROZEN` | info | auto-fill/fit count frozen at capture width |
| `LAYOUT_PERCENT_RESOLVED` | info | % sizes resolved to px |
| `LAYOUT_ZORDER_FLOW_CONFLICT` | warn | paint order ≠ flow order; absolute fallback |
| **Text (TEXT_)** | | |
| `TEXT_LINE_MISMATCH` | warn | Figma line count ≠ browser (data.expected, actual) |
| `TEXT_WIDTH_BUFFER` | info | widened by N px to avoid extra wrap |
| `TEXT_CASE_BAKED` | info | text-transform baked into characters |
| `TEXT_SPLIT_MIDLINE` | info | inline context split into per-line nodes |
| `TEXT_DECORATION_APPROX` | info | unsupported decoration style |
| **Fonts (FONT_)** | | |
| `FONT_MISSING` | warn | face not available in Figma |
| `FONT_SUBSTITUTED` | warn | substitute used (data.original, substitute) |
| `FONT_SYNTHETIC` | warn | browser synthesized bold/italic |
| `FONT_FALLBACK_GLYPHS` | warn | some glyphs rendered by fallback font |
| `FONT_LOAD_FAILED` | warn | web font failed to load in browser |
| `FONT_ICON_VECTORIZED` | info | icon font glyphs converted to vectors |
| **Paint & effects (PAINT_)** | | |
| `PAINT_BORDER_PER_SIDE_DECOMPOSED` | info | per-side colors/styles → vectors |
| `PAINT_BORDER_PER_SIDE_APPROX` | warn | dominant color used |
| `PAINT_BORDER_STYLE_APPROX` | info | dashed/dotted/double approximated |
| `PAINT_RADIUS_ELLIPTICAL` | warn | elliptical radius → min / path |
| `PAINT_RING_PROMOTED` | info | ring shadow → OUTSIDE stroke |
| `PAINT_SPREAD_UNSUPPORTED` | warn | shadow spread moved to backing rect / dropped |
| `PAINT_GRADIENT_APPROX` | info | conic/interpolation-space/repeating approximated |
| `PAINT_COLOR_GAMUT_MAPPED` | info | out-of-sRGB color gamut-mapped |
| `PAINT_FILTER_UNSUPPORTED` | warn | filter other than blur/drop-shadow |
| `PAINT_BLEND_UNSUPPORTED` | warn | blend mode mapped approximately |
| **SVG (SVG_)** | | |
| `SVG_IMPORT_FAILED` | error | `createNodeFromSvg` threw; rasterized |
| `SVG_USE_UNRESOLVED` | warn | `<use>` target not found |
| `SVG_FEATURE_RASTERIZED` | warn | filter/mask/foreignObject → raster |
| `SVG_ICON_EXTRACTED` | info | repeated SVG promoted to icon component |
| **Tokens (TOKEN_)** | | |
| `TOKEN_UNRESOLVED_VAR` | warn | `var()` with no definition (fallback used) |
| `TOKEN_CALC_UNBINDABLE` | info | value from `calc()`/`color-mix()` — literal used |
| `TOKEN_VALUE_MATCHED` | info | low-confidence value-equality binding (opt-in) |
| `TOKEN_MODE_LIMIT` | warn | plan mode limit; fallback per config |
| `TOKEN_LIBRARY_CONFLICT` | warn | existing variable differs from code; not overwritten (D-18) |
| `TOKEN_SCOPE_MISMATCH` | info | variable scope disallows field; bound anyway/skipped |
| **Apply (APPLY_)** | | |
| `APPLY_NODE_FAILED` | error | Plugin API threw for a node (data.op, message) |
| `APPLY_MIXED_VALUE` | info | `figma.mixed` encountered; normalized |
| `APPLY_IMAGE_REJECTED` | warn | `createImage` failed |
| `APPLY_INSTANCE_MISMATCH` | warn | nested instance render ≠ capture; kept as frame (D-21) |
| `APPLY_CANCELLED` | info | user cancelled; partial |
| **Sync (SYNC_)** | | |
| `SYNC_CONFLICT_KEPT` | warn | designer edit kept |
| `SYNC_CONFLICT_OVERWRITTEN` | warn | designer edit overwritten by choice |
| `SYNC_OVERRIDE_NOT_RESTORED` | warn | instance override lost (structural change) |
| `SYNC_RENAME_DETECTED` | info | story renamed; mapping migrated |
| `SYNC_DEPRECATED` | info | component deprecated (D-20) |
| `SYNC_REGISTRY_CORRUPT` | error | root registry unreadable; rebuilt from node data |
| **Network (NET_)** | | |
| `NET_LNA_BLOCKED` | error | local network access denied |
| `NET_SERVER_UNREACHABLE` | error | no server on manifest ports |
| `NET_PAIRING_INVALID` | error | bad/expired token |
| `NET_VERSION_MISMATCH` | error | IR major mismatch |
| `NET_PORT_IN_USE` | error | CLI cannot bind any manifest port |
| **Security (SEC_)** | | |
| `SEC_HOST_REJECTED` | error | server rejected Host header (DNS rebinding guard) |
| `SEC_SECRET_REDACTED` | info | input/password values redacted |
| `SEC_EGRESS_BLOCKED` | warn | (hosted) request to private range blocked |

---

<a id="observability"></a>

## 7. Observability

### 7.1 `report.json` (CLI, Action, plugin export — same schema, TypeBox in `ir`)

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

Install id = random UUID stored locally; `DO_NOT_TRACK=1` and `CI=true` force off; `holotype telemetry status|enable|disable`.

---

## 8. Release quality gates

A release (any `@holotype/*` minor/major, plugin publish) requires:

1. L0–L4 green on the full sandbox matrix for first-class SB versions (SB 10 react-vite; 11 once GA) and smoke green on 8.6/9.1 (D-11, D-26).
2. Nightly fidelity within ratchet baseline; README §4 targets met from M5 onward (before: tracked, not gating).
3. Sync e2e (L6): 100% override retention on the unchanged-structure suite; no unexpected `SYNC_OVERRIDE_NOT_RESTORED`.
4. Perf budgets (§5) within 10% of baseline.
5. Schema: JSON Schema diff reviewed; IR major bump only with migration + plugin compatibility window (plugin reads current and previous major, [06](06-ir.md)).
6. Security checklist ([13](13-security-legal.md)): manifest domains unchanged or reviewed, no new outbound hosts, dependency audit clean.
7. Docs: every new diagnostic code documented; changelog via changesets.
