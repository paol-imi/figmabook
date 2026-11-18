# 14 — Roadmap: phases, spikes, milestones, risks

> Assumptions for estimates: **3 engineers** (E1 capture/Storybook, E2 mapper/layout/text, E3 plugin/sync/UX), plus ~0.3 FTE design/UX review from M2. Estimates are in **engineer-weeks (ew)**, include tests and docs, and carry ±30% uncertainty until Phase 0 closes. Calendar estimates assume parallel work: ~11–13 months from start to public launch (M8).

---

## Overview

```
Phase:  0 ──► 1 ──► 2 ──┬──► 3 ──► 4 ──┬──► 6 ──► 7 ──► 8
                        │              │
                        └──► (5 can start after 3, in parallel with 4) ┘
Milestones: M0   M1    M2      M3     M4    M5     M6    M7    M8
```

| Phase | Theme | Effort (ew) | Calendar (3 eng.) | Milestone |
|---|---|---|---|---|
| 0 | Foundations & spikes | 12 | 4–5 wk | M0 |
| 1 | Pixel-correct snapshot | 15 | 5–6 wk | M1 |
| 2 | Native structure | 20 | 7 wk | M2 |
| 3 | Components & variants | 20 | 7 wk | M3 |
| 4 | Sync | 15 | 5–6 wk | M4 |
| 5 | Tokens | 12 | 4–5 wk (parallel with 4) | M5 |
| 6 | Composition | 12 | 4–5 wk | M6 |
| 7 | Automation | 15 | 5–6 wk | M7 |
| 8 | Public launch | 10 | 4 wk | M8 |
| | **Total** | **~131 ew** | | |

---

<a id="phase-0"></a>

## Phase 0 — Foundations & spikes (M0)

**Goal:** a working skeleton and evidence for every decision marked 🟡 or "(verify)" in README §5 and the chapters.

