# 09 · Figma plugin (package `plugin`)

> **Scope:** the Figma plugin is a **reconciler** (D-09). It receives a Scene IR bundle ([06](06-ir.md)), computes an apply plan against the current file ([10](10-sync.md)), applies it with the official Plugin API, verifies the result by read-back, and falls back per container to the embedded absolute layout (D-15). It never infers CSS. Every decision about *what* to build comes from the CLI-side `mapper` (D-08); the plugin only decides *how to write it safely*.
>
> All API names below are checked against `@figma/plugin-typings@1.142.0` (2026-10-16). Docs: <https://developers.figma.com/docs/plugins/>.

Contents:
1. Responsibilities
2. Manifest
3. Process model & message protocol
4. `FigmaPort`: the narrow API seam
5. Apply pipeline
6. Node write rules & ordering constraints
7. Components, variants & sets
8. Component properties
9. Pages, sections & documentation frames
10. Nested instances & icons
11. Read-back verification & fallback
12. Scheduling: time slicing, progress, cancel, undo
13. Error recovery & resume
14. Fidelity export mode
15. Performance tactics
16. The `use_figma` alternative path
17. Diagnostics
18. Testing the plugin
19. Open questions / spikes

---

## 1. Responsibilities

| The plugin does | The plugin does **not** |
|---|---|
| Pair with the local CLI server, or read a bundle file ([02](02-architecture.md#topologies)) | Talk to Storybook, run a browser, or read CSS |
| Preflight: fonts, images, variables and library matching | Infer layout, properties or tokens (that is the `mapper`) |
| Build an identity index of managed nodes ([10](10-sync.md#index)) | Delete managed nodes that may have instances (D-20) |
| Compute and show an **apply plan** (diff) before writing | Write anything before the user confirms (except in `--auto` harness mode) |
| Apply nodes, components, sets, properties, variables and bindings in the required order | Publish the library (no API exists; the user publishes) |
| Verify geometry and text by read-back, then fall back per container | Rasterize content (rasters arrive pre-rendered as assets) |
| Write the registry, diagnostics and report; optionally export PNGs for fidelity | Send any document data anywhere except the paired local server or registry |

---

<a id="manifest"></a>
## 2. Manifest

create-figma-plugin generates `manifest.json` from the `"figma-plugin"` field of `packages/plugin/package.json`. The effective manifest:

```jsonc
{
  "name": "figmabook",                         // public name pending D-01
  "id": "<assigned by Figma on first publish>",
  "api": "1.0.0",
  "main": "build/main.js",
  "ui": "build/ui.html",                       // single inlined file (create-figma-plugin bundles CSS/JS)
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",            // required for new plugins → async APIs only (D-06)
  "networkAccess": {
    "allowedDomains": [
      "http://127.0.0.1:47321", "http://127.0.0.1:47322", "http://127.0.0.1:47323",   // D-25 local CLI server
      "ws://127.0.0.1:47321",   "ws://127.0.0.1:47322",   "ws://127.0.0.1:47323",
      "https://registry.figmabook.dev"         // CI registry (topology D); final domain pending D-01
    ],
    "devAllowedDomains": ["http://localhost:47321", "ws://localhost:47321"],
    "reasoning": "Connects only to the figmabook CLI running on your own machine (127.0.0.1) to receive component data you exported from your Storybook, and optionally to your team's figmabook registry to download published bundles. No Figma document data is sent anywhere except fidelity screenshots you explicitly request, which go to the same local CLI."
  },
  "permissions": ["teamlibrary"],              // library variable/style/component matching (08 §10)
  "relaunchButtons": [
    { "command": "resync",  "name": "Re-sync from Storybook", "multipleSelection": true },
    { "command": "inspect", "name": "figmabook details" }
  ]
}
```

Notes:

- **Ports.** Every port is listed explicitly; port wildcards are not documented (verify, S-01). `127.0.0.1` is preferred over `localhost`, because it avoids IPv6/`::1` resolution differences (verify, S-01). If Chrome's Local Network Access permission ("Apps on device", Chrome 142+) blocks loopback in the browser app, the UI detects it ([§3.4](#connect)) and steers the user to the desktop app or to file import (D-10).
- **No `"*"` entry.** A wildcard would put "unrestricted network access" on the Community listing ([13](13-security-legal.md#publishing)).
- **Self-hosted registries** that are not on `registry.figmabook.dev` go through file import, or through a CORS-enabled proxy on the registry domain ([02](02-architecture.md#topologies)).
- **Relaunch commands.** `setRelaunchData` is set on every managed component set and on the documentation frame ([§9](#doc-frame)). `resync` re-runs the pipeline scoped to the selected sets' `sid`s.

---

<a id="protocol"></a>
## 3. Process model & message protocol

### 3.1 Two contexts

| Context | Has | Used for |
|---|---|---|
| **UI iframe** (`figma.showUI(__html__, { width: 420, height: 640, themeColors: true })`), Preact | full browser APIs, `fetch`/`WebSocket`, File API, `null` origin | pairing, transport (HTTP/WS or file), unzip, asset fetching, every screen ([11](11-ux.md#plugin)) |
| **Main thread** (sandbox) | document access, `figma.*`, minimal `fetch` | index, plan, apply, verify, registry |

Data flows **UI → main** as chunks. Main **pulls**: it asks for the next unit only when it is ready, which gives backpressure for free.

### 3.2 Message types

Messages are a discriminated union in `packages/plugin/src/protocol.ts`. Every message carries `{ v: 1, sessionId }`.

```ts
type UiToMain =
  | { t: 'hello'; uiVersion: string }
  | { t: 'session.open'; manifest: BundleManifest; source: 'server' | 'file' | 'registry'; options: ApplyOptions }
  | { t: 'unit'; seq: number; unit: TransferUnit; last: boolean }             // response to 'need'
  | { t: 'plan.request'; scope: Scope }                                       // compute diff, read-only
  | { t: 'apply.start'; planId: string; decisions: PlanDecisions }            // user-confirmed choices (10 §8)
  | { t: 'fonts.mapping'; mapping: Record<string /*"Family|Style"*/, FontName> }
  | { t: 'cancel' }
  | { t: 'export.request'; scope: Scope; scale: 1 | 2 }                       // fidelity mode (§14)
  | { t: 'select'; nodeKey: string; sid: string }                             // report → select node in canvas
  | { t: 'pong'; id: number };                                                // yield round-trip (§12)

type MainToUi =
  | { t: 'ready'; pluginVersion: string; irMajors: number[]; fileKey: string | null; registry: RegistrySummary | null }
  | { t: 'need'; unit: UnitRef }                                              // pull next component/asset/tokens
  | { t: 'preflight'; fonts: FontPreflight; images: { missing: string[] }; libraries: LibraryMatchSummary }
  | { t: 'plan'; plan: ApplyPlan }                                            // 10 §8
  | { t: 'progress'; stage: Stage; done: number; total: number; current?: string; etaMs?: number }
  | { t: 'diagnostics'; items: Diagnostic[] }                                 // streamed, batched ≤200 per message
  | { t: 'export.png'; vk: string; bytes: Uint8Array; boxes: NodeBox[] }      // fidelity mode
  | { t: 'done'; summary: ApplySummary }
  | { t: 'error'; code: string; message: string; recoverable: boolean }
  | { t: 'ping'; id: number };

type UnitRef =
  | { kind: 'tokens' }
  | { kind: 'component'; sid: string }
  | { kind: 'asset'; sha256: string };

type TransferUnit =
  | { kind: 'tokens'; json: string }                                          // TokenSet (08 §14)
  | { kind: 'component'; sid: string; json: string; part: number; parts: number } // SceneComponent, split ≤ 1 MB
  | { kind: 'asset'; sha256: string; mime: string; bytes: Uint8Array };

type Stage = 'preflight' | 'index' | 'plan' | 'tokens' | 'apply' | 'verify' | 'finalize' | 'export';
```

Transfer rules:

- **JSON as strings.** Components go over as JSON *strings*, not objects. A string is one structured-clone allocation, and main parses it with `JSON.parse` once all parts have arrived.
- **Part size.** Parts are at most 1 MB. That size is untested, so S-06 finds the real ceiling (verify, S-06).
- **Assets** are sent once per `sha256`. Main first checks the registry's image map ([10](10-sync.md#root-registry)) and asks only for images whose hash is unknown, or whose `figma.getImageByHash(hash)` returns `null`.
- **Integrity.** The UI verifies each component's `sha256` against `manifest.components[sid].sha256` before sending it, which catches corrupt downloads.

### 3.3 Pull loop

```ts
// main
async function* units(refs: UnitRef[]): AsyncGenerator<TransferUnit> {
  for (const ref of refs) {
    const parts: string[] = [];
    figma.ui.postMessage({ v: 1, sessionId, t: 'need', unit: ref });
    for (;;) {
      const m = await nextMessage('unit');                 // resolves on the matching UiToMain 'unit'
      if (m.unit.kind !== 'component') { yield m.unit; break; }
      parts[m.unit.part] = m.unit.json;
      if (parts.length === m.unit.parts && parts.every(Boolean)) {
        yield { ...m.unit, json: parts.join(''), part: 0, parts: 1 };
        break;
      }
    }
  }
}
```

<a id="connect"></a>
### 3.4 Connection & pairing (UI)

The server side of this exchange is specified in [02](02-architecture.md#protocol).

1. **Probe.** The UI probes `http://127.0.0.1:{47321..47323}/v1/session`. A 401 means the server is up but unpaired. A network error means not running, or LNA-blocked.
2. **Pair.** The CLI prints a 6-word pairing code. The user pastes it once. The UI exchanges it via `POST /v1/pair` for a bearer token and stores `{port, token}` with `figma.clientStorage.setAsync('pairing', …)`. clientStorage is reachable from main only, so the UI asks main to store it.
3. **Transport.** Requests use `Authorization: Bearer <token>`. Progress and incremental bundles stream over `ws://…/v1/events?token=…`.
4. **Errors.**
   - The UI can't tell an LNA denial from "server not running". The CLI prints "plugin connected" when it receives a probe, which disambiguates for the user.
   - The UI shows `NET_SERVER_UNREACHABLE` with steps: start `figmabook serve`; use the desktop app; or allow "Apps on device" in the browser.
   - A file-import button is always visible.
5. **File mode.** Drag a `.figmabook.zip` or pick a directory with `webkitdirectory`. Unzip with `fflate` in the UI. No network.

---

<a id="port"></a>
## 4. `FigmaPort`: the narrow API seam

The applier never touches the global `figma`. It receives a `FigmaPort`, which is a typed **subset** of the real Plugin API types. Production binds `FigmaPort = figma`. Tests bind `figma-fake` ([§18](#testing)). Because the port is a `Pick<>` of the official typings, the real object satisfies it with zero glue code, and the fake is type-checked against Figma's own definitions.

```ts
// packages/plugin/src/port.ts
export type FigmaPort = Pick<PluginAPI,
  | 'createFrame' | 'createComponent' | 'createText' | 'createRectangle' | 'createEllipse'
  | 'createVector' | 'createNodeFromSvg' | 'createImage' | 'getImageByHash' | 'createPage' | 'createSection'
  | 'combineAsVariants' | 'loadFontAsync' | 'listAvailableFontsAsync' | 'getNodeByIdAsync'
  | 'commitUndo' | 'notify' | 'root' | 'currentPage' | 'setCurrentPageAsync' | 'mixed'
  | 'skipInvisibleInstanceChildren' | 'importComponentByKeyAsync' | 'importComponentSetByKeyAsync'
  | 'importStyleByKeyAsync' | 'createTextStyle' | 'createEffectStyle' | 'createPaintStyle'
  | 'getLocalTextStylesAsync' | 'getLocalEffectStylesAsync' | 'getLocalPaintStylesAsync'
> & {
  variables: Pick<VariablesAPI,
    | 'createVariableCollection' | 'createVariable' | 'createVariableAlias' | 'getLocalVariablesAsync'
    | 'getLocalVariableCollectionsAsync' | 'getVariableByIdAsync' | 'importVariableByKeyAsync'
    | 'setBoundVariableForPaint' | 'setBoundVariableForEffect'>;
  teamLibrary: Pick<TeamLibraryAPI,
    'getAvailableLibraryVariableCollectionsAsync' | 'getVariablesInLibraryCollectionAsync'>;
  clientStorage: Pick<ClientStorageAPI, 'getAsync' | 'setAsync'>;
};
```

**Lint rule.** A Biome `noRestrictedGlobals` rule (`figma`) applies to `packages/plugin/src/apply/**`. Only `src/main.ts` touches `figma`.

---

<a id="pipeline"></a>
## 5. Apply pipeline

```
open ─► preflight ─► index ─► plan ─► [user review] ─► tokens ─► apply (per component, topo order) ─► verify (per variant) ─► finalize
          RO           RO       RO                       W            W                                     W                 W
```

RO = read-only, W = writes. No stage before `tokens` writes to the document, which makes cancelling before apply free.

<a id="preflight"></a>
### 5.1 Preflight (read-only)

| Check | How | Outcome |
|---|---|---|
| **IR compatibility** | `manifest.irVersion` major ∈ `SUPPORTED_MAJORS`; unknown minors are ignored ([06](06-ir.md#versioning)) | else `APPLY_IR_VERSION_UNSUPPORTED` (error, blocks) |
| **Fonts** | Collect every `FontName` the bundle needs: text runs, plus every mode value of font-family/weight variables ([08](08-tokens.md#edge)). `await figma.listAvailableFontsAsync()` is cached once per session. Resolve each one: (1) exact family+style; (2) a saved mapping (root shared plugin data `figmabook/fontmap`, plus clientStorage for user-level defaults); (3) a style-name normalization table ([07](07-mapping.md#fonts)); (4) `{ family, variationSettings }` for variable fonts (`figma.getFontFamilyVariationAxes`) | missing fonts are listed in the **Fonts** screen; the user maps or accepts the fallback (default Inter of the nearest weight). Emits `FONT_MISSING_IN_FIGMA` (warn) or `FONT_SUBSTITUTED` (info) |
| **Images** | For each asset sha: the registry image map (sha → Figma image hash), then `figma.getImageByHash` | request only the missing ones |
| **Variables / styles** | The full matching procedure of [08 §10](08-tokens.md#matching) | a matching summary for the Tokens tab |
| **Libraries** (components) | If `options.libraryComponents` maps `sid` → published component key (e.g. icons already exist in a team library), resolve with `importComponentByKeyAsync` / `importComponentSetByKeyAsync` | use library components as instance targets ([§10](#nested)) |
| **Pages** | Resolve the target pages by name or registry id; `await page.loadAsync()` | absent pages are recorded in the plan and created at the start of `apply` (the first write stage) |

Fonts: `loadFontAsync` is called **once per unique FontName**, in parallel batches of 16. A failed load marks that font missing.

<a id="index-stage"></a>
### 5.2 Index (read-only)

See [10 §3](10-sync.md#index). For each target page (from the registry plus the default page):

1. `await page.loadAsync()`.
2. `page.findAllWithCriteria({ sharedPluginData: { namespace: 'figmabook', keys: ['nk'] } })`, with `figma.skipInvisibleInstanceChildren = true`.
3. Build the maps `sid → ComponentSetNode`, `(sid, vk) → ComponentNode`, `(sid, vk, nk) → SceneNode`.

Variables are indexed via `getLocalVariablesAsync()` plus their `figmabook/tok` data. `figma.loadAllPagesAsync()` is never called.

### 5.3 Plan (read-only)

`computePlan(index, bundle, registry) → ApplyPlan` ([10 §8](10-sync.md#apply-plan)). It is pure over the index snapshot: it reads node properties to compute `ah` hashes (designer-edit detection) and never writes.

### 5.4 Tokens (write)

These are applied before any node, because node bindings reference variables. The order is:

1. collections
2. modes
3. variables, in topological alias order: **primitives first**, so alias targets exist
4. values per mode
5. scopes and code syntax
6. styles

Each written variable gets `figmabook/tok` and `figmabook/ah`. Library-matched variables are imported (`importVariableByKeyAsync`) and never modified.

### 5.5 Apply (write), per component in topological order

1. **Dependency graph.** Built from Scene IR `instance` nodes ([§10](#nested)) and icon references. Kahn's algorithm gives the order: icons, then leaf components, then composites.
2. **Cycles.** These come from mutual nesting, e.g. a Menu rendering a MenuItem that renders a Menu. They are broken by building the cycle members first with their nested parts as **frames**, emitting `APPLY_INSTANCE_CYCLE` (warn).
3. **Per component** (the unit of atomicity for undo and resume):
   1. Ensure the page and section exist ([§9](#pages)).
   2. Reconcile variants: create missing `ComponentNode`s and update existing ones in place ([10 §5](10-sync.md#reconcile)).
   3. For each variant, apply its node tree with the write rules ([§6](#apply-order)).
   4. Verify the variant ([§11](#verify)) and apply fallbacks.
   5. Ensure the `ComponentSetNode` exists and the variant names are correct ([§7](#sets)).
   6. Reconcile component properties and bindings ([§8](#props)).
   7. Lay out the variants grid and labels ([§7.4](#grid)).
   8. Update the documentation frame ([§9.3](#doc-frame)).
   9. Write the component-level plugin data (`irh`, `ah`, `v`), relaunch data and description.
   10. Call `figma.commitUndo()`.

### 5.6 Finalize (write)

1. Write the root registry, chunked ([10 §2.3](10-sync.md#root-registry)).
2. Write the report summary to root shared plugin data `figmabook/report:*`.
3. Post `done`.
4. `figma.notify('Synced 12 components (3 updated, 1 conflict)', { timeout: 6000 })`.
5. Select the changed sets, with an optional zoom: `figma.viewport.scrollAndZoomIntoView`.

---

<a id="apply-order"></a>
## 6. Node write rules & ordering constraints

The Plugin API is order-sensitive and throws on several invalid sequences (research brief §11 gotchas). The applier writes every node **top-down, pre-order**: parent first, then children in paint order (bottom → top). Within a node, it follows exactly this sequence:

```ts
async function writeNode(port: FigmaPort, s: SceneNode, parent: ChildrenMixin & BaseNode, index: number, existing?: SceneNodeLike) {
  // 0. create (or reuse existing managed node, 10 §5)
  const n = existing ?? create(port, s.kind);                          // createFrame | createText | createRectangle | createNodeFromSvg | instance
  if (!existing) n.setSharedPluginData('figmabook', 'nk', s.nk);       // provisional identity immediately (crash-safe resume, §13)
  // 1. attach FIRST: FILL/ABSOLUTE/constraints require a parent; auto-layout child props require an auto-layout parent
  if (n.parent !== parent || indexOf(n) !== index) parent.insertChild(index, n);
  // 2. defaults hygiene for fresh frames: createFrame() starts at 100×100 with a WHITE fill
  if (!existing && n.type === 'FRAME') { n.fills = []; n.clipsContent = false; }
  // 3. layout mode BEFORE any padding/spacing/align/wrap/grid props
  if (isFrameLike(n)) {
    n.layoutMode = s.layout?.mode ?? 'NONE';
    if (s.layout?.mode === 'GRID') {                                    // S-10
      n.gridRowCount = s.layout.grid.rows.length; n.gridColumnCount = s.layout.grid.cols.length;
      n.gridRowSizes = s.layout.grid.rows; n.gridColumnSizes = s.layout.grid.cols;
      n.gridRowGap = s.layout.grid.rowGap; n.gridColumnGap = s.layout.grid.colGap;
    } else if (s.layout) {
      n.layoutWrap = s.layout.wrap ? 'WRAP' : 'NO_WRAP';                // wrap before counterAxisSpacing/alignContent
      n.itemSpacing = s.layout.itemSpacing ?? 0;
      if (s.layout.wrap) { n.counterAxisSpacing = s.layout.counterSpacing ?? 0; n.counterAxisAlignContent = s.layout.alignContent ?? 'AUTO'; }
      n.primaryAxisAlignItems = s.layout.primaryAlign ?? 'MIN';
      n.counterAxisAlignItems = s.layout.counterAlign ?? 'MIN';
      n.itemReverseZIndex = !!s.layout.reverseZ;
    }
    if (s.layout) {
      [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft] = s.layout.padding;
      n.strokesIncludedInLayout = s.layout.strokesIncludedInLayout;
    }
  }
  // 4. size: resize() forces FIXED on auto-layout axes → do it BEFORE setting HUG/FILL
  if (n.type !== 'TEXT') {
    if (parentIsAutoLayout(parent) || s.layout) n.resize(max(s.w, 0.01), max(s.h, 0.01));
    else n.resizeWithoutConstraints(max(s.w, 0.01), max(s.h, 0.01));   // avoid recursive constraint scaling
  }
  // 5. child-of-parent properties (only now: we are attached)
  if (parentIsAutoLayout(parent)) {
    n.layoutPositioning = s.child.positioning;                         // ABSOLUTE only after append
    if (s.child.positioning === 'ABSOLUTE') { n.x = s.x; n.y = s.y; n.constraints = s.child.constraints ?? { horizontal: 'MIN', vertical: 'MIN' }; }
  } else { n.x = s.x; n.y = s.y; if (s.child.constraints) n.constraints = s.child.constraints; }
  if (s.transform) n.relativeTransform = s.transform;                  // rotation/skew; overrides x/y
  // 6. own sizing modes: HUG valid only on auto-layout frames & text; FILL only inside auto-layout parent
  if (isFrameLike(n) && s.layout) { n.layoutSizingHorizontal = s.child.sizingH; n.layoutSizingVertical = s.child.sizingV; }
  else if (parentIsAutoLayout(parent)) { n.layoutSizingHorizontal = demoteHug(s.child.sizingH); n.layoutSizingVertical = demoteHug(s.child.sizingV); }
  if (s.child.min) { n.minWidth = s.child.min.w ?? null; n.minHeight = s.child.min.h ?? null; }
  if (s.child.max) { n.maxWidth = s.child.max.w ?? null; n.maxHeight = s.child.max.h ?? null; }
  // 7. text content (see §6.1) or SVG/image specifics
  if (n.type === 'TEXT') await writeText(port, n, s.text!);
  // 8. visuals: build NEW arrays (paints/effects are immutable); bind variables on the new objects
  n.fills = bindPaints(port, s.fills, s.bindings, 'fill');
  n.strokes = bindPaints(port, s.strokes?.paints ?? [], s.bindings, 'stroke');
  if (s.strokes) writeStrokeGeometry(n, s.strokes);                    // strokeAlign, per-side weights, dashPattern, cap/join
  writeRadii(n, s.radius);                                             // topLeftRadius… (cornerSmoothing 0)
  n.effects = bindEffects(port, s.effects, s.bindings);
  n.opacity = s.opacity; n.blendMode = s.blendMode ?? 'PASS_THROUGH'; n.visible = s.visible;
  if (isFrameLike(n)) n.clipsContent = s.clip === 'clip';
  if (s.mask) n.isMask = true, (n as any).maskType = s.mask.type;
  // 9. float bindings (padding/gap/radius/size/...) AFTER literals (08 §8)
  for (const b of s.bindings.filter(isNodeFieldBinding)) n.setBoundVariable(b.field, await resolveVar(b.token));
  // 10. name + identity LAST (cheap, and marks the node as fully written)
  n.name = s.name;
  writeIdentity(n, s);                                                 // figmabook/nk, irh, ah, v (10 §2)
  // 11. children (pre-order recursion) happen after this node is complete
}
```

### 6.1 Text sequence

```ts
async function writeText(port, t: TextNode, x: SceneText) {
  // fonts were all loaded in preflight; still guard: setting characters with an unloaded font throws
  t.fontName = x.runs[0].font;                     // base font first (must be loaded)
  t.characters = x.characters;                     // BEFORE ranges: replacing characters drops range styling
  for (const r of x.runs) {                        // per run; skip fields equal to base to minimize overrides
    t.setRangeFontName(r.start, r.end, r.font);
    t.setRangeFontSize(r.start, r.end, r.size);
    t.setRangeLineHeight(r.start, r.end, { value: r.lineHeightPx, unit: 'PIXELS' });     // D-17: never AUTO
    t.setRangeLetterSpacing(r.start, r.end, { value: r.letterSpacingPx, unit: 'PIXELS' });
    t.setRangeFills(r.start, r.end, bindPaints(port, r.fills, r.bindings, 'text'));
    if (r.textCase) t.setRangeTextCase(r.start, r.end, r.textCase);
    if (r.decoration) { t.setRangeTextDecoration(r.start, r.end, r.decoration.line); /* style/color/thickness/offset */ }
    if (r.href) t.setRangeHyperlink(r.start, r.end, { type: 'URL', value: r.href });
    if (r.features) t.setRangeOpenTypeFeatures?.(r.start, r.end, r.features);           // verify name in typings, S-04
    for (const b of r.bindings) t.setRangeBoundVariable(r.start, r.end, b.field, await resolveVar(b.token));
    if (r.textStyleId) await t.setRangeTextStyleIdAsync(r.start, r.end, r.textStyleId);
  }
  t.textAlignHorizontal = x.alignH; t.textAlignVertical = x.alignV;
  if (x.paragraphSpacing) t.paragraphSpacing = x.paragraphSpacing;
  if (x.paragraphIndent) t.paragraphIndent = x.paragraphIndent;
  if (x.leadingTrim) t.leadingTrim = x.leadingTrim;
  if (x.wrapStyle) t.textWrapStyle = x.wrapStyle;              // AUTO | BALANCE | PRETTY (CSS text-wrap)
  // sizing LAST: resize() implies fixed width; autoResize must follow it
  if (x.autoResize === 'WIDTH_AND_HEIGHT') t.textAutoResize = 'WIDTH_AND_HEIGHT';
  else { t.resize(x.w, x.h); t.textAutoResize = x.autoResize; }   // 'HEIGHT' | 'NONE' | 'TRUNCATE'
  if (x.truncation) { t.textTruncation = 'ENDING'; t.maxLines = x.truncation.maxLines; }
}
```

### 6.2 Constraint table

The fake enforces these rules, so tests catch ordering regressions ([§18](#testing)).

| Rule | Figma behaviour if violated | Enforced by |
|---|---|---|
| Padding, spacing and alignment need `layoutMode ≠ NONE` | ignored or throws | step 3 ordering |
| `layoutWrap = WRAP` on GRID | throws | GRID branch skips wrap |
| `layoutSizing* = 'FILL'` needs an auto-layout parent | throws | step 1 attach + step 6 |
| `layoutSizing* = 'HUG'` only on auto-layout frames and text | throws | `demoteHug()` → FIXED for leaves |
| `resize()` on an auto-layout axis forces FIXED | silent sizing change | step 4 precedes step 6 |
| `x`/`y` ignored for auto-layout children unless ABSOLUTE | silent | step 5 |
| `layoutPositioning = 'ABSOLUTE'` needs the node already in an auto-layout parent | throws | step 1 then 5 |
| `characters` / font fields need a loaded font | throws | preflight load + base font first |
| Replacing `characters` drops range styles | silent | characters before ranges |
| Text `resize()` sets fixed width | silent | autoResize after resize |
| Paints, effects and `constraints` are immutable objects | throws on mutate | always new arrays/objects |
| `setBoundVariableForPaint` returns a *new* paint | binding lost | assign the returned paint |
| `combineAsVariants` needs ≥1 component, all on the same page and not inside an instance | throws | [§7.2](#sets) |
| `createComponentFromNode` throws for a node inside a component or instance | throws | not used for variants; only for icon extraction from fresh SVG frames |
| Minimum size 0.01 | throws | `max(·, 0.01)` |
| GRID: tracks cannot be FLEX on an axis where the container is HUG | throws, or the mapper downgrades | mapper emits FIXED or HUG; the applier asserts (S-10) |
| `counterAxisAlignItems = 'BASELINE'` is horizontal-only | throws | the mapper guarantees it; the applier asserts |
| Sync getters (`getNodeById`, `mainComponent` read, `instances`) throw under `dynamic-page` | throws | async variants only (`getNodeByIdAsync`, `getMainComponentAsync`, `getInstancesAsync`) |

### 6.3 Images & SVG

- **Image.** `const img = port.createImage(bytes)`, then use `img.hash`. Paint: `{ type: 'IMAGE', imageHash, scaleMode, imageTransform?, scalingFactor? }`. Capture guarantees PNG/JPEG/GIF at ≤4096px ([05](05-capture.md#images)). The applier asserts this and emits `PAINT_IMAGE_REJECTED` when Figma refuses an image.
- **SVG.** `const f = port.createNodeFromSvg(svgText)` returns a FrameNode wrapper.
  - If the wrapper has a single child and no own visuals, unwrap it: move the child into the parent at the same index, then remove the wrapper.
  - The resulting vector layers are named from the Scene IR (`Icon / chevron-down`).
  - Failure (exception or empty result) builds the Scene's `fallbackRaster` asset as an image rectangle and emits `SVG_IMPORT_FAILED` (warn) (S-09).

---

<a id="sets"></a>
## 7. Components, variants & sets

### 7.1 One `ComponentNode` per variant

Each variant root is a `ComponentNode`, created with `port.createComponent()` and written with the frame rules of §6. Components are not created with `createComponentFromNode`, because building directly into the component avoids a conversion step and keeps node IDs stable.

The variant name is the canonical axis string `Prop=Value, Prop2=Value2`. Axis order comes from the Scene IR (`component.axes[]`). Values are escaped: `=` and `,` are replaced with `＝` and `，`, and the original is kept in plugin data.

### 7.2 Creating and evolving the set

| Situation | API sequence |
|---|---|
| **First build** | Create all variant components as children of the target section, then `const set = port.combineAsVariants(components, section)`. Name it with `set.name = component.name`. **Empty sets are impossible**: never call this with 0 nodes |
| **Add a variant later** | `const c = port.createComponent(); set.appendChild(c); c.name = 'Size=lg, State=Hover'`, then write its tree. Appending a ComponentNode into a ComponentSetNode is expected to work (verify, S-02). Fallback: create on the page, then `combineAsVariants([...set.children, c], parent)`. That creates a *new* set, which breaks instance links, so it must **not** be used if S-02 refutes the expectation; instead report `APPLY_VARIANT_ADD_FAILED` |
| **Remove a variant** | It is a [10 §7](10-sync.md#deprecation) decision. Default: keep it, rename it to `…, Deprecated=true`, and move it to the end. Hard `c.remove()` only when the policy allows it and no local instances exist (`await c.getInstancesAsync()` is empty) |
| **Add an axis** | `set.addComponentProperty('Theme', 'VARIANT', 'Light')` gives every existing variant `Theme=Light`. Then rename the new variants |
| **Remove an axis** | First deprecate or remove the variants that become duplicates. Then rename all variants without the axis. Collisions must not exist at any intermediate step: rename to temporary unique names first (`__tmp<i>`), then to the finals |
| **Rename an axis** | `set.editComponentProperty('Size', { name: 'Scale' })` for VARIANT. Instances keep their values (verify, S-02) |
| **Rename a value** | Rename each affected variant (`c.name = …`) |
| **Reorder axes** | Rename all variants with the new axis order. This doesn't change properties (verify, S-02) |

### 7.3 Default variant

Figma's default variant is the **top-left-most** child (research brief §2). The grid layout below always places the variant whose args equal the story's default args (Scene IR `component.defaultVk`) at row 0, column 0.

<a id="grid"></a>
### 7.4 Variant grid & labels

The set has no auto layout (`layoutMode = 'NONE'`). Variants are positioned explicitly, so a grid with labels outside it can align exactly.

```
columns = values of axis[0]  (default: the axis with most values ≤ 8, else the first axis)  — configurable `layout.columns`
rows    = cartesian product of remaining axes, ordered by axis order then value order; default value first
cellW[c] = max width of variants in column c; cellH[r] = max height in row r
x = PAD + Σ_{i<c} (cellW[i] + GAP);  y = PAD + Σ_{j<r} (cellH[j] + GAP)     // GAP = 24, PAD = 24 (config)
variant positioned top-left inside its cell
set.resizeWithoutConstraints(totalW + PAD, totalH + PAD)
```

- **Labels** are TEXT nodes (Inter 11, secondary color) placed in the *section*, outside the set: column labels above, row labels to the left. They are managed nodes with `nk = 'label/col/<i>'` or `'label/row/<j>'`.
- **Very large sets.** Beyond `layout.maxColumns × maxRows`, the axes are wrapped into multiple *pages* of the grid, purely visually (same set).
- **Set styling.** The set keeps Figma's default dashed purple stroke. Our padding is part of the set's size.

---

<a id="props"></a>
## 8. Component properties

Arg classification happens in the planner ([04](04-variant-model.md#classification)). The Scene IR carries the result:

```ts
interface SceneProperty {
  arg: string;                                   // Storybook arg name
  type: 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'SLOT';
  displayName: string;                           // "Show icon"
  default: boolean | string | { sid: string; vk?: string };   // INSTANCE_SWAP default target
  preferred?: { sid: string; vk?: string }[];    // INSTANCE_SWAP / SLOT preferred values
  bindings: { vk: string; nk: string; field: 'visible' | 'characters' | 'mainComponent' | 'slot' }[];
  description?: string;
}
```

### 8.1 Define on the set, bind in every variant

```ts
const ids = readJSON(set, 'figmabook', 'props') as Record<string /*arg*/, string /*Figma property name incl. #id*/>;
for (const p of scene.properties) {
  let name = ids[p.arg];
  if (!name || !(name in set.componentPropertyDefinitions)) {
    name = set.addComponentProperty(p.displayName, p.type, await defaultValue(p), propOptions(p));  // returns "Show icon#12:3"
    ids[p.arg] = name;                                                        // PERSIST: the #id suffix is the identity
  } else {
    // keep the id; only edit what changed (display name changes are safe: we key by arg, not by name)
    const def = set.componentPropertyDefinitions[name];
    const patch = diffProp(def, p);
    if (patch) ids[p.arg] = set.editComponentProperty(name, patch);           // returns the (possibly new) name string
  }
}
writeJSON(set, 'figmabook', 'props', ids);
// bind
for (const p of scene.properties) for (const b of p.bindings) {
  const node = index.node(scene.sid, b.vk, b.nk);
  const refs = { ...(node.componentPropertyReferences ?? {}) };
  refs[b.field === 'slot' ? 'mainComponent' : b.field] = ids[p.arg];
  node.componentPropertyReferences = refs;
}
```

Rules:

- **TEXT.** Bind `characters` on the TEXT node (`nk` aligned across variants, [07](07-mapping.md#alignment)). Default = the story's initial arg value.
- **BOOLEAN.** Bind `visible` on every toggled node. The variant tree must contain the node in *all* variants. The mapper guarantees this by emitting a hidden node (`visible:false`) where the arg is false ([04](04-variant-model.md#classification)).
- **INSTANCE_SWAP.** The node must be an INSTANCE. Bind `mainComponent`. The default value is the target component's **node id** (`addComponentProperty(name, 'INSTANCE_SWAP', comp.id, { preferredValues: [{ type: 'COMPONENT', key: comp.key }, …] })`). Preferred values need component **keys**, which exist for local components too (verify, S-13).
- **SLOT.** In the variant component, the slot content region becomes a slot via `component.createSlot()`, populated with the story's default content as children, and governed by `SlotSettings { minChildren, maxChildren, allowPreferredValuesOnly }`. The exact sequence for creating a SLOT property and binding it is new API surface (typings 1.142.0) (verify, S-13). Until verified, SLOT args degrade to FIXED content, with `APPLY_SLOT_UNSUPPORTED` (info).
- **Property ids are never renamed by deletion and re-creation** ([10 §6](10-sync.md#prop-renames)). A display name change uses `editComponentProperty`, which keeps instance values (verify, S-02).
- **Removed args.** `deleteComponentProperty(name)` is used only when the arg is gone from code *and* the policy allows it. Default: keep the property and append `(deprecated)` to its name. This is non-breaking.

---

<a id="pages"></a>
## 9. Pages, sections & documentation frames

### 9.1 Layout (D-22)

```
Page "Components"                        (config: pages.components)
 ├─ Section "Inputs"                     (top-level title segment; nested segments → sub-sections, depth ≤ 2)
 │   ├─ Frame "Button · docs"            (documentation frame, managed, regenerated)
 │   ├─ Text labels (col/row)
 │   └─ ComponentSet "Button"
 │   …
Page "Icons"                             (extracted icon components, §10.3)
Page "Deprecated"                        (moved deprecated sets, 10 §7)
```

- **Sections.** Created with `port.createSection()`. A section's position persists after first placement: we never move a section the user has moved. Its position is stored only on creation. New sections are placed to the right of the existing bounding box.
- **Within a section**, components flow top-to-bottom in title order. Each block (doc frame + labels + set) is placed with 120px spacing. A block is moved only on first creation, or when the user hasn't moved it (`ah` of position).
- **Page switching.** `await figma.setCurrentPageAsync(page)` is called only when the user asks to "show". Writes don't need the current page.

### 9.2 Descriptions, links, relaunch

- `set.description` holds the docgen description in plain text. `descriptionMarkdown` is used where supported (verify, S-06).
- `set.documentationLinks = [{ uri: storyUrl }]` links to the Storybook docs or story page (verify settable and the count limit, S-06).
- `set.setRelaunchData({ resync: `Re-sync ${name} from Storybook`, inspect: '' })`.
- Each **variant** component's `description` gets a short args summary (`variant: primary · size: md · state: hover`) plus a story link. This helps Dev Mode users.

<a id="doc-frame"></a>
### 9.3 Documentation frame

The documentation frame is a managed frame (vertical auto layout, 24px padding, fixed width 480), regenerated each sync. It holds no overrides, so in-place recreation of its *children* is allowed. Contents:

1. Title (component display name) and a breadcrumb (title path).
2. Description, docgen Markdown rendered as plain text with bold and code runs.
3. "Open in Storybook" link (`setRangeHyperlink`).
4. Properties table: rows of *name · type · values · default*, generated from Scene `axes` + `properties`.
5. Mode preview row, when variable modes exist: one instance of the default variant per mode, each wrapped in a frame with `setExplicitVariableModeForCollection` ([08 §7.3](08-tokens.md#modes)).
6. Footer: "Managed by figmabook · source `<storybook fingerprint>` · synced `<ISO time>` · do not edit layers inside the set; add annotations outside or use unmanaged layers ([10 §9](10-sync.md#designer-edits))".
7. Diagnostics badge: counts of warn/error for this component. Clicking it opens the report.

Toggles: `docs.enabled`, `docs.sections[]`.

---

<a id="nested"></a>
## 10. Nested instances & icons

### 10.1 Scene IR instance node

```ts
interface SceneInstanceNode extends SceneNodeBase {
  kind: 'instance';
  target: { sid: string; vk?: string; variant?: Record<string, string> /* axis → value */ };
  properties?: Record<string /*arg*/, boolean | string | { sid: string }>;   // mapped via target's props map
  expect: Rect;                          // captured rect (local) for verification
  fallback: SceneNode;                   // full frame subtree, built if instance cannot be verified
  overrides?: SceneOverride[];           // allowed literal overrides (e.g. text not covered by a TEXT prop) — max 8
}
```

### 10.2 Apply

1. **Resolve the main component.**
   - Exact match: `index.variant(target.sid, target.vk)`.
   - Otherwise, find the variant whose `variantProperties` equal `target.variant`.
   - If the target is a library component: `importComponentByKeyAsync`.
   - Missing: build the `fallback`, and emit `APPLY_INSTANCE_TARGET_MISSING` (warn).
2. **Create or reuse the instance.**
   - Create: `const inst = main.createInstance()`, insert it at its index, then apply the child-of-parent properties (§6 step 5–6).
   - Reuse with a changed target: `inst.swapComponent(main)`, which **preserves overrides**. Never assign `inst.mainComponent` (research brief §2).
3. **Set properties:** `inst.setProperties({ [propsMap[arg]]: value, [axis]: value })`. Use the *target's* stored `figmabook/props` map to translate arg → `Name#id`.
4. **Overrides.** Apply the allowed literal overrides (e.g. a text that isn't a TEXT property). Each one is a diagnostic `APPLY_INSTANCE_OVERRIDE` (info), so authors can add TEXT props.
5. **Verify.** Read `inst.absoluteBoundingBox` relative to the variant root and compare it to `expect` (tolerance 1px). Optionally, in fidelity mode, compare visually. On mismatch: remove the instance, build `fallback`, and emit `APPLY_INSTANCE_MISMATCH` (warn, with Δ). The planner learns from this in the next run (cached negative match).

<a id="icons"></a>
### 10.3 Icons page & INSTANCE_SWAP

- **Icon components.** The mapper extracts repeated SVGs ([07](07-mapping.md#icons)) and icon args into **icon components**, with `sid = icon:<name|sha8>`. They are built first, on the "Icons" page, in a Section grid of 24px cells. Each is a `ComponentNode` (not a set), whose content is the unwrapped `createNodeFromSvg` vectors.
- **Recoloring.** The vectors' fills are bound to a COLOR *variable* if one is token-provenanced. Otherwise they are literal, and the mapper marks `iconColor: 'currentColor'`: inside consuming components, the instance gets a fill override equal to the resolved `color`.
- **INSTANCE_SWAP properties** use the icon components' ids and keys for `default` and `preferredValues`.

---

<a id="verify"></a>
## 11. Read-back verification & fallback

Figma lays out synchronously, so reads right after writes are valid. To avoid forcing layout repeatedly, verification runs **once per variant, after the whole variant tree is written** (D-15).

```ts
async function verifyVariant(root: ComponentNode, scene: SceneVariant, tol = 1): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  for (let pass = 0; pass < 3; pass++) {                              // bounded fix-point
    const bad = new Map<string, number>();                           // container nk → max child Δ
    const origin = root.absoluteBoundingBox!;
    for (const s of walk(scene.root)) {
      const n = index.node(scene.vk, s.nk); if (!n || !s.expect) continue;
      const bb = n.absoluteBoundingBox!;                              // rotation-aware AABB; compare to expect AABB
      const d = maxDelta(rel(bb, origin), s.expectAbs);
      if (d > tol && s.parentNk) bad.set(s.parentNk, Math.max(bad.get(s.parentNk) ?? 0, d));
      if (s.kind === 'text') checkTextLines(n as TextNode, s, out);   // §11.1
    }
    if (bad.size === 0) break;
    // fix deepest offending containers first (children before parents)
    for (const nk of [...bad.keys()].sort(byDepthDesc)) out.push(...relaxOrFallback(index.node(scene.vk, nk) as FrameNode, sceneNode(nk)));
  }
  return out;
}
```

`relaxOrFallback(container)` tries the following in order, re-measuring after each, and stops at the first that passes:

1. **Relax child sizing.** HUG → FIXED, then FILL → FIXED for children whose own size mismatched. Emit `LAYOUT_RELAXED_FIXED` (info).
2. **Text width buffer** for text children that wrapped differently ([§11.1](#text-check)).
3. **Absolute fallback (container).**
   1. `container.layoutMode = 'NONE'`. Children keep their current, wrong positions.
   2. Then, for each child, set `x`/`y` and `resizeWithoutConstraints(w, h)` from `scene.fallback.children[nk]`.
   3. The container gets `resizeWithoutConstraints(expect.w, expect.h)`.
   4. Emit `LAYOUT_READBACK_FALLBACK` (warn) with `{ maxDelta, reason }`. The planner records this, so the mapper can learn which patterns fail (S-06/S-10 corpus).

A fallback never touches ancestors. The container's outer size is forced to `expect`, so the ancestors' layout is unchanged.

<a id="text-check"></a>
### 11.1 Text line parity (D-17)

```ts
function checkTextLines(t: TextNode, s: SceneTextNode, out: Diagnostic[]) {
  const lines = Math.round(t.height / s.text.lineHeightPx);
  if (lines === s.text.lineCount) return;
  if (lines > s.text.lineCount && t.textAutoResize !== 'WIDTH_AND_HEIGHT') {
    const buf = Math.min(s.text.maxWidthBuffer ?? 6, Math.ceil(t.width * 0.03));   // S-04 calibrates
    if (canWiden(t)) {                     // FIXED width (or FILL in a container that has slack)
      t.resize(t.width + buf, t.height); t.textAutoResize = 'HEIGHT';
      if (Math.round(t.height / s.text.lineHeightPx) === s.text.lineCount) { out.push(diag('TEXT_WIDTH_BUFFERED', s, { buf })); return; }
      t.resize(t.width - buf, t.height); t.textAutoResize = 'HEIGHT';               // revert
    }
  }
  out.push(diag('TEXT_LINE_MISMATCH', s, { figma: lines, browser: s.text.lineCount }));  // warn; suggests locked-lines mode
}
```

In `locked-lines` mode, the mapper has already inserted U+2028 at the browser's break points. A mismatch is then rare: it means glyph widths differ more than the line-box slack, which is usually a font substitution.

---

<a id="schedule"></a>
## 12. Scheduling: time slicing, progress, cancel, undo

The main thread shares the editor's thread. Figma guidelines reject plugins that degrade editor performance ([13](13-security-legal.md#publishing)).

```ts
class Slicer {
  private t0 = Date.now();
  constructor(private budgetMs = 12) {}
  async tick() {                                        // call between work units (node writes, chunk parses)
    if (Date.now() - this.t0 < this.budgetMs) return;
    await yieldToEditor(); this.t0 = Date.now();
    if (cancelRequested) throw new Cancelled();
  }
}
const yieldToEditor = () => typeof setTimeout === 'function'
  ? new Promise<void>(r => setTimeout(r, 0))            // availability in the sandbox: verify, S-06
  : uiRoundTrip();                                      // fallback: 'ping' → UI → 'pong'
```

- **Budget.** 12ms of work per slice (configurable 8–16). S-06 measures the editor frame impact.
- **Progress.**
  - `progress` messages go out at most every 100ms.
  - `etaMs` is an exponential moving average of per-variant apply time × remaining variants.
  - Stage names map to the UI progress screen ([11](11-ux.md#plugin)).
- **Cancel.**
  - Checked in every `tick()`.
  - **Atomic unit = one variant**: when cancel arrives mid-variant, finish writing that variant's tree, skip its verification, and mark it `status: 'partial'`.
  - The component's `irh` is **not** updated, so the next sync re-applies it ([§13](#resume)).
  - Emit `APPLY_CANCELLED` (info).
- **Undo.**
  - `figma.commitUndo()` after each component, so the user can step back one component at a time.
  - Token writes are committed as their own undo step.
  - Note: very large syncs create many undo steps. Option `undo: 'single'` commits once at the end. Memory impact: verify, S-06.

---

<a id="resume"></a>
## 13. Error recovery & resume

- **Per-component try/catch.** On an exception:
  - emit `APPLY_COMPONENT_FAILED` (error), with the stack and the last node `nk`;
  - leave the already-written nodes in place (they carry `nk`);
  - **don't** update the component `irh`, and set the registry entry `status: 'failed'`;
  - continue with the next component, unless the failure is `fatal` (e.g. out of memory).
- **Resume is natural.** Reconciliation is keyed and idempotent ([10 §5](10-sync.md#reconcile)), so re-running the sync completes partial components without duplicates.
- **Registry consistency.** The registry is written last. On a crash before finalize, the next run rebuilds the index from node plugin data (source of truth), then repairs the registry (`SYNC_REGISTRY_REPAIRED`, info).
- **Orphan creations.** Freshly created nodes get a provisional `figmabook/nk` right after creation (step 0), before attributes or children are written. Step 10 then writes the full identity record. An interrupted node is therefore found by the index and reconciled, never duplicated. A node with `nk` but without `irh` is known to be incomplete and is always rewritten.

---

<a id="fidelity"></a>
## 14. Fidelity export mode

Fidelity export is used by the harness ([12](12-quality.md#fidelity)) and on demand ("Check fidelity" in the report).

1. For each variant in scope:
   - `await variant.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 }, useAbsoluteBounds: true })` (verify option name, S-06);
   - collect `{ nk, absoluteBoundingBox }` for every managed descendant.
2. Throttle to one export in flight at a time. Yield between exports.
3. Post `export.png` with the bytes and boxes. The UI POSTs them to the local server's `/v1/fidelity` (topology A), or bundles them into a downloadable zip (file mode).
4. The CLI's `fidelity` tool scores them against the Playwright screenshots (SSIM, pixelmatch, box deltas). The score is shown back in the report, and optionally written onto the set as `figmabook/fid` (score + timestamp).

Harness mode (`options.auto = true`, set only by the CLI in a dev build) skips the review screen, applies, exports, and closes with `figma.closePlugin()`.

---

<a id="perf"></a>
## 15. Performance tactics

| Tactic | Why |
|---|---|
| `figma.skipInvisibleInstanceChildren = true` before indexing | `findAllWithCriteria` up to hundreds of times faster (Figma docs) |
| Index once per session with `findAllWithCriteria({ sharedPluginData })`, and never `findAll` with predicates | O(managed nodes) instead of O(document) |
| Never `figma.loadAllPagesAsync()`; only `page.loadAsync()` for target pages | loading all pages is slow on big files |
| Write-only passes; one read pass per variant for verification | interleaved reads force layout |
| `resizeWithoutConstraints` outside auto layout | avoids recursive constraint scaling |
| Merkle skip: unchanged `irh` → no writes for that subtree ([10 §10](10-sync.md#merkle)) | a no-op re-sync costs 0 writes (metric in README §4) |
| Fonts loaded once, images created once (sha → hash map in the registry) | avoids repeated decode and upload |
| Build directly on the target page | cross-page moves are expensive |
| Plugin-data writes only for keys whose value changed (`irh`/`ah` usually change together, `nk`/`v` rarely) ([10 §2](10-sync.md#keys)) | fewer API calls on updates |
| Skip unchanged property writes in update mode (compare the current value to the target before assigning) | each assignment can trigger relayout and override bookkeeping |
| Large sets: warn when a set has more than 500 variants (`APPLY_SET_LARGE`, info). Hard cap from planner budgets ([04](04-variant-model.md#budgets)) | Figma editor performance degrades with huge sets (verify, S-06) |

S-06 targets (README §4): 20-node variant ≤60ms; 1,000 variants ≤3 min; no editor stall above 100ms.

---

<a id="use-figma"></a>
## 16. The `use_figma` alternative path (experimental, S-11)

Figma's remote MCP server tool `use_figma` runs Plugin API code against a file server-side (beta, Mar 2026; <https://developers.figma.com/docs/figma-mcp-server/write-to-canvas>).

The applier is pure over `FigmaPort`, so the same code can run there:

- **Build target `plugin/dist/applier.mjs`.** A standalone module, with no UI and no messaging, that exports `applyBundleSlice(port, sceneComponentsJSON, tokensJSON, options)`.
- **Driver.** The CLI command `figmabook mcp` (or an agent) sends slices: one component per call, because output is limited to 48 KB per call and the input limits are unknown (verify, S-11).
- **Images can't be added by `use_figma` itself.** Image-bearing nodes are uploaded with the server's `upload_assets` tool first and referenced by hash. If that is unavailable, they degrade to their vector or empty fallback, with `APPLY_IMAGE_SKIPPED` (warn).
- **Fonts.** Only fonts uploaded to the account are available, not local ones. Preflight runs first, and missing fonts fail fast.
- **Uses:** (1) CI fidelity harness without a desktop runner; (2) agent-driven "sync component X". **It is not the product path** until S-11 proves limits, cost and stability.

---

<a id="diagnostics"></a>
## 17. Diagnostics

These are coined in this chapter. The catalog is in [12](12-quality.md#diagnostics).

| Code | Severity | Meaning |
|---|---|---|
| `APPLY_IR_VERSION_UNSUPPORTED` | error | bundle IR major not supported by this plugin version |
| `APPLY_COMPONENT_FAILED` | error | exception while applying a component; partial state left for resume |
| `APPLY_CANCELLED` | info | user cancelled; components marked partial |
| `APPLY_VARIANT_ADD_FAILED` | error | could not append a variant to an existing set without breaking links |
| `APPLY_VARIANT_NAME_COLLISION` | error | two variants resolve to the same `Prop=Value` string |
| `APPLY_SET_LARGE` | info | more than 500 variants in a set |
| `APPLY_PROPERTY_BIND_FAILED` | warn | `componentPropertyReferences` assignment rejected (type or node mismatch) |
| `APPLY_SLOT_UNSUPPORTED` | info | SLOT property degraded to fixed content |
| `APPLY_INSTANCE_TARGET_MISSING` | warn | nested component target not found; fallback frame built |
| `APPLY_INSTANCE_MISMATCH` | warn | instance geometry differs from the capture beyond tolerance; fallback frame built |
| `APPLY_INSTANCE_OVERRIDE` | info | literal override applied on an instance (suggests adding a TEXT/BOOLEAN prop) |
| `APPLY_INSTANCE_CYCLE` | warn | cyclic nesting broken with frames |
| `APPLY_IMAGE_SKIPPED` | warn | image not applied (use_figma path or upload failure) |
| `PAINT_IMAGE_REJECTED` | warn | `createImage` refused the bytes (format or size) |
| `SVG_IMPORT_FAILED` | warn | `createNodeFromSvg` failed; raster fallback used |
| `FONT_MISSING_IN_FIGMA` | warn | required font not available; fallback applied |
| `FONT_SUBSTITUTED` | info | font mapped via user or saved mapping |
| `LAYOUT_RELAXED_FIXED` | info | HUG/FILL relaxed to FIXED to pass verification |
| `LAYOUT_READBACK_FALLBACK` | warn | container converted to absolute positioning after read-back failure |
| `TEXT_WIDTH_BUFFERED` | info | text box widened by ≤ buffer to match the browser's line count |
| `TEXT_LINE_MISMATCH` | warn | Figma line count ≠ browser line count after buffering |
| `NET_SERVER_UNREACHABLE` | warn | local server not reachable (not running, or LNA-blocked) |
| `NET_PAIRING_FAILED` | error | pairing code rejected or expired |
| `NET_BUNDLE_INTEGRITY` | error | component sha256 mismatch on transfer |

---

<a id="testing"></a>
## 18. Testing the plugin

The overall strategy is in [12](12-quality.md#pyramid).

- **Unit tests** (Vitest, Node): `apply/**` runs against `figma-fake`. The fake:
  - implements `FigmaPort` structurally (same typings);
  - **enforces every row of the §6.2 constraint table** by throwing the same error class Figma throws;
  - records an operation log;
  - lays out auto-layout and grid via `layout-sim` ([07](07-mapping.md#verification)), so read-back verification is exercised.
- **Snapshot tests.**
  - Scene IR fixture → apply → serialize the fake document (types, names, layout props, plugin data, property definitions).
  - Re-apply the same bundle → the operation log must be **empty**: the no-op re-sync invariant.
- **Order-constraint fuzzing.** Shuffle independent property writes in the applier's internal plan (where allowed) and assert that the fake never throws.
- **Protocol tests.** UI ↔ main message contracts with a mocked `figma.ui`. Chunk reassembly; cancellation mid-transfer.
- **Real Figma (nightly).** The fidelity harness on the desktop app ([12](12-quality.md#harness)), plus the S-02 override suite ([10 §12](10-sync.md#test-suite)).

---

## 19. Open questions / spikes

1. **S-01:** loopback fetch/WS from the plugin UI under Chrome LNA in browser vs desktop; `127.0.0.1` vs `localhost` in `allowedDomains`; port wildcard support.
2. **S-02:** `set.appendChild(component)` preserving links; `editComponentProperty` rename preserving instance values; variant axis reorder/rename effects.
3. **S-06:**
   - `setTimeout` availability in the sandbox;
   - the postMessage practical size ceiling;
   - undo memory with many `commitUndo`s;
   - `exportAsync` options;
   - `documentationLinks` / `descriptionMarkdown` writability;
   - editor stall measurements;
   - large-set behaviour.
4. **S-09:** `createNodeFromSvg` failure modes on real icon sets; unwrap rules.
5. **S-10:** grid track/HUG/FLEX combinations accepted by the API; `setGridChildPosition` vs auto flow.
6. **S-11:** `use_figma` input/output limits, `upload_assets` interplay, cost.
7. **S-13:** SLOT property creation and binding sequence; `preferredValues` with local component keys; instance verification tolerance.
