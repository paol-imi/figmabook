# 01 · Landscape & differentiation

> **Purpose:** know exactly what exists, where it fails, and which ground Holotype takes. Every claim below is tagged:
> - **[V]**: verified in a cited source. **Last checked: 2026-11** for every [V] row unless the row gives another date.
> - **[I]**: inferred.
> - **(unverified)**: an older claim that could not be confirmed at the last check.
>
> Re-check this chapter every quarter (the "first-party check", [14](14-roadmap.md#hardening)). Sources are the planning research briefs (Nov 2026). The story.to.design docs were read from `https://story.to.design/docs/*`. Its bug tracker is `https://github.com/divriots/story-to-design/issues`.

## 1. story.to.design (divRIOTS): the incumbent (last checked: 2026-11)

Re-checked Nov 2026: no notable product change (SB10 support Nov 2025; no AI/MCP features).

### 1.1 Snapshot
- [V] Figma plugin by ‹div›RIOTS. Announced 16 Feb 2022, open beta 1 Sep 2022 ([announcement](https://divriots.com/blog/announcing-story-to-design), [open beta](https://story.to.design/blog/we-are-open-beta)).
- [V] Claims "11000+ users, 1000000+ variants generated". Supports Storybook 6–10, Histoire and Backlight ([home](https://story.to.design/), [SB10 support](https://story.to.design/blog/storybook-10-support)).
- [V] Closed source. The public GitHub repo is only an issue tracker (~274 issues).

### 1.2 Workflow ([connect](https://story.to.design/docs/connect-your-storybook), [import](https://story.to.design/docs/import-your-first-component))
1. **Connect** a Storybook in one of four ways:
   - public URL;
   - basic auth (credentials typed into the plugin and used by *their cloud*);
   - Cloudflare service tokens;
   - "private/local" through a **desktop agent**. The agent is a tray app on port 9265 that runs the same renderer locally and is required for VPN, SSO or localhost ([agent](https://story.to.design/docs/agent)).
2. **Import:**
   - pick a component and a story;
   - choose "pre-made properties" (args, simulated states, globals) or add values by hand;
   - click "Import N variants". The server renders, then the user clicks "Add to canvas".
   - The output is a component set plus a generated docs frame with Storybook links.
3. **Statuses:** Synced, Outdated, or in progress ([status](https://story.to.design/docs/components-status)).
4. **Local mode:**
   - paid, agent-only;
   - **hard-coded to `http://localhost:6006`**;
   - adds a "Refresh canvas" button and overrides the production sync ([local mode](https://story.to.design/docs/local-mode)).

### 1.3 Variant model ([args](https://story.to.design/docs/args), [variant-properties API](https://story.to.design/docs/variant-properties-api))
- [V] **Each Figma variant is one render of one story with an arg set**, loaded through `iframe.html` with URL args. If "open canvas in new tab" renders differently from Controls, the import breaks ([misrendered](https://story.to.design/docs/variants-misrendered)).
- [V] Builds the **full Cartesian product** of selected values. Pruning is manual: `excludedArgs` per value, `initArgs` for fixed args.
- [V] Controls supported: boolean, radio/select/check variants, number/range, text, color. **Unsupported: object, array, date, file.**
- [V] JSON config in `parameters.s2d.variantProperties`:
  - `fromArg`, value renaming, `withArgs` bundles;
  - `axis` x/y for grid placement;
  - `split` (separate components, used for icon libraries);
  - `type: components|component-set`;
  - `:story` to pull variants from several stories.
- [V] Globals can be variant properties ([globals](https://story.to.design/docs/storybook-globals)).
- [I] **No documented generation of BOOLEAN/TEXT component properties.** Every selected arg becomes a variant axis, so variant counts explode. Their own benchmark imports 2,160 variants ([perf blog](https://story.to.design/blog/faster-variants-processing)).
- [V] `:slots` maps children and named slots to Figma slots ([special args](https://story.to.design/docs/special-args)).
- [V-ish] Nested instance-swap exists (issue #63, closed). It requires importing atoms first ([subcomponents](https://story.to.design/docs/subcomponents)).

### 1.4 Pseudo-args ([states](https://story.to.design/docs/states), [special args](https://story.to.design/docs/special-args))
- [V] **States:** `:hover`, `:focus`, `:active` (pointer held down, never released), `:tap` (a full click), `:viewport` (named breakpoints), `:appearance` (`prefers-color-scheme`).
- [V] **Capture controls:** `:width`/`:height` ("Try to hug" by default), `:selector`, `:portalSelector`, `:excludeSelector`, `:actionSelector`.
- [I] States are produced by **real pointer and keyboard events**, as `:active` implies. They wait for network idle plus a rAF.
- [V] Auto-generates **prototype reactions**: while hovering → hover variant, on press → active ([prototype](https://story.to.design/docs/prototype)).

### 1.5 Tokens ([variables](https://story.to.design/docs/variables), [matching styles](https://story.to.design/docs/matching-styles))
- [V] **What becomes a variable:** CSS custom properties declared *outside* the component.
  - `--a--b--c` becomes `a/b/c`.
  - `var()` chains become aliases.
  - `--_private` and ignore-lists are skipped.
- [V] **Binding:** bound to fills, strokes, radii, gaps and font sizes. [I] Not padding, effects, line-height or letter-spacing.
- [V] **One collection** (`s2d` by default). Modes come from a theme global. A Variables tab diffs code against Figma, and nothing is overwritten without "Apply".
- [V] Reuses existing color and text styles by matching. No effect styles, no Tokens Studio, no DTCG import (promised in 2023, not shipped).

### 1.6 Sync ([updates](https://story.to.design/docs/updates), [workflow](https://story.to.design/docs/incorporate-s2d-in-workflow))
- [V] Detects new Storybook versions and re-renders in the background. "Review and update" shows a **visual** diff (side-by-side or overlay) and updates per component.
- [V] **Manual edits are unsupported:** "Do not directly edit the components generated… they will lose their connection with code." The advice is to copy into another file or use a branch.
- [V] Re-sync problems in the tracker: #64 (sub-components removed on re-process), #59 and #252 (update loops or no-ops).

### 1.7 Architecture ([perf blog](https://story.to.design/blog/faster-variants-processing), [terms](https://story.to.design/terms-of-use))
- [V] Firebase (Firestore + Functions) running Playwright + Chrome, tuned over CDP. The agent runs the same pipeline locally. **No Storybook addon required.**
- [I] One page navigation per variant.

### 1.8 Pricing ([paid plans](https://story.to.design/docs/paid-plans))
- [V] **Team** plan: $149/mo yearly, $199/mo monthly, **per Storybook** (unlimited users and components).
- [V] Agency plan: custom pricing. Free trial or freemium with undisclosed caps. Local mode is paid-only.

### 1.9 Recurring defects (issue tracker): our explicit test targets
| Class | Issues | Our counter-measure |
|---|---|---|
| Padding/box-model drift | #50, #53, #256, #237 (padding instead of stroke) | D-15/D-16 verification + exact border model ([07](07-mapping.md)) |
| Size mismatch, text resize | #51, #52, #162, #235 | Explicit line-height, read-back line parity ([07](07-mapping.md), [12](12-quality.md)) |
| Inconsistent auto layout across variants | #236, #62 | Cross-variant alignment ([07](07-mapping.md)) |
| Dropped absolute children (tooltip arrow) | #72 | Absolute baseline + pseudo-element boxes from CDP ([05](05-capture.md)) |
| Border longhands | #175 | Per-side weights + decomposition |
| SVG/icon errors (inverted, partial, missing) | #274, #263, #266, #244 | SVG inlining pipeline + icon fonts → vectors ([05](05-capture.md), S-09) |
| Nested components not recognised | #157, #246, #264, #265 | Framework-boundary detection (D-21, S-13) |
| Fonts | #262, #243 | CDP platform fonts + preflight mapping UI ([09](09-plugin.md)) |
| Checkbox/switch active state | #257, #258 | Per-state strategy chain (D-14, S-08) |
| Stuck loading / re-process | #57, #58, #174 | Resumable streaming, per-component isolation ([02](02-architecture.md#protocol)) |
| Placement and selection | #239 (not at 0,0), #250 (layers not selectable) | Deterministic layout (D-22) |
| Missing features | #242 (search), #251 (reorder variant grid) | Plugin search; configurable axis order ([11](11-ux.md)) |

## 2. Figma first-party

### 2.1 Code to canvas: `generate_figma_design` (Feb/Mar 2026)
- [V] A capture script is injected into a running app (including localhost) and converts the screen or an element to editable **flat layers**.
  - There are **no components or variants** and no library connection.
  - Matching variables are auto-bound if the library is in the file.
  - Needs the remote MCP server and a paid plan ([code-to-canvas](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/), [help](https://help.figma.com/hc/en-us/articles/40826832449303)).
- [V] Reported gaps ([Codeminer42](https://blog.codeminer42.com/figma-code-to-canvas-what-the-demo-didnt-show-you/), [UpDoc](https://deanleigh.github.io/UpDoc/tooling/figma/figma-mcp)):
  - misses shadow DOM;
  - turns `background-clip:text` into solid text;
  - captures the viewport only;
  - drops CJK glyphs.
- A sibling tool, `html_to_figma`, converts HTML without running the app.

### 2.2 Write to canvas: `use_figma` (Mar 24, 2026, beta)
- [V] Runs agent-supplied **Plugin API code** server-side against a file. It can create frames, components, variants, variables and auto layout ([blog](https://www.figma.com/blog/the-figma-canvas-is-now-open-to-agents/), [docs](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas)).
- [V] Limits:
  - ≤48 KB of output per call;
  - no images on its own (`upload_assets` is a separate tool);
  - only account-uploaded fonts;
  - remote only;
  - free in beta, later usage-based;
  - needs edit access on Pro or above.
- **Implication:** our applier code could run headless through it. That gives a CI fidelity harness and possibly a "no plugin" build path (S-11). It is not the product path in v1.

### 2.3 Code Connect
- [V] Inverse direction: maps existing Figma components to code snippets in Dev Mode ([Code Connect](https://www.figma.com/developers/code-connect)).
- **Complementary.** We know arg ↔ property mappings, so we can *generate* `*.figma.tsx` files in Phase 7.

### 2.4 Other first-party constraints that shape the market
- The REST API cannot create nodes. Variables REST writes are Enterprise-only ([variables REST](https://developers.figma.com/docs/rest-api/variables/)).
- The only supported write path is the Plugin API, either in a plugin or via `use_figma`.

## 3. Other products and projects

| Product | What it does | Status | Relevance |
|---|---|---|---|
| **html.to.design** (divRIOTS) | URL/HTML → layers, with viewports, themes, hover components, a browser extension for logged-in pages, MCP and an SDK. Free tier 10 imports/mo ([docs](https://html.to.design/docs)) | Active | [I] Same engine as s2d, but no story/variant/sync model |
| **api.to.design** (divRIOTS) | `POST /html-component` with `data-c2d-*` annotations → *pasteable* component sets with properties, via the Figma clipboard format ([blog](https://divriots.com/blog/generate-figma-components-from-html)) | Active (May 2026) | Direct competitor for automation. Relies on an undocumented format we reject ([13](13-security-legal.md#clipboard)) |
| **Storybook Connect** (Chromatic) | Links stories to Figma components and embeds the live story in the sidebar ([docs](https://docs.chromatic.com/docs/figma)) | Active | **Does not convert.** Complementary: we can write the same story links (D-22 doc frames) |
| **Anima** Storybook → Figma | `npx anima-storybook-cli sync -t <token>`: props → variants, CSS → auto layout ([npm](https://npmjs.com/package/anima-storybook-cli)) | [I] Deprioritised; docs redirect to Anima's new product | Proves the CLI/CI push model; that gap is now open |
| **BuilderIO/figma-html** + `html-to-figma` | MIT; DOM → absolute rects + text, no auto layout, font weight ignored, shrinks font size to fit ([repo](https://github.com/BuilderIO/figma-html)) | Retired (code removed in March 2025, last full tree `7fece25`) | Baseline to beat; reference for SVG/image handling |
| **figit web-to-figma** (`@figit/dom-to-figma`) | MIT; geometry-verified auto layout inference, wrap simulation, gradient/blur/border decomposition, oracle "parity ratchet" CI; outputs the Kiwi clipboard format ([repo](https://github.com/figitdesign/web-to-figma)) | Active | **Best technical prior art.** We adopt its *ideas* (verify-then-emit, ratchet) with attribution where code is ported ([13](13-security-legal.md#licensing)) |
| **Lynavo/web2ui** | AGPL; very thorough in-page extractor (oklch canvas readback, font-fallback detection) | Active | **Study only, never copy** (AGPL) |
| **bem/storybook-to-figma** | Plugin + addon, props → variants; 7 commits ([repo](https://github.com/bem/storybook-to-figma)) | Archived 20 Jul 2026 | Confirms there is no maintained OSS equivalent |
| **Locofy / Visual Copilot** | Figma → code | Active | Opposite direction; competes only for the "single source of truth" budget |
| **UXPin Merge** | Puts code components into UXPin and avoids Figma | Active | Different bet: replaces Figma rather than feeding it |

## 4. Feature comparison matrix

Key: ✅ yes, ◐ partial, ✗ no, ? unknown. "holotype v1" means the end of Phase 7 ([14](14-roadmap.md)).

| Capability | story.to.design | Figma code-to-canvas | html.to.design | Anima (legacy) | figit | **holotype v1** |
|---|---|---|---|---|---|---|
| Component sets from stories | ✅ | ✗ | ✗ | ✅ | ✗ | ✅ |
| Variants from args | ✅ (Cartesian) | ✗ | ✗ | ✅ | ✗ | ✅ (planned matrix, D-12) |
| Stories as variants | ◐ (`:story`) | ✗ | ✗ | ? | ✗ | ✅ default when no curated config |
| BOOLEAN / TEXT properties | ✗ [I] | ✗ | ◐ (api.to.design annotations) | ? | ✗ | ✅ verified (D-13) |
| INSTANCE_SWAP / SLOT | ◐ | ✗ | ◐ | ✗ | ✗ | ✅ |
| Nested instances | ◐ (import order, structural) | ✗ | ✗ | ? | ✗ | ✅ framework-boundary (D-21) |
| Pseudo-states | ✅ real events | ✗ | ✅ hover | ? | ✗ | ✅ CDP + real-event fallback (D-14) |
| Auto layout | ✅ "whenever possible" | ✅ | ✅ | ✅ | ✅ verified | ✅ verified + per-container fallback (D-15) |
| Grid auto layout | ✗ [I] | ? | ? | ✗ | ◐ (wrap emulation) | ✅ (S-10) |
| Shadow DOM | ✅ [I] | ✗ (reported) | ? | ? | ◐ | ✅ incl. closed roots |
| Variables from CSS vars | ✅ 1 collection | ◐ binds existing | ✅ | ✗ | ✗ | ✅ multi-collection, aliases, modes (D-18) |
| Effect/padding/typography bindings | ✗ | ? | ? | ✗ | ✗ | ✅ (S-12) |
| Override-safe re-sync | ◐ (fragile) | ✗ | ✗ | ? | ✗ | ✅ keyed in-place (D-19) |
| Designer edits preserved | ✗ explicitly unsupported | n/a | n/a | ✗ | n/a | ✅ conflict policies ([10](10-sync.md)) |
| Diff before apply | ✅ visual | ✗ | ✗ | ? | ✗ | ✅ structural + visual |
| CI / headless | ✗ | ◐ (agent-driven) | ◐ (MCP) | ✅ CLI | ✅ | ✅ Action + registry |
| Local / private without cloud | ◐ (agent, paid for localhost) | ✅ | ◐ (extension) | ✅ | ✅ | ✅ default (G7) |
| Fidelity score per variant | ✗ | ✗ | ✗ | ✗ | ✅ (internal) | ✅ user-visible |
| Code Connect generation | ✗ (own codegen for React/WC) | n/a | ✗ | ✗ | ✗ | ✅ (Phase 7) |
| Open source | ✗ | ✗ | ✗ | ✗ | ✅ MIT | ✅ MIT (D-02) |
| Price | $149–199/mo per Storybook | Figma paid plan | Freemium | Paid | Free | Free core |

## 5. Our wedge

1. **Component model quality, not pixel conversion.** DOM → layers is commoditised now that Figma ships it natively (§2.1). Our value sits in the steps others skip:
   - planned variant matrices (D-12);
   - *verified* component properties (D-13);
   - nested instances (D-21);
   - tokens with modes (D-18).
2. **Sync that designers can trust.** Keyed in-place reconciliation (D-19), protection of designer additions, conflict policies and deprecation instead of deletion (D-20). This answers story.to.design's "don't edit our components" stance head-on.
3. **Build artifact, not a SaaS round-trip.**
   - CLI and GitHub Action produce a versioned bundle from `storybook build` (D-10).
   - Private and SSO Storybooks work without sending credentials anywhere.
   - "Outdated" is a CI fact, not a poll.
4. **Measured fidelity.** Every variant carries a box-delta and SSIM score, and the fixture corpus runs as a ratchet ([12](12-quality.md)). We publish scores against code-to-canvas on the same fixtures.
5. **Open, scriptable, agent-ready.** MIT, a documented JSON Schema for both IRs, and an MCP server so agents can "sync component X" (Phase 7).

### Deliberately *not* competing on
- **Arbitrary websites and full-page capture** (html.to.design, code-to-canvas).
- **Figma → code generation** (Locofy, Builder, Anima). We only generate Code Connect mappings.
- **Histoire or Backlight support** in v1. The adapter interface keeps the door open ([03](03-storybook.md)).
- **A hosted, zero-install, paste-a-URL onboarding** in v1. Local CLI and file import come first; hosted is Phase 8+ (D-10).
- **Two-way sync** of design edits back to code (README §3).

## 6. Threat analysis

| Threat | Likelihood | Impact | Response |
|---|---|---|---|
| **Figma adds "Storybook → components" to code-to-canvas/MCP** (variants from a story URL) | Medium–high within 12–24 months: they already have capture, `use_figma` and variable auto-binding | High: it would remove the need for a basic import plugin | Compete on what platform features will be slowest to do well: override-safe sync with designer edits, verified properties, CI artifacts, open IR, fidelity scoring. Keep the builder able to run via `use_figma` (S-11) so we *ride* their platform instead of fighting it |
| story.to.design copies open features (BOOLEAN props, multi-collection) | High | Medium | Open source, so features are not the moat. The moat is execution speed, community fixtures and integrations (Chromatic, Code Connect, Tokens Studio interop) |
| divRIOTS' api.to.design (clipboard-based) wins automation | Medium | Medium | Our CI path produces plugin-applied, *identity-tracked* updates, which the clipboard approach cannot do (it carries no plugin data) ([13](13-security-legal.md#clipboard)) |
| Figma changes Plugin API or network policy (e.g. LNA) | Medium | High for topology A | File-import fallback is always on (D-10); registry over HTTPS; desktop app as primary client ([02](02-architecture.md#lna)) |
| Storybook internals shift (SB 11 docgenServer, manifests) | High | Medium | Adapter per major version, static manifests first, contract tests per SB line (S-07, [03](03-storybook.md)) |
| Trademark complaint over the name | High if "figma" is in the name | High | Rename before public release (D-01, [13](13-security-legal.md#trademark)) |

## 7. Positioning statement (internal)

> For design-system teams that ship components in Storybook, holotype builds and keeps in sync a native Figma component library: real variants, properties, instances and variables. It runs from your CLI or CI. It is open source, and it is built so designers can safely edit around it.