**Deliverables:**
- Monorepo per D-04 with all packages from README §6 as empty, building, tested skeletons; CI (lint, typecheck, unit, schema emission check); changesets; Apache-2.0 headers (D-02 provisional).
- `ir`: TypeBox schemas v0 for Capture IR, Scene IR, bundle manifest, report ([06](06-ir.md)); canonical JSON + hashing with property tests.
- `shared`: diagnostics registry scaffold + docs page check ([12](12-quality.md#diagnostics)).
- `plugin`: create-figma-plugin scaffold, manifest with `documentAccess: "dynamic-page"`, candidate `networkAccess`, a "spike runner" UI that executes spike scripts and exports results JSON.
- `fixtures/`: first 30 micro-fixtures + React golden Button/Input/Card in a SB 10 sandbox.
- **Spike reports** in `docs/spikes/S-xx.md`, each ending with a decision update to README §5.

### Spikes

| ID | Question | Method | Success criteria / output | Timebox | Unblocks |
|---|---|---|---|---|---|
| **S-01** | Can the plugin UI reach a loopback server under Chrome Local Network Access (142+, "Apps on device" in 145) in: Figma desktop (macOS/Windows), Chrome, Edge, Safari, Firefox? fetch **and** WebSocket? Do fixed ports in `allowedDomains` with `reasoning` pass? Does PNA preflight (`Access-Control-Allow-Private-Network`) matter? | Minimal plugin with manifest listing `http://127.0.0.1:47321-47323` (three explicit entries) + `ws://`; tiny Hono server with `ACAO:*`; test matrix of client × OS × permission state; inspect console/CSP errors; compare with published "Cursor Talk to Figma MCP" manifest pattern | Matrix table; recommended manifest entries; UX copy for each failure mode; decide whether WS or HTTP long-poll/SSE is the streaming default | 4 d | D-25, D-10, [02](02-architecture.md) protocol, [11](11-ux.md) §6.11 |
| **S-02** | Which in-place mutations of a main component preserve instance overrides (fill, text, visibility, nested instance swap, component property values) — locally and via library publish? | Build a component with 15 child types; create instances with every override kind; apply a mutation matrix: property edits, reorder (`insertChild`), rename, reparent, delete+recreate same name, change layoutMode, add/remove sibling, change variant property names/values, swap nested main component, `swapComponent` vs `mainComponent=`; verify override survival programmatically (`instance.overrides`, values) both in-file and after library publish/update in a consumer file | Survival matrix (mutation × override kind × local/library); codified "safe mutation" rules → `plugin` reconciler constraints and `figma-fake` contract | 5 d | D-19, [10](10-sync.md) |
| **S-03** | Exact conventions: `gradientTransform` space (identity = left→right?), radial center/radius, ANGULAR origin & direction vs CSS conic; multiple-shadow stacking order vs CSS; `LAYER_BLUR` and `BACKGROUND_BLUR` radius vs CSS σ (is ×2 right?); spread behaviour on frames | Micro-fixtures rendered in Chromium; same params built in Figma; T2 pixel compare across parameter sweeps; fit factors | Verified formulas checked into `mapper` with tests; ≤1% pixel error on sweep fixtures | 3 d | [07](07-mapping.md) visuals |
| **S-04** | Text parity Chromium vs Figma: advance-width drift, line-break agreement, `line-height: normal` resolution, baseline placement, letter-spacing %, for Inter, Roboto, SF/system, Noto CJK, a variable font | 300 paragraphs × widths × sizes; compare line breaks and per-line boxes (T1); measure needed width buffer distribution | Drift distribution; default buffer policy; whether `locked-lines` must be default for some fonts; baseline offset correction table if needed | 5 d | D-17 |
| **S-05** | Border/stroke model: INSIDE stroke + `padding+border` with `strokesIncludedInLayout:false` vs `true`; per-side weights in auto layout; dash phase; outline | Fixture sweep; T1 box compare and T2 pixels; editing ergonomics review with a designer | Choose default (D-16 confirmed or flipped); documented edge cases | 2 d | D-16 |
| **S-06** | Plugin performance at scale: build 1k and 5k variants (20–200 nodes), `combineAsVariants` cost vs set size, `addComponentProperty` binding cost, memory growth over repeated applies, time-slicing overhead, `exportAsync` throughput | Synthetic Scene IR generator; harness timing + `performance.memory` where available; vary batch sizes and slice lengths | Measured curves; practical max variants per set (sets the default budget, [04](04-variant-model.md)); slicing params; confirm README §4 build-throughput target or revise | 4 d | perf budgets, budget defaults |
| **S-07** | Storybook render loop robustness across 8.6 / 9.1 / 10.6 / 11-beta: `loadStory`, `setCurrentStory`, `updateStoryArgs` with non-serializable values, `updateGlobals`, readiness events (`storyFinished ?? storyRendered`), `StorybookTestRunner` UA animation snapping, SB11 `docgenServer` + `manifests/components.json` argTypes merge | Generated sandboxes × renderers (react, vue3, web-components, angular); scripted 200-variant loop; failure injection (story throws, play fails) | Adapter compatibility layer spec; per-version quirks list; throughput numbers; go/no-go on 7.6 | 5 d | D-11, [03](03-storybook.md) |
| **S-08** | Pseudo-state strategies on real DSs: CDP `CSS.forcePseudoState` (target + ancestors) vs Playwright real interaction vs pseudo-states addon global; CSS-in-JS late rules; JS-driven hover (Radix `data-state`, MUI ripple) | Run all three on MUI, shadcn, Shoelace, golden fixtures; diff renders | Per-strategy success rates; default strategy ordering & auto-detection heuristics (e.g. hover handlers present ⇒ interact) | 3 d | D-14 |
| **S-09** | `createNodeFromSvg` fidelity (gradients, clipPath, mask, `<use>`, stroke alignment, `<text>`) and icon-font → outline pipeline (opentype.js/fontkit + harfbuzzjs ligatures) | SVG corpus from 3 icon sets + DS icons; T2 compare; outline extraction for Material Symbols / Font Awesome | Rules for when to rasterize; icon-font converter prototype; diagnostics list | 3 d | [05](05-capture.md), [07](07-mapping.md) |
| **S-10** | Figma GRID auto layout vs CSS grid: FLEX(fr)/FIXED/HUG tracks, gaps, spans, alignment, HUG containers (Update 120+), defaults for plugin-created grids (FIXED container, FLEX tracks) | Grid micro-fixtures; build with `layoutMode:'GRID'`, `setGridChildPosition`; T1 compare | Supported-subset table; `layout-sim` grid model calibrated | 3 d | [07](07-mapping.md) grid |
| **S-11** | Can Figma MCP `use_figma` run our applier server-side for CI harness or headless builds? Input size limits, execution time, images (`upload_assets`), fonts (account-uploaded only), determinism, pricing outlook | Bundle applier into a self-contained script; drive via remote MCP from a Node client; apply 10 fixtures; read back boxes; compare to desktop results | Feasibility verdict; limits table; harness design if viable; ToS/terms review note ([13](13-security-legal.md)) | 3 d | [12](12-quality.md) §4.4, Phase 7 MCP |
| **S-12** | Variables: bindable-field coverage in practice (padding, gap, radius, typography, effects), `setExplicitVariableModeForCollection`, mode limits per plan, `codeSyntax.WEB` matching and `importVariableByKeyAsync` against a team library, aliases across collections; `documentationLinks` on sets | Test file on Starter/Pro/Org bot accounts; scripted bindings; library publish + consume | Coverage matrix; plan-limit handling (`TOKEN_MODE_LIMIT` fallback); library-matching algorithm confirmed | 3 d | D-18, [08](08-tokens.md) |
| **S-13** | Nested component detection per framework: React fiber `type` ↔ Storybook `component` refs (dev & prod builds), Vue `__vueParentComponent.type`, Angular `ng.getComponent` (dev only?), custom-element tags + CEM; structural-hash fallback accuracy | Golden fixtures with nesting (Card→Button→Icon) in each renderer, dev & static builds | Detection precision/recall per framework/build mode; prop-extraction reliability (`memoizedProps`); decision on default enablement | 3 d | D-21, [09](09-plugin.md) |

**Exit criteria (M0):** all 13 spike reports merged; README §5 updated (every 🟡 resolved or re-dated); CI green; one micro-fixture flows CLI → bundle → plugin as a rectangle-only smoke test.

---

## Phase 1 — Pixel-correct snapshot (M1)

**Goal:** `figmabook capture --story <id>` → bundle → plugin builds an **absolute-positioned** frame tree that is pixel-faithful. Absolute is the baseline that every later phase falls back to (D-15).

| Package | Deliverables |
|---|---|
| `storybook` | index v4/v5 parse; preview boot; render one story by id (URL + channel); readiness; root detection + decorator unwrap |
| `capture` | composed-tree walk (open + closed shadow, slots, `display:contents`), CDP box model geometry + affine transforms, fills/strokes/radius/effects capture, text runs + lines, CDP platform fonts, images (fetch, convert, dedupe), inline SVG serialization, pseudo-elements (CDP), stacking order, rasterization fallback |
| `mapper` | absolute-only Scene IR (frames/rect/text/vector/image), gradient/shadow/blur math (S-03), per-side border handling (S-05), font mapping requests |
| `plugin` | bundle import (file, topology B), fonts preflight, absolute applier, images, SVG, text ranges, read-back geometry, report tab |
| `cli` | `capture`, `export`, `doctor` (subset) |
| `fidelity` | T0, T1, T2 harness; macOS runner online; baseline v1 |

**Out:** auto layout, components, variants, sync, tokens.
**Exit criteria:** on micro-fixtures excluding layout groups: p95 box error ≤1px, median SSIM_masked ≥0.98; text line parity ≥95%; fonts preflight works; harness nightly green with ratchet. **Effort:** 15 ew.

---

## Phase 2 — Native structure (M2)

**Goal:** designer-grade structure: auto layout and grid with verification (D-15), text fidelity (D-17), simplification and naming.

| Package | Deliverables |
|---|---|
| `capture` | Typed OM size keywords, CDP matched styles (authored intent: `fr`, `flex`, `calc`), optional layout probing at multiple widths |
| `layout-sim` | Figma stack + wrap + grid simulation calibrated with S-10 / T1 data |
| `mapper` | container classification, flex/grid mapping, sizing HUG/FILL/FIXED, margin strategies, absolute children + constraints, z-order handling, tree simplification, naming chain, text sizing/truncation/wrap modes, embedded per-container fallback |
| `plugin` | auto-layout build-order rules, read-back verification + per-container fallback, `LAYOUT_*` diagnostics in report |
| `fixtures` | Vue + Lit golden ports; real DS dogfooding pipeline (MUI, shadcn, Shoelace) |

**Exit criteria:** auto-layout coverage ≥75% on golden fixtures (≥85% target at M5), geometry p95 ≤1px maintained, text parity ≥97%, ≤5% layers with generic names (`div`, `span`) on golden fixtures. **Decision checkpoint M2:** D-11 (SB matrix), D-22 (file organization). **Effort:** 20 ew.

---

## Phase 3 — Components & variants (M3)

**Goal:** real component sets with variant axes and BOOLEAN/TEXT properties; states; local server topology; first usable end-to-end product.

| Package | Deliverables |
|---|---|
| `storybook` | metadata extraction (args/argTypes/docgen/manifest, SB11 path), globals/themes discovery, channel render loop for many variants per page, pseudo-state strategies (S-08) |
| `planner` | variant source priority (D-12), matrix + `if` pruning, budgets, pairwise mode, render-and-diff classification (D-13): VARIANT/BOOLEAN/TEXT/FIXED/IGNORED, duplicate-variant dedupe, `parameters.figmabook` + config merge per README §7 precedence, `chromatic.modes` fallback reading |
| `mapper` | cross-variant tree alignment (stable `nk` across variants), property bindings (visibility, characters), component-level Scene IR |
| `plugin` | component creation, `combineAsVariants`, set grid layout + default variant placement, `addComponentProperty` + `componentPropertyReferences`, doc frames, Sections/pages (D-22), relaunch buttons, Library tab with statuses (Not imported/Synced/Error), Import config screen, Connect/pair |
| `cli` | `init`, `list --plan`, `serve` (pairing token, Host check, ports per S-01), streaming protocol |
| `storybook-addon` | typed `parameters.figmabook` (types only) |

**Exit criteria:** golden Button/Input/Checkbox/Card imported as sets with ≥70% property quality; states captured where they have visual effect; first-run flow ≤5 min in usability test (5 DS engineers); budgets enforced. **Decision checkpoint M3:** D-02 license final. **Effort:** 20 ew.

---

## Phase 4 — Sync (M4)

**Goal:** override-safe re-import (G5).

| Package | Deliverables |
|---|---|
| `plugin` | identity index (`findAllWithCriteria` on shared plugin data, D-19), apply plan (read-only), keyed in-place reconciler obeying S-02 rules, `irh`/`ah` hashing, conflict detection + policies, deprecation (D-20), rename detection, root registry (chunked), Diff preview + Conflicts screens, Outdated/Conflict/Deprecated chips |
| `cli` | capture cache (content-addressed, key per [02](02-architecture.md)), `cache` command, `serve --watch` |
| `figma-fake` | override model matching S-02 matrix for L6 tests |
| `fidelity` | L6 sync e2e suite (designer-edit simulation) |

**Exit criteria:** 100% override retention on unchanged-structure suite; no-op re-sync = 0 writes; conflict detection precision 100% / recall ≥95% on simulated-edit suite; rename + deletion flows tested with library consumer file. **Effort:** 15 ew.

---

## Phase 5 — Tokens (M5) — parallel with Phase 4 after M3

**Goal:** G4 — variables, aliases, modes, bindings, styles, library matching (D-18).

| Package | Deliverables |
|---|---|
| `capture` | custom property extraction per mode, CDP matched-style `var()` chain resolution per bound property |
| `mapper` | token graph (primitives/semantic collections), binding annotations on Scene nodes, theme → mode mapping, text/effect style candidates |
| `plugin` | variable collections/modes/aliases creation, bindings (paints, spacing, radius, typography, effects), explicit modes on variant frames, library matching (`codeSyntax.WEB` → name), Variables diff in preview (never overwrite), `TOKEN_MODE_LIMIT` fallback |

**Exit criteria:** on Chakra + Carbon + golden themes: ≥90% of `var()`-produced fill/stroke/spacing/radius values bound; 0 bindings on non-`var` values unless value matching enabled; mode switch on a set reproduces the dark-theme capture (SSIM_masked ≥0.98). README §4 metrics become release-gating from here. **Effort:** 12 ew.

---

## Phase 6 — Composition (M6)

**Goal:** nested components as instances (D-21), icons, INSTANCE_SWAP, SLOT.

| Package | Deliverables |
|---|---|
| `capture` | framework boundary hooks (React fiber, Vue, Angular, custom elements) → component id + props per subtree (S-13) |
| `planner` | INSTANCE_SWAP classification (mapping/icon args), SLOT classification (children/ReactNode args), dependency graph + topological import order |
| `mapper` | instance substitution with props → variant/property values; icon extraction (repeated normalized SVG hash, `split` components), slot regions |
| `plugin` | instance creation + `setProperties`, preferred values, `createSlot`/SLOT properties, Icons page, instance-vs-capture verification (`APPLY_INSTANCE_MISMATCH`) |

**Exit criteria:** Card→Button→Icon nesting produces instances in React/Vue/Lit golden fixtures; instance precision ≥98% (no wrong instance), recall ≥85%; icon swaps work in designer test. **Effort:** 12 ew.

---

## Phase 7 — Automation (M7)

**Goal:** G6 — CI, registry, addon, Code Connect, MCP.

| Package | Deliverables |
|---|---|
| `action` | GitHub Action: build-or-use static Storybook, capture, publish bundle + `latest.json` (registry / Pages / artifact), PR summary + annotations, fidelity delta |
| registry | minimal first-party registry domain (static bucket + CDN with `ACAO:*`) listed in manifest; GitHub Pages/raw support per S-01 findings |
| `storybook-addon` | manager panel (sync status, "open in Figma"), `experimental_manifests` emitting `manifests/figmabook.json`, optional in-preview capture hooks |
| `cli` | `codeconnect` (generate Code Connect files from plugin-exported node map), `mcp` server, `login` |
| `plugin` | Registry source, poll `latest.json`, export node map for Code Connect |

**Exit criteria:** fixture repo runs the Action on every PR in <10 min for 50 components; designers see Outdated within one poll after merge; Code Connect files validate with Figma's CLI; MCP tools usable from an agent in an end-to-end demo. **Effort:** 15 ew.

---

## Phase 8 — Public launch (M8)

**Goal:** public release.

- Community listing (name per D-01, trademark-compliant title), privacy policy, security disclosure, network domains justified ([13](13-security-legal.md)); submit ≥3 weeks before target date (review delays).
- Docs site: getting started, config reference (generated from TypeBox), diagnostics pages, recipes (themes, portals, icons, private Storybooks), migration guide from story.to.design (`parameters.s2d.variantProperties` reader, [04](04-variant-model.md)).
- Benchmarks published ([12](12-quality.md) §4.5).
- Hardening: crash-free plugin sessions ≥99.5% in beta; top-20 diagnostics reviewed for fixability.
- After launch (not in M8 scope): hosted renderer (topology C) with sandboxing ([13](13-security-legal.md)), decision gated on demand.

**Exit criteria:** README §4 targets met on golden + micro corpus; beta with ≥5 external teams, ≥3 using CI mode; no open P0/P1. **Effort:** 10 ew.

---

## Milestones

| M | Name | Definition of done | Decisions due |
|---|---|---|---|
| M0 | Foundations | Phase 0 exit criteria | D-25, D-16, D-11 (preliminary), D-10 confirmed |
| M1 | Snapshot | Phase 1 exit | — |
| M2 | Native structure | Phase 2 exit | D-11, D-22 |
| M3 | Components alpha | Phase 3 exit; private alpha with 2 friendly teams | D-02, D-01 shortlist |
| M4 | Sync beta | Phase 4 exit | — |
| M5 | Tokens | Phase 5 exit; metrics gating | — |
| M6 | Composition | Phase 6 exit; public beta (private org plugin or unlisted) | distribution (README §9 Q4) |
| M7 | Automation | Phase 7 exit | registry hosting |
| M8 | Launch | Phase 8 exit | hosted tier go/no-go |

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
| R9 | Community review delays / rejection (network access, localhost reasoning) | M | M | Minimal domains, clear reasoning, privacy policy, early private org plugin, submit early | 8 |
| R10 | Trademark conflict over name | H (if unchanged) | M | Rename before public (D-01); codename only internally | 3–8 |
| R11 | CSS-in-JS late rules / JS-driven states missed | M | M | CDP force + interact fallback (S-08), "no visual effect" detection | 3 |
| R12 | `use_figma` pricing/limits make headless harness impractical | M | L | macOS runner remains primary | 0, 7 |
| R13 | Variables mode limits per plan block theming | M | L | `TOKEN_MODE_LIMIT` fallback to axis | 5 |
| R14 | Nested component detection unreliable in production builds (minified names, no fiber debug) | M | M | Use `component` reference identity (not names), structural hash fallback, verification before instancing (D-21) | 6 |
| R15 | Scope creep / timeline slip | H | M | Phase exit criteria, ratchet metrics, defer hosted tier | all |
| R16 | Legal challenge from competitor | L | M | Clean-room implementation, no clipboard reverse-engineering ([13](13-security-legal.md)) | all |

---

## Open questions

From README §9 (user decisions):
1. D-01 public name.
2. D-02 Apache-2.0 vs MIT; any hosted/paid tier intended?
3. Fixture/dogfooding target: React-only first, or React + Vue + Lit from day one? (Plan assumes React first in Phase 1, Vue + Lit in Phase 2.)
4. Distribution: Community public vs private org plugin first.
5. Is Storybook 7.6 required (D-11)?

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
9. S-07 Storybook sandboxes generator script (8.6/9.1/10.6/11-beta × react/vue/wc) + render loop prototype. (E1)
10. S-03 gradient/shadow/blur sweeps (micro-fixtures + Figma builder script). (E2)
11. S-05 border model sweep. (E2)
12. Fixtures: first 30 micro-fixtures (flex, borders, backgrounds, text basics) as plain HTML stories. (E1)

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
21. S-13 nested component detection prototype (React + Vue). (E1)
22. Smoke path: CLI captures one micro-fixture → minimal Capture IR → absolute Scene IR → plugin file import builds rectangles + text. (all)
23. macOS self-hosted runner provisioning + Figma desktop bot account + "run last plugin" automation proof. (E3)
24. Write spike reports; update README §5 decisions; replan Phase 1 estimates. (all)
