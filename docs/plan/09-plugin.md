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
  "name": "Holotype",
  "id": "<generated once by Figma, then fixed forever>",
  "api": "1.0.0",
  "main": "build/main.js",
  "ui": "build/ui.js",                         // create-figma-plugin's showUI() helper wraps it in HTML
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",            // required for new plugins → async APIs only (D-06)
  "enablePrivatePluginApi": true,              // figma.fileKey for dev and private-org builds (D-53)
  "networkAccess": {
    "allowedDomains": [                        // loopback only; registry domains are added when the registry ships (hardening)
      "http://127.0.0.1:47321", "http://127.0.0.1:47322", "http://127.0.0.1:47323",   // D-25 local CLI server
      "ws://127.0.0.1:47321",   "ws://127.0.0.1:47322",   "ws://127.0.0.1:47323"
    ],
    "devAllowedDomains": ["http://localhost:47321", "ws://localhost:47321"],
    "reasoning": "Connects only to the Holotype CLI on your own computer (127.0.0.1) to receive component data exported from your Storybook. It also sends design change requests you submit (layer data and images from this file) to that CLI. Nothing goes to the internet."
  },
  "permissions": ["teamlibrary"],              // library variable/style/component matching (08 §10)
  "relaunchButtons": [
    { "command": "resync",  "name": "Re-sync from Storybook", "multipleSelection": true },
    { "command": "review",  "name": "Review changes" },
    { "command": "details", "name": "Details" },
    { "command": "open",    "name": "Open in Storybook" }
  ]
}
```

Notes:

- **`figma.fileKey`** exists only with `enablePrivatePluginApi`, in dev and private-org builds. A Community build has no `fileKey` and uses `branch:meta.fileId` instead ([§20.1](#branch-identity), D-53).
- **Community review.** Loopback entries in `allowedDomains` are justified by `reasoning` ([13 §7](13-security-legal.md#publishing)). S-01 confirms.

- **Ports.** Every port is listed explicitly; port wildcards are not documented (verify, S-01). `127.0.0.1` is preferred over `localhost`, because it avoids IPv6/`::1` resolution differences (verify, S-01). If Chrome's Local Network Access permission ("Apps on device", Chrome 142+) blocks loopback in the browser app, the UI detects it ([§3.4](#connect)) and steers the user to the desktop app or to file import (D-10).
- **Distribution (D-39).** The same manifest is imported as a development plugin now and published as a private organization plugin later; Community only after M8 ([13](13-security-legal.md#publishing); install steps in [11 §2.0](11-ux.md#install)).
- **No `"*"` entry.** A wildcard would show "unrestricted network access" to every user, and on a later Community listing ([13](13-security-legal.md#publishing)).
- **No registry domain yet.** Until the bundle registry ships (hardening), CI output reaches Figma as a downloaded `.holotype.zip` (file import, D-10). Self-hosted registries will go through file import, or through a CORS-enabled proxy on the registry domain ([02](02-architecture.md#topologies)).
- **Relaunch commands.** `setRelaunchData` is set on every managed component set and on the documentation frame ([§9](#doc-frame)). Library sets get `resync`, `open` and `details`; branch files get `review` and `details`. `resync` re-runs the pipeline scoped to the selected sets' `sid`s. An unpaired Re-sync opens an explanation, not an error. `details` opens the Inspector ([§20.4](#inspector)).

---

<a id="protocol"></a>
## 3. Process model & message protocol

### 3.1 Two contexts

| Context | Has | Used for |
|---|---|---|
| **UI iframe** (`showUI({ width: 420, height: 640, themeColors: true }, data)` from `@create-figma-plugin/utilities`, not `figma.showUI(__html__)`), Preact | full browser APIs, `fetch`/`WebSocket`, File API, `null` origin | pairing, transport (HTTP/WS or file), unzip, asset fetching, every screen ([11](11-ux.md#plugin)) |
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
  | { t: 'branch.link'; meta: BranchMeta }                                    // proposal mode: write branch:meta (§20)
  | { t: 'changes.request' }                                                  // live Changes list, ah sub-hash diff (§20.2)
  | { t: 'snapshot.request'; scope: DcrScope }                                // read-back for the DCR extractor (§20.3)
  | { t: 'branch.meta.patch'; patch: Partial<Pick<BranchMeta, 'status' | 'lastDcr' | 'excluded' | 'approval' | 'answers'>> }
  | { t: 'request.write'; chunks: string[] }                                  // Submit: root request:0..n (§20.3, D-49)
  | { t: 'version.save'; title: string }                                      // Submit: saveVersionHistoryAsync (§20.3, D-48)
  | { t: 'devstatus.set'; nodeIds: string[] }                                 // Ready for dev on top-level screens (§20.3)
  | { t: 'inspect.selection' }                                                // Inspector, on the `details` relaunch (§20.4)
  | { t: 'pong'; id: number };                                                // yield round-trip (§12)

type MainToUi =
  | { t: 'ready'; pluginVersion: string; irMajors: number[]; fileKey: string | null; registry: RegistrySummary | null;
      mode: 'library' | 'proposal' | 'copied-branch' }                       // §20.1
  | { t: 'need'; unit: UnitRef }                                              // pull next component/asset/tokens
  | { t: 'preflight'; fonts: FontPreflight; images: { missing: string[] }; libraries: LibraryMatchSummary }
  | { t: 'plan'; plan: ApplyPlan }                                            // 10 §8
  | { t: 'progress'; stage: Stage; done: number; total: number; current?: string; etaMs?: number }
  | { t: 'diagnostics'; items: Diagnostic[] }                                 // streamed, batched ≤200 per message
  | { t: 'export.png'; vk: string; bytes: Uint8Array; boxes: NodeBox[] }      // fidelity mode
  | { t: 'done'; summary: ApplySummary }
  | { t: 'error'; code: string; message: string; recoverable: boolean }
  | { t: 'changes'; items: ChangeSummary[] }                                  // §20.2
  | { t: 'snapshot'; json: string; part: number; parts: number }              // FigmaSnapshot, split ≤ 1 MB (§20.3)
  | { t: 'version.saved'; id: string | null }                                 // reply to version.save; null = not saved
  | { t: 'inspect.result'; info: InspectInfo }                                // on selectionchange and inspect.selection (§20.4)
  | { t: 'ping'; id: number };

type UnitRef =
  | { kind: 'tokens' }
  | { kind: 'component'; sid: string }
  | { kind: 'asset'; sha256: string };

type TransferUnit =
  | { kind: 'tokens'; json: string }                                          // TokensDoc (06 §4.3)
  | { kind: 'component'; sid: string; json: string; part: number; parts: number } // SceneComponent, split ≤ 1 MB
  | { kind: 'asset'; sha256: string; mime: string; bytes: Uint8Array };

type Stage = 'preflight' | 'index' | 'plan' | 'tokens' | 'apply' | 'verify' | 'finalize' | 'export';
```

Transfer rules:

- **JSON as strings.** Components go over as JSON *strings*, not objects. A string is one structured-clone allocation, and main parses it with `JSON.parse` once all parts have arrived.
- **Part size.** Parts are at most 1 MB. That size is untested, so S-06 finds the real ceiling (verify, S-06).
- **Assets** are sent once per `sha256`. Main first checks the registry's image map ([10](10-sync.md#root-registry)) and asks only for images whose hash is unknown, or whose `figma.getImageByHash(hash)` returns `null`.
- **Integrity.** The UI verifies each component file's checksum against `manifest.integrity.files[file]` ([06](06-ir.md#bundlemanifest)) before sending it, which catches corrupt downloads.

This union is the canonical main↔UI protocol (D-52); [02 §4.5](02-architecture.md#protocol) only summarizes it.

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

**Hardening (topology A).** The Loop slice uses Import file only (step 5, D-10). The server side of this exchange is specified in [02 §4](02-architecture.md#protocol).

1. **Probe** per [02 §3](02-architecture.md#lna), which also owns the error classification.
2. **Pair** per [02 §4.2](02-architecture.md#pairing). The CLI prints a 6-digit code; the UI calls `POST /v1/pair/start`, then `POST /v1/pair/confirm`. The token is stored in clientStorage under `holotype.session.<serverId>`. clientStorage is reachable from main only, so main stores it on the UI's request.
3. **Transport.** HTTP requests use `Authorization: Bearer <token>`. Progress streams over `ws://127.0.0.1:<port>/v1/ws`, with the token sent as the first message, never in a URL. Fallback: `GET /v1/events?after=<seq>`.
4. **Errors.**
   - The UI shows the code that 02 §3 assigns (`NET_SERVER_UNREACHABLE`, `NET_LNA_BLOCKED`, `NET_DOMAIN_NOT_ALLOWED`) with its steps. The copy is client-aware: the desktop app never shows LNA text, only "Holotype isn't running on this computer".
   - A file-import button is always visible.
   - **Proposal mode** (branch files): the connection state is a passive chip ("Not connected to Holotype CLI · not needed to review or submit") and never blocks. A connection error shows only when the user starts an action that needs the server ([11 §6.14](11-ux.md#changes)).
5. **File mode.** Drag a `.holotype.zip` or pick a directory with `webkitdirectory`. Unzip with `fflate` in the UI. No network.

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
  | 'getStyleByIdAsync' | 'getFontFamilyVariationAxes' | 'createComponentFromNode' | 'util'
> & {
  variables: Pick<VariablesAPI,
    | 'createVariableCollection' | 'createVariable' | 'createVariableAlias' | 'getLocalVariablesAsync'
    | 'getLocalVariableCollectionsAsync' | 'getVariableByIdAsync' | 'importVariableByKeyAsync'
    | 'setBoundVariableForPaint' | 'setBoundVariableForEffect'>;
  teamLibrary: Pick<TeamLibraryAPI,
    'getAvailableLibraryVariableCollectionsAsync' | 'getVariablesInLibraryCollectionAsync'>;
  clientStorage: Pick<ClientStorageAPI, 'getAsync' | 'setAsync'>;
};

// members used only by src/main.ts (finalize, Submit, identity), never by apply/**
export type FigmaPortExtras = Pick<PluginAPI, 'viewport' | 'saveVersionHistoryAsync' | 'fileKey'>;
```

**Lint rule.** A Biome `noRestrictedGlobals` rule (`figma`) applies to `packages/plugin/src/apply/**`. Only `src/main.ts` touches `figma`.

---

<a id="pipeline"></a>
## 5. Apply pipeline

```
open ─► preflight ─► index ─► plan ─► [user review] ─► tokens ─► apply (per component, topo order) ─► verify (per variant) ─► finalize
          RO           RO       RO                       W            W                                     W                 W
                                                         └ library variable imports   └ library component imports
```

RO = read-only, W = writes. No stage before `tokens` writes to the document, which makes cancelling before apply free. Library imports (`importVariableByKeyAsync`, `importComponentByKeyAsync`, `importComponentSetByKeyAsync`) add references to the file, so they count as writes and run only after confirmation.

**Edit access.** Before any write, main checks `figma.editorType === 'figma'` and that the user can edit the file. Otherwise (view-only file, Dev Mode, a non-Design editor) it stops with `APPLY_NO_EDIT_ACCESS`: "Holotype builds components. Open this file in Design mode with edit access."

<a id="preflight"></a>
### 5.1 Preflight (read-only) <a id="fonts"></a>

| Check | How | Outcome |
|---|---|---|
| **IR compatibility** | `manifest.sceneVersion` major ∈ `SUPPORTED_MAJORS`; unknown minors are ignored ([06](06-ir.md#versioning)) | else `APPLY_IR_VERSION_UNSUPPORTED` (error, blocks) |
| **Fonts** | Collect every `FontName` the bundle needs: text ranges, plus every mode value of font-family/weight variables ([08](08-tokens.md#edge)). `await figma.listAvailableFontsAsync()` is cached once per session. Resolve each one: (1) exact family+style; (2) a saved mapping (root shared plugin data `holotype/fontmap`, plus clientStorage for user-level defaults); (3) a style-name normalization table ([07](07-mapping.md#fonts)); (4) variable fonts: `loadFontAsync` with a `FontNameInput` (style omitted, `variationSettings` filtered by `getFontFamilyVariationAxes(family)`; setting an axis the family lacks throws, and a `null` result means a static font) | missing fonts are listed in the **Fonts** screen; the user maps or accepts the fallback (default Inter of the nearest weight). Emits `FONT_MISSING` (warn) or `FONT_SUBSTITUTED` (info) |
| **Images** | For each asset sha: the registry image map (sha → Figma image hash), then `figma.getImageByHash` | request only the missing ones |
| **Variables / styles** | The matching procedure of [08 §10](08-tokens.md#matching), by name and key only (`getVariablesInLibraryCollectionAsync`); imports run in the `tokens` stage | a matching summary for the Tokens tab |
| **Libraries** (components) | If `BundleManifest.libraryComponents` maps `sid` → published component key (e.g. icons already exist in a team library), record the match by key only; `importComponentByKeyAsync` / `importComponentSetByKeyAsync` run in the `apply` stage | use library components as instance targets ([§10](#nested)) |
| **Pages** | Resolve the target pages by name or registry id; `await page.loadAsync()`. **First apply in a file without a root registry** asks: "Set up this file as your Holotype library? It adds the pages Components, Icons and Deprecated. [Set up] [Choose pages…]". Adopting hand-made components is a non-goal for v1 | absent pages are recorded in the plan and created at the start of `apply` (the first write stage) |

Fonts: `loadFontAsync` is called **once per unique FontName**, in parallel batches of 16. A failed load marks that font missing. Fonts screen copy (browser app only): "In the browser app, local fonts need the 'Apps on device' permission for figma.com, or use the desktop app. Prefer org-shared fonts for the library file."

<a id="index-stage"></a>
### 5.2 Index (read-only)

See [10 §3](10-sync.md#index). For each target page (from the registry plus the default page):

1. `await page.loadAsync()`.
2. `page.findAllWithCriteria({ sharedPluginData: { namespace: 'holotype', keys: ['nk'] } })`, with `figma.skipInvisibleInstanceChildren = true`.
3. Build the maps `sid → ComponentSetNode`, `(sid, vk) → ComponentNode`, `(sid, vk, nk) → SceneNode`.

Variables are indexed via `getLocalVariablesAsync()` plus their `holotype/tok` data. `figma.loadAllPagesAsync()` is never called.

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

Each written variable gets `holotype/tok` and `holotype/ah`. Library-matched variables are imported (`importVariableByKeyAsync`) and never modified.

### 5.5 Apply (write), per component in topological order

1. **Dependency graph.** Built from Scene IR `instance` nodes ([§10](#nested)) and icon references. Kahn's algorithm gives the order: icons, then leaf components, then composites.
2. **Cycles.** These come from mutual nesting, e.g. a Menu rendering a MenuItem that renders a Menu. They are broken by building the cycle members first with their nested parts as **frames**, emitting `APPLY_INSTANCE_CYCLE` (warn).
3. **Per component** (the unit of atomicity for undo and resume):
   1. Ensure the page and section exist ([§9](#pages)). Import the library instance targets matched in preflight.
   2. Reconcile variants: create missing `ComponentNode`s and update existing ones in place ([10 §5](10-sync.md#reconcile)).
   3. For each variant, apply its node tree with the write rules ([§6](#apply-order)).
   4. Verify the variant ([§11](#verify)) and apply fallbacks. **Proposal mode only** (branch files): then write the baseline snapshot `base:0..n` from the same read-back ([§20](#proposal)).
   5. Ensure the `ComponentSetNode` exists and the variant names are correct ([§7](#sets)).
   6. Reconcile component properties and bindings ([§8](#props)).
   7. Lay out the variants grid and labels ([§7.4](#grid)).
   8. Update the documentation frame ([§9.3](#doc-frame)).
   9. Write the component-level plugin data (`irh`, `ah`, `v`), relaunch data and description.
   10. Call `figma.commitUndo()`.

### 5.6 Finalize (write)

1. Write the root registry, chunked ([10 §2.3](10-sync.md#root-registry)). In proposal mode, also write root `branch:meta` (`baseCommit`, `baselineFp`, `status`) ([§20](#proposal)).
2. Write the report summary to root shared plugin data `holotype/report:*`.
3. Post `done`.
4. `figma.notify('Synced 12 components (3 updated, 1 conflict)', { timeout: 6000 })`.
5. Select the changed sets, with an optional zoom: `figma.viewport.scrollAndZoomIntoView`.

---

<a id="apply-order"></a>
## 6. Node write rules & ordering constraints

The Plugin API is order-sensitive and throws on several invalid sequences (research brief §11 gotchas). The applier writes every node **top-down, pre-order**: parent first, then children in paint order (bottom → top). Within a node, it follows exactly this sequence. The pseudocode uses the `@holotype/ir` field names of [06 §3.3](06-ir.md) verbatim.

```ts
async function writeNode(port: FigmaPort, s: SceneNode, parent: ChildrenMixin & BaseNode, index: number, existing?: SceneNodeLike) {
  // 0. create (or reuse existing managed node, 10 §5)
  const n = existing ?? create(port, s.kind);                          // createFrame | createText | createRectangle | createNodeFromSvg | instance
  if (!existing) n.setSharedPluginData('holotype', 'nk', s.nk);       // provisional identity immediately (crash-safe resume, §13)
  // 1. attach FIRST: FILL/ABSOLUTE/constraints require a parent; auto-layout child props require an auto-layout parent
  if (n.parent !== parent || indexOf(n) !== index) parent.insertChild(index, n);
  // 2. defaults hygiene for fresh frames: createFrame() starts at 100×100 with a WHITE fill
  if (!existing && n.type === 'FRAME') { n.fills = []; n.clipsContent = false; }
  // 3. layout mode BEFORE any padding/spacing/align/wrap/grid props
  const L = s.layout;
  if (isFrameLike(n)) {
    n.layoutMode = L?.mode ?? 'NONE';
    if (L?.mode === 'GRID') {                                           // S-10
      n.gridRowCount = L.rows.length; n.gridColumnCount = L.columns.length;
      n.gridRowSizes = L.rows; n.gridColumnSizes = L.columns;
      n.gridRowGap = L.rowGap; n.gridColumnGap = L.columnGap;
    } else if (L) {
      n.layoutWrap = L.wrap ? 'WRAP' : 'NO_WRAP';                       // wrap before counterAxisSpacing/alignContent
      n.itemSpacing = L.itemSpacing;
      if (L.wrap) { n.counterAxisSpacing = L.counterAxisSpacing ?? 0; n.counterAxisAlignContent = L.counterAxisAlignContent ?? 'AUTO'; }
      n.primaryAxisAlignItems = L.primaryAxisAlignItems;
      n.counterAxisAlignItems = L.counterAxisAlignItems;
      n.itemReverseZIndex = L.itemReverseZIndex;
      n.strokesIncludedInLayout = L.strokesIncludedInLayout;
    }
    if (L) { n.paddingTop = L.padding.t; n.paddingRight = L.padding.r; n.paddingBottom = L.padding.b; n.paddingLeft = L.padding.l; }
  }
  // 4. size: resize() forces FIXED on auto-layout axes → do it BEFORE setting HUG/FILL
  const w = max(s.size.w, 0.01), h = max(s.size.h, 0.01);
  if (n.type !== 'TEXT') {
    if (parentIsAutoLayout(parent) || L) n.resize(w, h);
    else n.resizeWithoutConstraints(w, h);                             // avoid recursive constraint scaling
  }
  // 5. child-of-parent properties (only now: we are attached)
  const c = s.child;
  if (parentIsAutoLayout(parent)) {
    n.layoutPositioning = c?.positioning ?? 'AUTO';                    // ABSOLUTE only after append
    if (c?.positioning === 'ABSOLUTE') { n.x = s.xy!.x; n.y = s.xy!.y; n.constraints = c.constraints ?? { horizontal: 'MIN', vertical: 'MIN' }; }
    if (c?.grid) n.setGridChildPosition(c.grid.row, c.grid.col);       // GRID parent; spans and alignment per S-10
  } else { if (s.xy) { n.x = s.xy.x; n.y = s.xy.y; } if (c?.constraints) n.constraints = c.constraints; }
  if (s.relativeTransform) n.relativeTransform = s.relativeTransform;  // rotation/skew; overrides x/y
  // 6. own sizing modes: HUG valid only on auto-layout frames & text; FILL only inside auto-layout parent
  if (c) {
    if (isFrameLike(n) && L) { n.layoutSizingHorizontal = c.sizingH; n.layoutSizingVertical = c.sizingV; }
    else if (parentIsAutoLayout(parent)) { n.layoutSizingHorizontal = demoteHug(c.sizingH); n.layoutSizingVertical = demoteHug(c.sizingV); }
    if (c.min) { n.minWidth = c.min.w ?? null; n.minHeight = c.min.h ?? null; }
    if (c.max) { n.maxWidth = c.max.w ?? null; n.maxHeight = c.max.h ?? null; }
  }
  // 7. text content (see §6.1) or SVG/image specifics
  if (n.type === 'TEXT') await writeText(port, n, s);
  // 8. visuals: build NEW arrays (paints/effects are immutable); bind each paint's/effect's own `bind` on the new objects
  n.fills = bindPaints(port, s.fills ?? []);
  n.strokes = bindPaints(port, s.strokes?.paints ?? []);
  if (s.strokes) writeStrokeGeometry(n, s.strokes);                    // align, per-side weight, dashPattern, cap/join, bindWeight
  writeRadii(n, s.radius);                                             // topLeftRadius… (cornerSmoothing 0)
  n.effects = bindEffects(port, s.effects ?? []);
  n.opacity = s.opacity ?? 1; n.blendMode = s.blendMode ?? 'PASS_THROUGH'; n.visible = s.visible;
  if (isFrameLike(n)) n.clipsContent = !!s.clipsContent;
  if (s.isMask) { n.isMask = true; n.maskType = s.maskType ?? 'ALPHA'; }
  // 9. float bindings (padding/gap/radius/size/...) AFTER literals (08 §8)
  for (const [field, ref] of nodeFieldBindings(s.bind)) n.setBoundVariable(field, await resolveVar(ref));
  for (const m of s.bind?.explicitModes ?? []) n.setExplicitVariableModeForCollection(await coll(m.collection), await modeId(m));
  // 10. name + identity LAST (cheap, and marks the node as fully written)
  n.name = s.name;
  writeIdentity(n, s);                                                 // holotype/nk, irh, ah, v (10 §2)
  // 11. children (pre-order recursion) happen after this node is complete
}
```

### 6.1 Text sequence <a id="text"></a>

```ts
async function writeText(port, t: TextNode, s: SceneNode) {
  const x = s.text!;
  // fonts were all loaded in preflight; still guard: setting characters with an unloaded font throws
  t.fontName = resolvedFont(x.ranges[0].font);     // base font first (must be loaded); SceneFontRequest → FontName (§5.1)
  t.characters = x.characters;                     // BEFORE ranges: replacing characters drops range styling
  if (x.styleRef) await t.setTextStyleIdAsync(await resolveTextStyle(x.styleRef));   // style first; ranges override only where they differ
  for (const r of x.ranges) {                      // per range; skip fields equal to base to minimize overrides
    t.setRangeFontName(r.start, r.end, resolvedFont(r.font));
    t.setRangeFontSize(r.start, r.end, r.fontSize);
    t.setRangeLineHeight(r.start, r.end, { value: r.lineHeight.value, unit: 'PIXELS' });     // D-17: never AUTO
    t.setRangeLetterSpacing(r.start, r.end, { value: r.letterSpacing.value, unit: 'PIXELS' });
    t.setRangeFills(r.start, r.end, bindPaints(port, r.fills));
    if (r.textCase !== 'ORIGINAL') t.setRangeTextCase(r.start, r.end, r.textCase);
    if (r.decoration !== 'NONE') { t.setRangeTextDecoration(r.start, r.end, r.decoration); /* decorationStyle/Color/Thickness/Offset */ }
    if (r.hyperlink) t.setRangeHyperlink(r.start, r.end, { type: 'URL', value: r.hyperlink });
    // r.openTypeFeatures: not writable through the Plugin API (07 §8) → TEXT_OPENTYPE_UNSUPPORTED (warn), nothing written
    for (const [field, ref] of Object.entries(r.bind ?? {})) t.setRangeBoundVariable(r.start, r.end, field, await resolveVar(ref));
  }
  t.textAlignHorizontal = x.alignH; t.textAlignVertical = x.alignV;
  if (x.paragraphSpacing) t.paragraphSpacing = x.paragraphSpacing;
  if (x.paragraphIndent) t.paragraphIndent = x.paragraphIndent;
  if (x.leadingTrim) t.leadingTrim = x.leadingTrim;
  if (x.wrapStyle) t.textWrapStyle = x.wrapStyle;              // AUTO | BALANCE | PRETTY (CSS text-wrap)
  // sizing LAST: resize() implies fixed width; autoResize must follow it
  // allowed: 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'NONE'. Never write 'TRUNCATE' (deprecated in the typings)
  if (x.autoResize === 'WIDTH_AND_HEIGHT') t.textAutoResize = 'WIDTH_AND_HEIGHT';
  else { t.resize(s.size.w, s.size.h); t.textAutoResize = x.autoResize === 'HEIGHT' ? 'HEIGHT' : 'NONE'; }
  if (x.truncation) { t.textAutoResize = 'NONE'; t.textTruncation = 'ENDING'; t.maxLines = x.truncation.maxLines; }   // truncation
}
```

OpenType features (`tnum` and others) are not writable: `TextNode.openTypeFeatures` is read-only and there is no range setter ([07 §8](07-mapping.md#8-text)). The mapper emits `TEXT_OPENTYPE_UNSUPPORTED`; numeric widths rely on the text width buffer (§11.1).

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

- **Image.** `const img = port.createImage(bytes)`, then use `img.hash`. Paint: `{ type: 'IMAGE', imageHash, scaleMode, imageTransform?, scalingFactor? }`. Capture guarantees PNG/JPEG/GIF at ≤4096px ([05](05-capture.md#images)). The applier asserts this and emits `APPLY_IMAGE_REJECTED` when Figma refuses an image.
- **SVG.** `const f = port.createNodeFromSvg(svgText)` returns a FrameNode wrapper.
  - If the wrapper has a single child and no own visuals, unwrap it: move the child into the parent at the same index, then remove the wrapper.
  - The resulting vector layers are named from the Scene IR (`Icon / chevron-down`).
  - Failure (exception or empty result) builds the Scene's `fallbackRaster` asset as an image rectangle and emits `SVG_IMPORT_FAILED` (warn) (S-09).

---

<a id="sets"></a>
## 7. Components, variants & sets

### 7.1 One `ComponentNode` per variant

Each variant root is a `ComponentNode`, created with `port.createComponent()` and written with the frame rules of §6. Components are not created with `createComponentFromNode`, because building directly into the component avoids a conversion step and keeps node IDs stable.

The variant name is the canonical axis string `Prop=Value, Prop2=Value2`, built from `SceneVariant.values`. Axis order is the order of the VARIANT entries in `SceneComponent.properties`. Labels arrive sanitized from the planner ([04 §8](04-variant-model.md#8-naming-and-ordering)); the applier asserts there is no `=` or `,` in any axis name or value.

### 7.2 Creating and evolving the set

| Situation | API sequence |
|---|---|
| **First build** | Create all variant components as children of the target section, then `const set = port.combineAsVariants(components, section)`. Name it with `set.name = component.name`. **Empty sets are impossible**: never call this with 0 nodes |
| **Add a variant later** | `const c = port.createComponent(); set.appendChild(c); c.name = 'Size=lg, State=Hover'`, then write its tree. Appending a ComponentNode into a ComponentSetNode is expected to work (verify, S-02). Fallback: create on the page, then `combineAsVariants([...set.children, c], parent)`. That creates a *new* set, which breaks instance links, so it must **not** be used if S-02 refutes the expectation; instead report `APPLY_VARIANT_ADD_FAILED` |
| **Remove a variant** | It is a [10 §7](10-sync.md#deprecation) decision. Default: keep it, rename it to `…, Deprecated=true`, and move it to the end. Hard remove is **never** allowed for a component that was ever published (`key` exists): consumer files are invisible to the plugin, so it is deprecated instead (D-20). `await c.getInstancesAsync()` sees only this file. Hard `c.remove()` is allowed only for a never-published variant, when the policy allows it and no local instances exist |
| **Add an axis** | `set.addComponentProperty('Theme', 'VARIANT', 'Light')` gives every existing variant `Theme=Light`. Then rename the new variants |
| **Remove an axis** | First deprecate or remove the variants that become duplicates. Then rename all variants without the axis. Collisions must not exist at any intermediate step: rename to temporary unique names first (`__tmp<i>`), then to the finals |
| **Rename an axis** | `set.editComponentProperty('Size', { name: 'Scale' })` for VARIANT. Instances keep their values (verify, S-02) |
| **Rename a value** | Rename each affected variant (`c.name = …`) |
| **Reorder axes** | Rename all variants with the new axis order. This doesn't change properties (verify, S-02) |

### 7.3 Default variant

Figma's default variant is the **top-left-most** child (research brief §2). The planner gives the default variant (the story's default args) `SceneVariant.grid = { row: 0, col: 0 }`, so the grid layout below places it top-left.

<a id="grid"></a>
### 7.4 Variant grid & labels

The set has no auto layout (`layoutMode = 'NONE'`). Variants are positioned explicitly, so a grid with labels outside it can align exactly.

Positions come from `SceneVariant.grid` and `SceneSetLayout` ([06 §3.2](06-ir.md)): the mapper decides rows and columns (D-08, D-09). The plugin only converts grid cells to x/y with `setLayout.gap` and `setLayout.padding` (defaults 24 and 32):

```
cellW[c] = max width of variants in column c; cellH[r] = max height in row r      // c, r from SceneVariant.grid
x = P + Σ_{i<c} (cellW[i] + gap.x);  y = P + Σ_{j<r} (cellH[j] + gap.y)          // P = setLayout.padding
variant positioned top-left inside its cell
set.resizeWithoutConstraints(totalW + P, totalH + P)
```

- **Labels** are managed TEXT nodes (Inter 11, secondary color) placed in the *Section*, outside the set: column labels above, row labels to the left. Their text comes from `SceneDocFrame.axisLabels`. They have `nk = 'label/col/<i>'` or `'label/row/<j>'`.
- **Very large sets.** Beyond `figma.grid.maxColumns` ([16](16-config.md#figma)), the mapper wraps the grid into multiple visual blocks of the same set; the plugin still only converts cells to x/y.
- **Set styling.** The set keeps Figma's default dashed purple stroke. Our padding is part of the set's size.

---

<a id="props"></a>
## 8. Component properties

Arg classification happens in the planner ([04](04-variant-model.md#classification)). The Scene IR carries the result as `SceneComponent.properties: ScenePropertyDef[]` and, on nodes, `SceneNode.propRefs` (bindings) and `SceneNode.slot` ([06 §3.1](06-ir.md)). VARIANT entries are the set's axes (§7); this section covers the others.

### 8.1 Define on the set, bind in every variant

```ts
const ids = readJSON(set, 'holotype', 'props') as Record<string /*ScenePropertyDef.key*/, string /*Figma property name incl. #id*/>;
for (const p of scene.properties.filter(p => p.type !== 'VARIANT')) {
  let name = ids[p.key];
  if (!name || !(name in set.componentPropertyDefinitions)) {
    name = set.addComponentProperty(p.name, p.type, await defaultValue(p), propOptions(p));  // returns "Show icon#12:3"
    ids[p.key] = name;                                                        // PERSIST: the #id suffix is the identity
  } else {
    // keep the id; only edit what changed (display name changes are safe: we key by ScenePropertyDef.key, not by name)
    const def = set.componentPropertyDefinitions[name];
    const patch = diffProp(def, p);                                           // per-type allow-list, below
    if (patch) ids[p.key] = set.editComponentProperty(name, patch);           // returns the (possibly new) name string
  }
}
writeJSON(set, 'holotype', 'props', ids);
// bind: walk every variant's nodes and read their propRefs
for (const v of scene.variants) for (const s of walk(v.root)) {
  if (!s.propRefs && !s.slot) continue;
  const node = index.node(scene.sid, v.vk, s.nk);
  const refs = { ...(node.componentPropertyReferences ?? {}) };
  for (const [field, key] of Object.entries(s.propRefs ?? {})) refs[field] = ids[key];   // visible | characters | mainComponent
  if (s.slot) (refs as any).slotContentId = ids[s.slot.propKey];               // SLOT: cast until the typings union includes it
  node.componentPropertyReferences = refs;
}
```

`diffProp` only patches fields that `editComponentProperty` accepts for the type; anything else throws:

| Field | Allowed for |
|---|---|
| `name` | all types |
| `defaultValue` | BOOLEAN, TEXT, INSTANCE_SWAP |
| `preferredValues` | INSTANCE_SWAP, SLOT |
| `description`, `slotSettings` | SLOT only |

Descriptions of other properties go to the doc frame's properties table ([§9.3](#doc-frame)).

Rules:

- **TEXT.** Bind `characters` on the TEXT node (`nk` aligned across variants, [07](07-mapping.md#alignment)). Default = the story's initial arg value.
- **BOOLEAN.** Bind `visible` on every toggled node. The variant tree must contain the node in *all* variants. The mapper guarantees this by emitting a hidden node (`visible:false`) where the arg is false ([04](04-variant-model.md#classification)).
- **INSTANCE_SWAP.** The node must be an INSTANCE. Bind `mainComponent` (INSTANCE_SWAP only). The default value is the target component's **node id** (`addComponentProperty(name, 'INSTANCE_SWAP', comp.id, { preferredValues: [{ type: 'COMPONENT', key: comp.key }, …] })`). Preferred values need component **keys**, which exist for local components too (verify, S-13).
- **SLOT.** `set.addComponentProperty(name, 'SLOT', '', { slotSettings })` is called **once on the set**. In each variant, the region with `SceneNode.slot` becomes the slot by setting `componentPropertyReferences = { slotContentId: id }` (cast until the typings union includes it). The alternative is `createSlot()` on the first variant, reusing its property id in the others; `createSlot()` per variant would create N properties. The region holds the story's default content as children. `slotSettings` maps `minChildren`, `maxChildren`, `allowPreferredValuesOnly`, `stretchChildOnInsert` and `displayEmptyByDefault`. A GRID frame cannot be a slot (`cannotApplySlotPropertyToFrameWithGrid`): the applier degrades to an inner non-grid frame. De-risking is spike **S-13**, as extended in [14](14-roadmap.md#phase-0). Until S-13 passes, SLOT args degrade to FIXED content, with `APPLY_SLOT_UNSUPPORTED` (info).
- **Property ids are never renamed by deletion and re-creation** ([10 §6](10-sync.md#prop-renames)). A display name change uses `editComponentProperty`, which keeps instance values (verify, S-02).
- **Removed args.** `deleteComponentProperty(name)` is used only when the arg is gone from code *and* the policy allows it. Default: keep the property and append `(deprecated)` to its name. This is non-breaking.
- **Persisted map.** The set's `holotype/props` is keyed by `ScenePropertyDef.key` (`arg:<name>`, `state`, …), so non-arg properties have a key too ([10 §6](10-sync.md#prop-renames)).

---

<a id="pages"></a>
## 9. Pages, sections & documentation frames

### 9.1 Layout (D-22)

```
Page "Components"                        (config: figma.page)
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

- `set.description` holds the docgen description in plain text. `descriptionMarkdown` is writable and holds the Markdown form.
- `set.documentationLinks = [{ uri: storyUrl }]` links to the Storybook docs or story page. It is writable and holds **one** link (S-12 confirms on a real file).
- `set.setRelaunchData({ resync: `Re-sync ${name} from Storybook`, open: '', details: '' })` in library files; `{ review: '', details: '' }` in branch files (§2).
- `devStatus` can be written only on nodes directly under a page or section, never on a node nested inside another node that has a `devStatus`. The plugin writes it only on top-level screens at Submit (§20.3).
- Each **variant** component's `description` gets a short args summary (`variant: primary · size: md · state: hover`) plus a story link. This helps Dev Mode users.

<a id="doc-frame"></a>
### 9.3 Documentation frame

The documentation frame is a managed frame (vertical auto layout, 24px padding, fixed width 480). It holds no overrides, so in-place recreation of its *children* is allowed. It is rewritten only when its inputs (`docFrame` irh, diagnostics counts) change, and the set's `syncedAt` is written only when the component's `irh` changes, so a no-op re-sync makes 0 writes (I-2). Contents:

1. Title (component display name) and a breadcrumb (title path).
2. Description, docgen Markdown rendered as plain text with bold and code runs.
3. "Open in Storybook" link (`setRangeHyperlink`).
4. Properties table: rows of *name · type · values · default · description*, generated from `SceneComponent.properties`.
5. Mode preview row, when variable modes exist: one instance of the default variant per mode, each wrapped in a frame with `setExplicitVariableModeForCollection` ([08 §7.3](08-tokens.md#modes)).
6. Footer, mode-aware ([10 §9](10-sync.md#designer-edits)):
   - library file: "Managed by Holotype · synced at the last change to this component. Edits to managed layers are kept but flagged on the next sync; add notes in the Notes frame."
   - branch file: "Branch file · `<branch>`. Edit anything: your changes become a design change request."
7. Diagnostics badge: counts of warn/error for this component. Clicking it opens the report.

Toggles: `figma.docFrames`, `figma.docSections[]` ([16](16-config.md#figma)).

---

<a id="nested"></a>
## 10. Nested instances & icons

### 10.1 Scene IR instance node

A nested instance is a `SceneNode` with `kind: 'instance'` and `instance: SceneInstance` ([06 §3.3](06-ir.md)). The applier reads these fields, with 06 names verbatim:

| Field | Use |
|---|---|
| `instance.component` | `SceneComponentRef`: `{ kind: 'local', sid, vk? }` or `{ kind: 'library', key }` |
| `instance.properties` | values keyed by the *target's* `ScenePropertyDef.key`, VARIANT keys included |
| `instance.overrides` | last-resort literal overrides (e.g. text not covered by a TEXT property), at most 8 |
| `instance.match` | D-21 evidence; not hashed, not written |
| `instance.fallback` | full frame subtree, built if the instance can't be verified |
| `expect` (on the node) | expected box relative to the variant root, for verification |

### 10.2 Apply

1. **Resolve the main component.**
   - Local with `vk`: `index.variant(component.sid, component.vk)`.
   - Local without `vk`: the target set's default variant (grid (0,0)); step 3 then sets its VARIANT values.
   - Library: `importComponentByKeyAsync(component.key)`.
   - Missing: build `instance.fallback`, and emit `APPLY_INSTANCE_TARGET_MISSING` (warn).
2. **Create or reuse the instance.**
   - Create: `const inst = main.createInstance()`, insert it at its index, then apply the child-of-parent properties (§6 step 5–6).
   - Reuse with a changed target: `inst.swapComponent(main)`, which **preserves overrides**. Never assign `inst.mainComponent` (research brief §2).
3. **Set properties:** `inst.setProperties({ [targetProps[key]]: value, [axisName]: value })`. The *target's* stored `holotype/props` map translates `ScenePropertyDef.key` → `Name#id`; VARIANT keys map to axis names.
4. **Overrides.** Apply `instance.overrides`. Each one is a diagnostic `APPLY_INSTANCE_OVERRIDE` (info), so authors can add TEXT props.
5. **Verify.** Read `inst.absoluteBoundingBox` relative to the variant root and compare it to `expect` (tolerance 1px). Optionally, in fidelity mode, compare visually. On mismatch: remove the instance, build `instance.fallback`, and emit `APPLY_INSTANCE_MISMATCH` (warn, with Δ). The planner learns from this in the next run (cached negative match).

<a id="icons"></a>
### 10.3 Icons page & INSTANCE_SWAP

- **Icon components.** The mapper extracts repeated SVGs ([07](07-mapping.md#icons)) and icon args into **icon components**, with `sid = icon:<slug>` (on a slug collision `icon:<slug>-<sha8>`; README glossary). They are built first, on the "Icons" page, in a Section grid of 24px cells. Each is a `ComponentNode` (not a set), whose content is the unwrapped `createNodeFromSvg` vectors.
- **Recoloring.** The vectors' fills are bound to a COLOR *variable* if one is token-provenanced. Otherwise they are literal, and the mapper marks `iconColor: 'currentColor'`: inside consuming components, the instance gets a fill override equal to the resolved `color`.
- **INSTANCE_SWAP properties** use the icon components' ids and keys for `default` and `preferredValues`.

---

<a id="verify"></a>
## 11. Read-back verification & fallback <a id="fallback"></a>

Figma lays out synchronously, so reads right after writes are valid. To avoid forcing layout repeatedly, verification runs **once per variant, after the whole variant tree is written** (D-15).

```ts
async function verifyVariant(root: ComponentNode, scene: SceneVariant, tol = 1): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  for (let pass = 0; pass < 3; pass++) {                              // bounded fix-point
    const bad = new Map<string, number>();                           // container nk → max child Δ
    const origin = root.absoluteBoundingBox!;
    for (const [s, parent] of walkWithParent(scene.root)) {          // SceneNode and its parent SceneNode
      const n = index.node(scene.vk, s.nk); if (!n) continue;
      const bb = n.absoluteBoundingBox!;                              // rotation-aware AABB; compare to expect AABB
      const d = maxDelta(rel(bb, origin), s.expect);                  // expect is relative to the variant root (06)
      if (d > tol && parent) bad.set(parent.nk, Math.max(bad.get(parent.nk) ?? 0, d));
      if (s.kind === 'text') checkTextLines(n as TextNode, s, out);   // §11.1
    }
    if (bad.size === 0) break;
    // fix deepest offending containers first (children before parents)
    for (const nk of [...bad.keys()].sort(byDepthDesc)) out.push(...relaxOrFallback(index.node(scene.vk, nk) as FrameNode, sceneNode(scene, nk)));
  }
  return out;
}
```

`relaxOrFallback(container, s)` tries the following in order (D-15), re-measuring after each, and stops at the first that passes:

1. **Text width buffer** for text children that wrapped differently ([§11.1](#text-check)).
2. **HUG → FIXED** for children whose own size mismatched. Emit `APPLY_LAYOUT_RELAXED` (info).
3. **FILL → FIXED** for the same children. Emit `APPLY_LAYOUT_RELAXED` (info).
4. **Absolute fallback (container).**
   1. `container.layoutMode = 'NONE'`. Children keep their current, wrong positions.
   2. Then, for each child, set `x`/`y` and `resizeWithoutConstraints(w, h)` from the container's `s.fallback.children[nk]`.
   3. The container gets `resizeWithoutConstraints(s.fallback.size.w, s.fallback.size.h)`.
   4. Emit `APPLY_LAYOUT_FALLBACK` (warn) with `{ maxDelta, reason }`. The planner records this, so the mapper can learn which patterns fail (S-06/S-10 corpus).

A fallback never touches ancestors. The container's outer size is forced to its expected size, so the ancestors' layout is unchanged.

<a id="text-check"></a>
### 11.1 Text line parity (D-17)

```ts
function checkTextLines(t: TextNode, s: SceneNode, out: Diagnostic[]) {
  const x = s.text!;
  const lineH = Math.max(...x.ranges.map(r => r.lineHeight.value));   // PIXELS, never AUTO (D-17)
  const want = x.lines.length;                                         // browser line count
  const count = () => Math.round(t.height / lineH);
  if (count() === want) return;
  if (count() > want && t.textAutoResize !== 'WIDTH_AND_HEIGHT' && canWiden(t)) {   // FIXED width (or FILL with slack)
    const base = t.minWidth, w0 = t.width;
    for (let b = 0.5; b <= x.widthBuffer.max; b += 0.5) {             // the mapper sets max (07 §8); S-04 calibrates
      t.minWidth = w0 + b; t.textAutoResize = 'HEIGHT';
      if (count() === want) { out.push(diag('TEXT_WIDTH_BUFFERED', s, { buf: b })); return; }
    }
    t.minWidth = base; t.resize(w0, t.height);                         // revert: no buffer restores parity
  }
  out.push(diag('TEXT_LINE_MISMATCH', s, { figma: count(), browser: want }));   // warn; suggests locked-lines mode
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
- **Orphan creations.** Freshly created nodes get a provisional `holotype/nk` right after creation (step 0), before attributes or children are written. Step 10 then writes the full identity record. An interrupted node is therefore found by the index and reconciled, never duplicated. A node with `nk` but without `irh` is known to be incomplete and is always rewritten.

---

<a id="fidelity"></a>
## 14. Fidelity export mode

Fidelity export is used by the harness ([12](12-quality.md#fidelity)) and on demand ("Check fidelity" in the report).

1. For each variant in scope:
   - `await variant.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 }, useAbsoluteBounds: true })` (verify option name, S-06);
   - collect `{ nk, absoluteBoundingBox }` for every managed descendant.
2. Throttle to one export in flight at a time. Yield between exports.
3. Post `export.png` with the bytes and boxes. The UI POSTs them to the local server's `/v1/fidelity` (topology A), or bundles them into a downloadable zip (file mode).
4. The CLI's `fidelity` tool scores them against the Playwright screenshots (SSIM, pixelmatch, box deltas). The score is shown back in the report, and optionally written onto the set as `holotype/fid` (score + timestamp).

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
- **Driver.** The CLI command `holotype mcp` (or an agent) sends slices: one component per call, because output is limited to 48 KB per call and the input limits are unknown (verify, S-11).
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
| `APPLY_IMAGE_REJECTED` | warn | `createImage` refused the bytes (format or size) |
| `SVG_IMPORT_FAILED` | warn | `createNodeFromSvg` failed; raster fallback used |
| `FONT_MISSING` | warn | required font not available; fallback applied |
| `FONT_SUBSTITUTED` | info | font mapped via user or saved mapping |
| `APPLY_LAYOUT_RELAXED` | info | HUG/FILL relaxed to FIXED to pass verification |
| `APPLY_LAYOUT_FALLBACK` | warn | container converted to absolute positioning after read-back failure |
| `TEXT_WIDTH_BUFFERED` | info | text box widened by ≤ buffer to match the browser's line count |
| `TEXT_LINE_MISMATCH` | warn | Figma line count ≠ browser line count after buffering |
| `NET_SERVER_UNREACHABLE` | warn | local server not reachable (not running); a browser LNA block is `NET_LNA_BLOCKED` |
| `NET_PAIRING_FAILED` | error | pairing code rejected or expired |
| `APPLY_BUNDLE_CORRUPT` | error | component sha256 mismatch on transfer or import ([02](02-architecture.md)) |

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
8. **S-17 / S-18:** whether Figma branches carry shared plugin data (`branch:meta`, `base:*`) on branch creation and merge; whether plugins can write `devStatus`; `reactions` coverage of interactive components.

---

<a id="proposal"></a>
## 20. Proposal mode (branch files)

The workflow is in [15](15-change-requests.md#proposal-mode). This section covers what the plugin does differently.

### 20.1 Mode, baseline and `branch:meta`

- **Mode.** Main reads root `holotype/branch:meta` on `hello`. If it is present with `mode: 'proposal'`, the session runs in proposal mode, and `ready` reports it. A main library file never has `branch:meta`, so it never runs in this mode. The UI writes `branch:meta` through `branch.link` once `holotype branch start|link` pairs with the file.
- **Plan.** A designer-edited managed node (an `ah` mismatch) is a **proposal**: it is kept and marked `proposal` in the plan, and it is not a conflict ([10 §9](10-sync.md#designer-edits)). Untouched nodes update as usual.
- **Baseline write (D-34).** After step 4 of §5.5, main normalizes the read-back of each variant with the **same normalizer as `ah`** (shared module, [10 §9.1](10-sync.md#designer-edits)) into a `BaselineSnapshot` ([15 §3.3](15-change-requests.md#proposal-mode)). It then does canonical JSON → fflate deflate → base64, and writes chunks of ≤90 kB to variant shared plugin data `base:0..n`. The set gets its property/axes snapshot the same way.
  - **Budget:** ≤16 kB compressed per variant. Over budget, nothing is written to the file. The snapshot goes to the CLI in `ApplyReport.baselines`, and `DCR_BASELINE_EXTERNAL` is raised.
  - **No-op rule:** `base:*` is rewritten only when the snapshot's hash differs from the stored `base:h`, so a no-op re-sync still makes 0 writes.
  - **Edited nodes on refresh** keep the designer's value. Their baseline entry moves to the new code value, flagged `DCR_BASELINE_SHIFTED` when the code changed underneath.
- **Finalize** writes `branch:meta` (`baseCommit`, `baselineFp`, `status: 'editing'`) in the same undo step as the registry.

### 20.2 Changes screen (live)

- On `changes.request`, main compares each managed node's per-group `ah` sub-hashes with its baseline. No full diff runs, so this is cheap.
- It also lists components without `sid` (new), screens in scope, and outdated or deprecated instances ([15 §4.13](15-change-requests.md#instance-versions)).
- It returns `ChangeSummary[]`: `{ group: sid | 'new' | 'screens', title, kinds, nodeId, excluded }`.
- The UI refreshes on the current page's `nodechange` events, debounced to 500 ms. `documentchange` needs `loadAllPagesAsync`, which is never called (D-06; verify, S-06).
- **Exclude** toggles are written to `branch:meta.excluded` with `branch.meta.patch`.
- Screen spec: [11 §6.14](11-ux.md#changes).

### 20.3 Submit flow

```
UI: snapshot.request{scope} ─► main: normalizePlugin() over nodes in scope (read-only) ─► snapshot chunks
UI: dcr.extract(snapshot, baseline, config)   (package dcr, pure; WebCrypto for h16)
UI: render designer-view preview (review summary first, 15 §7.4) ─► user: Submit
UI: export "after" images (exportAsync PNG @2x, via the fidelity-export path §14)
UI: POST /v1/dcr (02 §4.1)  |  Download .zip  |  Copy prompt
UI ─► main: branch.meta.patch { status: 'submitted', lastDcr } · devstatus.set(screens)   (one commitUndo)
```

- **Read-only until Submit.** Only the final `branch.meta.patch` and `devstatus.set` write to the document, in one undo step.
- **Approve / Request changes** (`dcr.requireApproval`, [15 §7.4](15-change-requests.md#review)) is a single `branch.meta.patch { approval, status }`, bound to the previewed `dcrHash`.
- **Budget:** snapshot plus extraction take ≤2 s for 200 items. Larger scopes show progress and can be cancelled (verify, S-06).
- **Without the CLI**, the plugin still produces `dcr.json` and `prompt.md`, but with no file:line provenance (`DCR_PROVENANCE_MISSING`).
- Screen specs, with empty, loading, error and success states: [11 §6.15–6.16](11-ux.md#submit) (D-40).
