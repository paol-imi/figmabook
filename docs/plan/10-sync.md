# 10 · Identity & sync

> **Scope:** how holotype recognises what it built before, and updates it **in place**. Designers' instance overrides survive (G5), designer additions survive, designer edits to managed layers are detected and resolved by policy, and every change is previewed first.
>
> **Binding decisions:**
> - **D-19:** shared plugin data namespace `holotype`; keys `sid`, `vk`, `nk`, `irh`, `ah`, `v`; no delete-and-recreate of managed nodes.
> - **D-20:** deprecate, never hard-delete while instances may exist.
> - **D-09:** the plugin is a reconciler.

Contents:
1. Invariants
2. Identity keys & plugin data layout
3. Identity index
4. Stable node keys (`nk`)
5. Keyed in-place reconciliation
6. Component property identity & renames
7. Component & variant lifecycle: add, rename, deprecate, delete
8. Apply plan (diff preview)
9. Designer edits & conflict policies
10. Incremental (Merkle) skipping
11. Override preservation: what is known and what S-02 must prove
12. Sync test-suite
13. Libraries, multiple files, publishing
14. Concurrency
15. Sync status & update discovery
16. Diagnostics
17. Open questions / spikes

---

## 1. Invariants

| # | Invariant | Enforced by |
|---|---|---|
| I-1 | A managed node is **never deleted and recreated** to apply a change of *properties*. Recreation happens only on a *type change* (§5.3), via the snapshot/restore path, and is reported | reconciler |
| I-2 | **A no-op re-sync performs zero document writes** (unchanged bundle + unchanged file) | Merkle skip (§10); fake-op-log test (§12) |
| I-3 | **Unmanaged nodes** (no `holotype/nk`) inside managed components are never modified, moved relative to their managed neighbour, or removed | reconciler |
| I-4 | **No managed property is overwritten** if a designer changed it since our last write, unless the user chose `overwrite` (§9) | `ah` check |
| I-5 | **Component set, variant and component property identity** (Figma node ids, property `#id`s) are stable across syncs | §6, §7 |
| I-6 | **Plugin data on nodes is the source of truth.** The root registry is a rebuildable cache | §2.3, §3 |
| I-7 | **Every write is preceded by a plan the user saw**, except in harness/`auto` mode, which uses the safe defaults | §8 |

---

<a id="keys"></a>
## 2. Identity keys & plugin data layout

All keys live in **shared** plugin data, under the namespace `holotype`: `node.setSharedPluginData('holotype', key, value)`.

- Shared, not private, because other tools, the REST API (`GET /v1/files/:key?plugin_data=shared`), CI and future plugin IDs (D-01 rename → new plugin id!) must be able to read it. Private plugin data is bound to the plugin ID and would be lost if the plugin were re-published under a new ID (research brief §1).
- Values are strings, with at most 100 kB per entry (namespace + key + value).

### 2.1 Per node type

| Node | Keys | Value format |
|---|---|---|
| **ComponentSetNode** (a component) | `sid` | Storybook component id, `components-button` |
| | `nk` | `"set"` |
| | `src` | JSON `{ title, importPath, componentPath?, exportNames: string[], displayName? }`, for rename detection (§7.2) |
| | `axes` | JSON `[{ name: "Size", arg: "size", values: ["sm","md","lg"] }]` |
| | `props` | JSON `{ [arg]: "Show icon#12:3" }`, the persisted property ids (§6) |
| | `irh` | component Merkle hash, 16 hex chars |
| | `ah` | applied hash of set-level managed properties (name, description, property definitions) |
| | `v` | `"<irMajor>.<applierEpoch>"`, e.g. `"1.3"` (§10.2) |
| | `fp` | bundle fingerprint last applied |
| | `status` | `synced \| outdated \| conflict \| partial \| failed \| deprecated` |
| | `syncedAt` | ISO time |
| | `keep` | JSON `{ [nk]: irhAtKeep }`, per-node keep markers (§9.3) |
| | `dep` | ISO time when deprecated (absent if active) |
| **ComponentNode (variant)** | `sid`, `vk`, `nk = "root"`, `irh`, `ah`, `v` | as above |
| | `story` | story id |
| | `args` | canonical JSON of `{ args, globals, state, viewport }`. Truncated to 8 kB with `…` (identity uses `vk`; this is for humans and debugging) |
| | `dep` | if the variant is deprecated |
| **Managed descendant** (frame, text, vector, instance…) | `nk` | node key, unique within its variant (§4) |
| | `irh` | subtree Merkle hash |
| | `ah` | applied hash of this node's managed properties (§9.1) |
| | `v` | (omitted when equal to the variant's, to save writes) |
| **Icon component** | `sid = "icon:<name>"`, `nk = "root"`, `svgh`, `irh`, `ah` | `svgh` = sha256 of the normalized SVG |
| **Doc frame / labels / mode previews** | `sid`, `nk = "doc" \| "doc/…" \| "label/col/i" \| "label/row/j"`, `irh` | regenerated, with no `ah` conflict checks: docs are always ours |
| **Variable / style** | `tok` | CSS name `--color-bg` (or DTCG path) |
| | `ah` | hash of the values per mode, scopes and codeSyntax we wrote |
| | `v` | as above |
| **Any node (designer-set)** | `lock` | `"1"` → this subtree is designer-owned (§9.4) |

**Instance sublayers carry their main component's plugin data.** A sublayer inside *any* instance (ours or a designer's) reads back the main component's keys. The index must therefore exclude:

- nodes whose `id` starts with `I` (instance sublayer ids look like `I<instanceId>;<childId>`);
- nodes that have an `INSTANCE` ancestor below the variant root.

Our own nested instances (managed `kind: 'instance'` nodes) are themselves indexed. Their *children* are not.

### 2.2 Value hygiene

- Hashes use 16 hex characters (64 bits) of sha256 over canonical JSON (`ir` package, [06](06-ir.md#hashing)).
- JSON values are always canonical: sorted keys, no whitespace.
- Writing a key whose value is unchanged is skipped. The applier compares against the index snapshot first.

<a id="root-registry"></a>
### 2.3 Root registry (`figma.root`)

The registry is a cache, so that opening the plugin is fast and the sync status can be shown without scanning pages. It is rebuildable from node data (I-6).

```
figma.root shared plugin data, namespace "holotype":
  registry:meta   = {"v":1,"rev":42,"chunks":3,"fp":"<bundle fp>","updatedAt":"…","session":"<random id>"}
  registry:0..N-1 = JSON string chunks, each ≤ 90 000 bytes (headroom under the 100 kB limit)
  registry:lease  = {"session":"…","expiresAt":"…"}            (§14)
  fontmap         = {"Acme Sans|SemiBold":{"family":"Inter","style":"Semi Bold"}}
  report:meta / report:0..M = last report summary (chunked, capped at 5 chunks)
```

Registry payload (after joining the chunks):

```ts
interface Registry {
  v: 1;
  rev: number;                                     // monotonically increasing; optimistic concurrency (§14)
  storybook: { url?: string; fingerprint: string; version?: string };
  pages: { components: string; icons?: string; deprecated?: string };   // page node ids
  components: Record<string /*sid*/, {
    setId: string; pageId: string; sectionId?: string;
    name: string; irh: string; fp: string; status: SyncStatus;
    variants: number; deprecatedAt?: string; partialVks?: string[];
  }>;
  icons: Record<string /*sid*/, { componentId: string; svgh: string }>;
  images: Record<string /*sha256*/, string /*Figma image hash*/>;
  tokens: Record<string /*css*/, { variableId: string; collectionId: string; library?: boolean }>;
}
```

- **Writing.** Serialize, split into ≤90 kB chunks, write the chunks, then write `registry:meta` *last*. Stale chunks beyond `chunks` are deleted (set to `''`).
- **Reading.** Read meta, then the chunks. If `JSON.parse` fails or the chunk count mismatches, rebuild from the index (`SYNC_REGISTRY_REPAIRED`, info).
- **Image map growth.** About 1,000 images is roughly 100 kB, which is fine with chunking. Past 5,000 images, entries whose image is no longer referenced by any managed node are pruned.

---

<a id="index"></a>
## 3. Identity index

The index is built at the start of each session ([09 §5.2](09-plugin.md#index-stage)).

```ts
interface IdentityIndex {
  sets: Map<string /*sid*/, ComponentSetNode[]>;               // array: duplicates are detectable (§14)
  variants: Map<string /*sid*/, Map<string /*vk*/, ComponentNode>>;
  nodes: Map<string /*vk*/, Map<string /*nk*/, SceneNode>>;
  icons: Map<string /*sid*/, ComponentNode>;
  vars: Map<string /*css*/, Variable>;  styles: Map<string, BaseStyle>;
  unmanagedInManaged: Map<string /*vk*/, SceneNode[]>;          // designer additions (I-3)
  locks: Set<string /*node id*/>;
}
async function buildIndex(port: FigmaPort, pages: PageNode[]): Promise<IdentityIndex> {
  port.skipInvisibleInstanceChildren = true;
  for (const page of pages) {
    await page.loadAsync();
    const hits = page.findAllWithCriteria({ sharedPluginData: { namespace: 'holotype', keys: ['nk'] } });
    for (const n of hits) {
      if (n.id.startsWith('I') || hasInstanceAncestorBelowVariant(n)) continue;   // §2.1
      classify(n);                       // set / variant / descendant / icon / doc
    }
    // second pass: unmanaged children of managed frames (cheap: only walk managed variants' trees)
  }
  return index;
}
```

- **Which pages to scan.** The registry's pages, plus the configured target page, plus the "Deprecated" page. Other pages are scanned only on "Repair index" (an explicit action), because designers may copy managed sets elsewhere. Such copies carry our data, and are detected as **duplicates** (§14).
- **Ancestor resolution.** `vk` for a descendant is resolved by walking `parent` up to the nearest `ComponentNode` with `vk`. Results are memoized per node id.

---

<a id="nk"></a>
## 4. Stable node keys (`nk`)

`nk` values are produced by the `mapper` ([07](07-mapping.md#alignment)). The plugin treats them as opaque. The contract the mapper must honour:

1. **Unique within a variant**, and **aligned across variants**. The same semantic layer has the same `nk` in every variant of the set. This lets Figma's variant-switch override matching (by layer name/hierarchy) and BOOLEAN/TEXT property bindings work. Layer *names* follow the same alignment.
2. **Stable across syncs** when code changes are cosmetic: classes, styles, text.
3. **Derivation priority:**
   1. explicit `data-figma-name` / `data-holotype-key`;
   2. `data-testid`;
   3. framework component boundary name plus role (`Icon`, `Label`);
   4. ARIA role or name;
   5. a path signature `parentNk/<tag>.<first-semantic-class>[#k]`, where `k` is the index among siblings with the same signature.

   Hashed CSS-module and CSS-in-JS classes are ignored.
4. **Human-readable**: `root/content/label`, `root/icon-leading`. They appear in diagnostics and the report.
5. **Type-stable** (requirement on the mapper):
   - Element boxes are always `FRAME` (never `RECTANGLE`) for managed nodes, so that adding a child or a background never changes the node type.
   - The instance-vs-frame decision for nested components uses **hysteresis**: keep the previous kind if it still verifies within tolerance.
   - The previous kinds are passed to the mapper via the cache ([07](07-mapping.md#alignment)).

   These rules minimize type changes (§5.3).

If a mapper change alters `nk` derivation (a new `irMajor` or `applierEpoch`), the bundle carries an **`nkMigrations`** table (`oldNk → newNk` per component), and the plugin renames keys before reconciling. This avoids mass recreation.

---

<a id="reconcile"></a>
## 5. Keyed in-place reconciliation

### 5.1 Component level

```
for each component C in plan (topological order, 09 §5.5):
  set = index.sets[C.sid]?.[0]
  if !set: CREATE (09 §7.2 first build) ; continue
  if C.irh == set.irh && set.v == current: SKIP (Merkle)               // §10
  for each variant V in C.variants:
    comp = index.variants[C.sid][V.vk]
    if !comp: ADD VARIANT (09 §7.2)
    elif V.irh == comp.irh && comp.v == current: skip
    else: reconcileNode(comp, V.root)
  for each existing variant not in C: DEPRECATE VARIANT (§7.4)
  reconcile properties (§6), grid, docs
```

### 5.2 Node level: keyed children diff

```ts
function reconcileNode(n: SceneNodeLike, d: SceneNode, ctx: Ctx) {
  if (isLocked(n)) return ctx.diag('SYNC_LOCKED_SKIPPED', d);
  if (d.irh === n.getSharedPluginData('holotype', 'irh') && ctx.sameEpoch(n)) return;    // subtree unchanged
  if (ctx.conflict(n, d) === 'keep') return markKeep(n, d);                                 // §9
  writeOwnProps(n, d);                                   // 09 §6 rules, update mode: write only changed fields
  reconcileChildren(n as ChildrenMixin, d.children, ctx);
  writeIdentity(n, d);                                   // irh, ah (recomputed from read-back, §9.1)
}

function reconcileChildren(parent: ChildrenMixin, desired: SceneNode[], ctx: Ctx) {
  const current = [...parent.children];
  const byNk = new Map(current.filter(isManaged).map(c => [nkOf(c), c]));
  // 1. place desired managed nodes, in order; unmanaged nodes keep their position relative to the managed node before them
  let cursor = -1;                                        // index of last placed managed node in parent.children
  for (const d of desired) {
    let n = byNk.get(d.nk) ?? ctx.index.findMoved(ctx.vk, d.nk);  // moved from another parent in the same variant
    if (n && !typeCompatible(n, d)) n = replaceForTypeChange(n, d, ctx);   // §5.3
    if (!n) n = createAndWrite(parent, d, ctx);                    // 09 §6 (create path)
    const target = indexAfter(parent, cursor);                     // right after the previous managed node (+ any unmanaged followers)
    if (n.parent !== parent || parent.children.indexOf(n) !== target) parent.insertChild(target, n);  // move/reorder, keeps node id
    reconcileNode(n, d, ctx);
    cursor = parent.children.indexOf(n);
    byNk.delete(d.nk);
  }
  // 2. orphans LAST: managed children no longer desired
  for (const [nk, orphan] of byNk) ctx.removeOrphan(orphan, nk);     // remove (default) or hide (option); reported with impact
}
```

Notes:

- **Moves keep identity.** `insertChild` on an existing node moves it and keeps its node id. Instance override mapping by internal id should therefore survive moves *within* the component (verify, S-02). Cross-parent moves are found via `index.findMoved` (same variant, same `nk`, different parent).
- **Orphan removal policy** (`sync.orphans`): `'remove'` (default) or `'hide'` (`visible = false`, and kept with `holotype/orphan = "1"`; if the `nk` returns, the node is revived with its overrides intact). Removal reports `SYNC_NODE_REMOVED`, with the local instance count of the variant as impact.
- **Unmanaged nodes** are never in `byNk`, so they are never removed. The cursor logic keeps them right after the managed sibling they followed.
- **Designer-deleted managed nodes** (in the registry or the parent's previous `irh`, but absent now) are re-created and reported as `SYNC_MANAGED_NODE_DELETED` (info). With policy `keep`, they stay deleted: the `keep` marker records it.

### 5.3 Type changes: snapshot and restore

Figma node types can't be converted in place (FRAME ↔ TEXT ↔ INSTANCE ↔ VECTOR). A type change forces recreation, which orphans overrides keyed to the old node id. Path:

```
1. instances = await variantComponent.getInstancesAsync()           // LOCAL file only
2. for each instance: for each o in instance.overrides where o.id maps to the old node (id suffix ";<oldId>" or deeper):
      snapshot { instanceId, relPath(nk + sub-path), fields: o.overriddenFields, values: read(field) }
3. create the new node (09 §6), insert at the same index, write identity (same nk), then remove the old node
4. for each snapshot: locate sublayer in instance by nk path → for each field compatible with the new type
      (fills, strokes, effects, opacity, visible, characters/text style when TEXT→TEXT-like) → re-apply
5. report SYNC_TYPE_CHANGE_RECREATE (warn) with { restored, dropped } and SYNC_OVERRIDES_AT_RISK for cross-file consumers
```

Instances in **other files** (library consumers) can't be reached, so their overrides on that node are lost on the next library update. The plan flags type changes as **breaking** (§8.3), so the user sees them before applying.

---

<a id="prop-renames"></a>
## 6. Component property identity & renames

- **The identity of a component property is its full name including `#id`** (`"Label#4:2"`) for BOOLEAN, TEXT, INSTANCE_SWAP and SLOT, and its plain name for VARIANT.
- We key by **Storybook arg name** in the set's `holotype/props` map ([09 §8](09-plugin.md#props)). The *Figma display name* is free to change.

| Code change | Action | Instance effect |
|---|---|---|
| Arg display label changed (e.g. `argTypes.label.name`) | `editComponentProperty(id, { name })` returns the new name string; store it | values kept (verify, S-02) |
| Arg renamed in code (`label` → `text`) | detected when the old arg disappears and a new arg has the same type, the same bound `nk`s and ≥80% equal default/values: **treated as a rename**. Remap the props entry; optionally edit the display name | values kept (same property id) |
| Arg removed | keep the property and its bindings (so instances still render their value); rename its display name to `… (deprecated)`. Delete only via the prune action | values kept |
| Arg type change (BOOLEAN → VARIANT) | new property; the old one is deprecated. **Breaking** | values not transferable; reported |
| Default value changed | `editComponentProperty(id, { defaultValue })` | instances that never overrode it follow the new default |
| VARIANT axis renamed (arg renamed) | `set.editComponentProperty(axisName, { name: newName })`, detected like the arg rename above, plus value-set equality | values kept (verify, S-02) |
| VARIANT value renamed (`primary` → `brand`) | detected when values map 1:1 by variant structure similarity (same `nk` set, same `irh` modulo the renamed token): rename the variants | instances switch with them (verify, S-02) |

**Rule: never delete and re-add a property to "rename" it.** Deleting a property drops every instance's value for it.

---

<a id="deprecation"></a>
## 7. Component & variant lifecycle: add, rename, deprecate, delete

### 7.1 Add

New `sid` → create (09 §7.2). New `vk` in an existing set → add a variant (09 §7.2). Both are non-breaking.

### 7.2 Component rename detection

The story title changed, so `sid` changed. Candidates are pairs of (registry `sid` absent from the bundle, bundle `sid` absent from the registry). Scoring:

| Evidence | Weight |
|---|---|
| same `componentPath` (index.json), or same `importPath` + overlapping `exportNames` | 0.5 |
| same `displayName` / docgen component name | 0.2 |
| Jaccard(axes ∪ property args) | 0.15 |
| default-variant structural similarity: Jaccard of `nk` sets | 0.15 |

- score ≥ 0.85 → proposed **rename**, pre-checked in the plan.
- 0.6 ≤ score < 0.85 → proposed rename, unchecked (`SYNC_RENAME_AMBIGUOUS`, info).
- < 0.6 → delete (deprecate) + add.
- Each old `sid` is matched to at most one new `sid`, assigned greedily by the highest score.

Applying a rename:

1. Rewrite `sid` on the set, its variants, the doc frame and the labels.
2. Update `src`.
3. Rename the set to the new display name.
4. Move it to the new section if the title path changed.

Node ids are unchanged, so instances everywhere keep working (`SYNC_RENAME_DETECTED`, info).

### 7.3 Variant rename

`vk` changes whenever the canonical args change: an arg renamed, a default changed, a fixed arg added. Old variants absent from the bundle are mapped to new variants using two tests:

1. the axis values map 1:1 (after applying the arg/axis renames of §6);
2. the default-variant structure is equal (same story, same `nk` set).

A mapped pair is reconciled **in place**: the old ComponentNode gets the new `vk` and the new name. Unmapped old variants are deprecated (§7.4).

### 7.4 Deprecation (D-20)

| Item | Deprecation action | Un-deprecation (it reappears in code) |
|---|---|---|
| Component (set) | Move the set to the page "Deprecated" (`deprecatedPage.appendChild(set)`), which keeps node ids and library keys (verify, S-02). Rename it to `⚠ Deprecated / <name>`. Set `dep`. Prefix the description with `[Deprecated <date>] Removed from Storybook.` Add a banner to the doc frame. Status `deprecated` | Move back to its section, restore the name and description, clear `dep` |
| Variant | Lazily add a VARIANT axis `Deprecated` (`set.addComponentProperty('Deprecated', 'VARIANT', 'false')`) on the first deprecation. Rename the variant to `…, Deprecated=true`. Move it to the end of the grid, rendered at 40% opacity in the grid wrapper only (the component itself is untouched). Set `dep` | Rename back to `Deprecated=false`. If no deprecated variants remain, the axis stays: removing it would rename every variant, so it is only removed by the prune action |
| Component property | Display name suffix ` (deprecated)` (§6) | Restore the name |
| Variable | Description prefix `[deprecated] ` ([08 §12](08-tokens.md#sync)) | Restore |

### 7.5 Delete (prune)

- Hard deletion is **never automatic**. The explicit plugin action "Prune deprecated…" (or `holotype prune` via the harness) lists deprecated items older than `sync.pruneAfterDays` (default 30).
- For each item it shows `await node.getInstancesAsync()`, which counts **this file only**. It warns that library consumers can't be counted.
- It requires typing the component name for sets that have instances.
- Deletion is reported in the report and in the library release notes (§13).

---

<a id="apply-plan"></a>
## 8. Apply plan (diff preview)

### 8.1 Data model

```ts
interface ApplyPlan {
  id: string; createdAt: string;
  bundle: { fingerprint: string; irVersion: string; storybookVersion?: string };
  registryRev: number;                                  // optimistic concurrency (§14)
  summary: { create: number; update: number; unchanged: number; deprecate: number; undeprecate: number;
             rename: number; conflicts: number; breaking: number };
  tokens: TokenChange[];                                // 08 §12
  components: ComponentChange[];
}
interface ComponentChange {
  sid: string; name: string; titlePath: string[];
  action: 'create' | 'update' | 'unchanged' | 'deprecate' | 'undeprecate' | 'rename';
  rename?: { fromSid: string; score: number; evidence: string[] };
  variants: { added: string[]; updated: string[]; deprecated: string[]; renamed: [string, string][]; unchanged: number };
  properties: { added: string[]; edited: string[]; deprecated: string[]; axesAdded: string[]; axesRenamed: [string, string][] };
  conflicts: Conflict[];
  breaking: BreakingChange[];                           // §8.3
  impact?: { localInstances: number; overridesAtRisk: number };   // computed lazily on expand (getInstancesAsync is costly)
  preview?: { vk: string; beforeExport?: 'lazy'; afterAsset: string /*sha of bundle screenshot*/ }[];
  diagnostics: { error: number; warn: number; info: number };
  decision: { apply: boolean; conflictPolicy: ConflictPolicy };     // defaults (§9.2), user-editable
}
interface Conflict {
  vk: string; nk: string; kind: 'edited' | 'deleted' | 'moved' | 'locked' | 'kept-stale';
  fields?: string[];                                    // which managed property groups differ (§9.1)
  policy: ConflictPolicy;                               // per-node override of the component default
}
type ConflictPolicy = 'overwrite' | 'keep' | 'fork';
interface PlanDecisions {                               // UI → main on 'apply.start' (09 §3.2)
  components: Record<string /*sid*/, { apply: boolean; conflictPolicy?: ConflictPolicy;
                                       nodePolicies?: Record<string /*vk:nk*/, 'overwrite' | 'keep'>; acceptRename?: boolean }>;
  tokens: Record<string /*change id*/, boolean>;
}
```

### 8.2 UX hooks

The screens are in [11](11-ux.md#plugin).

- **Grouping.** Components are grouped by action. Breaking changes and conflicts float to the top.
- **Visual diff per changed variant.** *Before* = lazy `exportAsync` of the current variant (rendered only when expanded). *After* = the bundle's Playwright screenshot asset. Modes: side by side, overlay (opacity slider), or difference (computed in the UI canvas).
- **Conflict rows** show the property groups the designer changed, with per-node policy toggles.
- **Footer:** "Apply N components · M token changes". Applying is disabled while any `breaking` item is unacknowledged.

### 8.3 Breaking-change classification

This classification is used for the plan and for the release notes.

| Class | Examples |
|---|---|
| **Breaking** | variant deprecated; axis removed or renamed without a mapping; property type change; property deprecated; node **type change** in a node with local overrides; set deprecated |
| **Additive** | new component, variant, axis value or property |
| **Visual** | property values or geometry changed with structure intact |

---

<a id="designer-edits"></a>
## 9. Designer edits & conflict policies

### 9.1 Applied hash (`ah`)

After writing a node (and after any verification fallback), the applier **reads back** the node's *managed property groups*, normalizes them, and stores `ah = h16(canonical(groups))`. Reading back, rather than hashing the Scene values, avoids false conflicts from Figma's own normalization (float rounding, derived values).

| Group | Properties read |
|---|---|
| `geom` | `width`, `height`; `x`, `y` only when absolute or not in auto layout; `rotation` |
| `layout` | `layoutMode`, `layoutWrap`, padding×4, `itemSpacing`, `counterAxisSpacing`, align props, sizing modes, `layoutSizingHorizontal/Vertical`, `layoutPositioning`, `min/max*`, grid props |
| `paint` | `fills`, `strokes`, stroke weights/align/dash, radii, `effects`, `opacity`, `blendMode`, `clipsContent` (paints serialized including `boundVariables`) |
| `text` | `characters`, `getStyledTextSegments(['fontName','fontSize','lineHeight','letterSpacing','fills','textCase','textDecoration','hyperlink','boundVariables'])`, `textAutoResize`, alignment, truncation |
| `vis` | `visible`, `name` |
| `bind` | `componentPropertyReferences`, `boundVariables` |
| `inst` | for instances: `mainComponent` id (`getMainComponentAsync`), `componentProperties` values |

Normalization: floats rounded to 1e-3, colors to 1e-4, then canonical JSON.

**Cost control.** `ah` is recomputed and compared **only for nodes the plan intends to write**, meaning those whose `irh` changed. If code didn't change a node, designer edits to it are irrelevant: we don't write it, so there is no conflict (I-4).

The mismatch report includes *which groups* differ, by comparing per-group sub-hashes that are stored concatenated in `ah`: `ah = "<geom8><layout8><paint8><text8><vis8><bind8>"`.

### 9.2 Policies

| Policy | Granularity | Effect |
|---|---|---|
| `overwrite` | component or node | write code values; the designer's managed-property changes are lost (old values are logged in the report) |
| `keep` | component or node | skip writing this node's managed properties **and its subtree**; record `keep[nk] = irhAtDecision` on the set |
| `fork` | component | before overwriting, duplicate the set (`set.clone()`) into section "Forks", strip all `holotype` keys from the clone (so it becomes unmanaged), rename it `<name> (designer copy <date>)`, then overwrite the original |

Defaults (`sync.conflicts`):

- **Interactive:** component default `ask`. The plan pre-selects `keep` for nodes with conflicts, and the user must look at them before applying.
- **Harness/auto/CI:** `keep`, which is safe and never loses designer work.
- **Configurable:** a per-component default in `holotype.config.ts` → `components[sid].conflicts`.

### 9.3 Keep markers

On later syncs, a kept node is skipped while `irh` (code) equals `keep[nk]`. When code changes again (the bundle `irh` ≠ the keep marker), it is a **new conflict**: `kind: 'kept-stale'`, `SYNC_KEEP_STALE` (warn). The user is asked again, so code changes are never silently ignored forever.

### 9.4 Locks & unmanaged layers

- **`holotype/lock = "1"`** is set via the plugin's "Lock layer (designer-owned)" action on any managed node, or on the set. It skips that subtree on every sync and shows a 🔒 in the report. This is an explicit, durable `keep`.
- **Unmanaged additions** (annotations, extra layers a designer added inside a variant) are preserved (I-3), but they may break auto layout geometry. Verification ignores unmanaged nodes when computing deltas, but runs with them present. If a fallback triggers *because* of an unmanaged node, the report says so (`SYNC_UNMANAGED_AFFECTS_LAYOUT`, info).
- **Recommended practice**, printed in the doc frame: annotate *outside* the set, or use locks.

---

<a id="merkle"></a>
## 10. Incremental (Merkle) skipping

### 10.1 Hashes

The mapper computes them ([06](06-ir.md#hashing)):

- `node.irh = h16(canonical(ownManagedProps(node)) + children.map(c => c.irh).join(''))`
- `variant.irh = root.irh`
- `component.irh = h16(variants' irh in vk order + axes + properties + docs + name)`

Bindings and token *names* are part of `ownManagedProps`, but token *values* are not. A token value change is applied once to the variable, and nodes don't change.

### 10.2 Epochs

`v = "<irMajor>.<applierEpoch>"`. `applierEpoch` is a constant in the plugin, bumped whenever the applier would write different output *for the same Scene IR* (e.g. a bug fix in stroke mapping). A mismatching `v` invalidates the skip for that node, and the plan shows it as "update (plugin upgrade)".

### 10.3 Skip levels

1. Component.
2. Variant.
3. Subtree.

A no-op sync touches nothing (I-2). The fake-backed test asserts an empty op-log (§12).

---

<a id="overrides"></a>
## 11. Override preservation: what is known and what S-02 must prove

| # | Known or reported behaviour | Source | Consequence for design |
|---|---|---|---|
| K-1 | Instance sublayer ids are derived from the main component's node ids (`I<inst>;<child>`). Overrides attach to them | Plugin typings / observed ids; forum reports of overrides lost when a plugin *replaces* content | in-place mutation (I-1) |
| K-2 | Text overrides survive swaps when the text layer **name** and hierarchy match | Figma Help Center (research brief §2) | aligned names across variants ([07](07-mapping.md#alignment)) |
| K-3 | `swapComponent` preserves overrides by heuristics; assigning `mainComponent` clears them | Plugin API docs | [09 §10.2](09-plugin.md#nested) |
| K-4 | Variant switching matches overrides by layer name and hierarchy | Figma Help Center | aligned `nk` and names |
| K-5 | Component property values live on the instance, keyed by property id | Plugin API (`componentProperties`) | prefer TEXT/BOOLEAN props over raw overrides (D-13) |
| K-6 | Nested instance overrides are fragile across variant changes | forum bug reports | report impact; S-02 measures it |

### 11.1 S-02 test matrix (must be run before Phase 4 exit)

The matrix is mutations on the main component (rows) × override kinds on an instance (columns). Each cell gets ✅ kept / ❌ lost / ⚠ partially kept, recorded both **in the same file** and **across files** (library publish → consumer update).

Mutations (rows):

1. property change on an overridden node (fill, size)
2. rename layer
3. reorder siblings
4. move within the same parent's subtree (reparent)
5. wrap the node in a new frame
6. remove and re-add a node with the same name (new id)
7. type change (frame → text), with snapshot/restore
8. change the parent's `layoutMode`
9. add a sibling
10. remove a sibling
11. rename a variant (value rename)
12. rename an axis (`editComponentProperty`)
13. add an axis
14. `set.appendChild(newVariant)`
15. `editComponentProperty` display-name rename (TEXT/BOOLEAN)
16. change a property default value
17. move the set to another page or section
18. change a bound variable value
19. `swapComponent` of a nested instance inside the main component

Override kinds (columns):

- fill color
- stroke
- effect
- opacity
- visibility
- text characters (raw)
- text style range
- TEXT property value
- BOOLEAN property value
- INSTANCE_SWAP value
- nested instance's own property
- resized instance (FIXED width)
- layer added inside the instance (slot)

Outcome: the matrix is checked into `docs/research/s02-override-matrix.md`. Any ❌ in a row that the reconciler relies on changes this chapter. For example, if reparenting loses overrides, `findMoved` is disabled and a structural move becomes a breaking change.

---

<a id="test-suite"></a>
## 12. Sync test-suite

The test-suite runs in two layers:

- **(L) logic**, on `figma-fake`, on every PR;
- **(F) Figma semantics**, nightly on real Figma desktop (harness, [12](12-quality.md#harness)) and in S-02.

| # | Scenario | Expected | Layer |
|---|---|---|---|
| T-01 | Apply bundle B twice | 2nd run: op-log empty; status `synced` | L |
| T-02 | Text change in one variant | only that TEXT node written; other variants untouched; instance text override kept | L + F |
| T-03 | Token value change | only the variable value written; no node writes | L |
| T-04 | Add variant (new arg value) | appended to the existing set; set id unchanged; existing instances unaffected | L + F |
| T-05 | Remove variant | `Deprecated=true`; set id unchanged; instance using it still renders | L + F |
| T-06 | Add axis | `addComponentProperty(VARIANT)`; old variants get the default value | L + F |
| T-07 | Rename arg `kind`→`variant` (axis rename) | `editComponentProperty` rename; instance values kept | L + F |
| T-08 | Rename story title | rename detected ≥0.85; `sid` rewritten; node ids unchanged | L |
| T-09 | Reorder children in code | `insertChild` moves only; no create/remove | L + F |
| T-10 | Wrapper div inserted | the new frame is created, the old children are moved into it (same ids) | L + F |
| T-11 | Node type change (span gains child → frame) | snapshot/restore; restored overrides reported | L + F |
| T-12 | Designer edits the fill of a managed node; code unchanged | no conflict, no write | L |
| T-13 | Designer edits a fill; code changes the same node | conflict; `keep` → skipped + marker; later code change → `kept-stale` | L |
| T-14 | `overwrite` policy | code value written; old value logged | L |
| T-15 | `fork` policy | unmanaged clone in "Forks"; original overwritten | L |
| T-16 | Designer adds an unmanaged layer in a variant | preserved at its relative position across syncs | L + F |
| T-17 | Lock on a subtree | never written; reported | L |
| T-18 | Component removed from code | moved to "Deprecated"; un-deprecated when restored | L + F |
| T-19 | Crash after 3 of 10 components (fault injection in the fake) | resume completes; no duplicates; registry repaired | L |
| T-20 | Two sessions plan concurrently | the second apply sees `rev` changed → `SYNC_STALE_PLAN`, re-plan | L |
| T-21 | Duplicate set (designer copy-pasted a managed set) | `SYNC_DUPLICATE_SID`; the copy is offered for unmanaging | L |
| T-22 | Library consumer file: update after T-02/T-04/T-07/T-11 | overrides per the S-02 matrix expectations | F |
| T-23 | Plugin `applierEpoch` bump | every node re-written once; then a no-op | L |
| T-24 | `nkMigrations` in the bundle | keys renamed; no recreation | L |
| T-25 | Property display-name change | id kept (`editComponentProperty`); instance values kept | L + F |

**Metric:** override retention (README §4) = kept / total over T-02, T-04, T-07, T-09, T-10, T-16 and T-22 in layer F. The target is 100%.

---

## 13. Libraries, multiple files, publishing

- **No publishing via API.** Neither the Plugin API nor the REST API can publish a library. After a sync, the plugin shows "Publish library to propagate N changes" and offers **"Copy release notes"**: generated from the plan, grouped Breaking, Added, Changed, ready to paste into Figma's publish dialog. Copying happens in the UI via a textarea + `document.execCommand('copy')` fallback (verify, S-06).
- **Consumer files** get the changes when they accept library updates. Override survival there follows the same rules (S-02, cross-file column). Breaking changes are flagged before applying (§8.3).
- **One managing file per component.** `holotype.config.ts` → `figma.files: [{ name: 'Core', include: ['inputs/**', 'buttons/**'] }, { name: 'Patterns', include: ['patterns/**'] }]`, and the bundle can be scoped per file (`holotype export --file Core`).
- **Cross-file nested instances**, e.g. Patterns using Core's Button: the Core file's registry exports `sid → published component key` (the "Export keys" action writes `keys.json` back to the CLI over the local server). Patterns' bundle then references `libraryComponents[sid] = key`, resolved with `importComponentByKeyAsync` ([09 §5.1](09-plugin.md#preflight)). The library must be published and enabled in the consuming file.
- **Branches.** Figma branching works naturally: sync into a branch, review, merge. Plugin data merges with the branch (verify, S-02). Recommended for big upgrades.

---

## 14. Concurrency

Figma is multiplayer, and two people may sync the same file.

1. **Lease.**
   - At `apply.start`, main reads `registry:lease`. If it is held by another session and not expired, apply is blocked with `SYNC_LEASE_HELD` (warn) and the message "Another sync is running (started 40s ago)".
   - Otherwise main writes `{session, expiresAt: now + 120s}` and renews it every 30s during apply. It is cleared in finalize.
   - Lease writes propagate through multiplayer within seconds (verify, S-06). The lease is advisory, not a lock.
2. **Optimistic check.** The plan records `registryRev`. At apply start, a changed `rev` gives `SYNC_STALE_PLAN` and an automatic re-plan. Finalize writes `rev + 1`.
3. **Duplicate detection.** After apply, or at the next index, more than one set with the same `sid` gives `SYNC_DUPLICATE_SID` (warn).
   - The set referenced by the registry (`setId`) wins.
   - For the others, the plugin offers to **unmanage** them (strip `holotype` keys, append " (copy)"), never to delete them.
   - This also catches designers copy-pasting managed sets.

---

## 15. Sync status & update discovery

| Status | Condition | Shown as |
|---|---|---|
| `synced` | set `irh` = bundle `irh`, `fp` current, no open conflicts | ✓ |
| `outdated` | the bundle (or the latest known source) has a different `irh` | ↻ N variants changed |
| `conflict` | the last plan left conflicts unresolved, or `kept-stale` markers exist | ⚠ |
| `partial` / `failed` | the last apply was cancelled or errored ([09 §13](09-plugin.md#resume)) | ⟳ resume |
| `deprecated` | removed from code | ⊘ |
| `locked` | set-level lock | 🔒 |

**How the plugin learns about new versions.** The plugin can't run in the background; checks happen when it opens.

| Source | Check |
|---|---|
| Local server (A) | `GET /v1/manifest` returns `{fingerprint, components: {sid: irh}}`, a tiny response. Compare it with the registry |
| Registry (D) | `GET https://registry…/<project>/latest.json`, the same manifest shape |
| File import (B) | compared once the file is loaded |

Statuses are recomputed and written to the registry only (not to nodes) until a sync runs.

- **Outside Figma.** `holotype status --figma-file <key>` (CLI, using a Figma REST token) reads the file's root shared plugin data via `GET /v1/files/:key?plugin_data=shared&depth=1` and compares it with the local bundle (verify REST support for root plugin data; proposed spike S-14). The GitHub Action uses this to comment "Figma library is 4 components behind" on PRs ([02](02-architecture.md#topologies)).
- The doc frame badge and the relaunch button ("Re-sync from Storybook") give designers a one-click path.

---

## 16. Diagnostics

| Code | Severity | Meaning |
|---|---|---|
| `SYNC_REGISTRY_REPAIRED` | info | registry missing or corrupt; rebuilt from node plugin data |
| `SYNC_DUPLICATE_SID` | warn | more than one set claims the same component id |
| `SYNC_RENAME_DETECTED` | info | component or variant rename applied in place |
| `SYNC_RENAME_AMBIGUOUS` | info | rename candidate below auto threshold; needs confirmation |
| `SYNC_CONFLICT` | warn | designer edited a managed node that code also changed |
| `SYNC_KEEP_STALE` | warn | a kept node's code changed again; re-asking |
| `SYNC_LOCKED_SKIPPED` | info | locked subtree skipped |
| `SYNC_MANAGED_NODE_DELETED` | info | a designer deleted a managed node; re-created (or kept deleted under `keep`) |
| `SYNC_NODE_REMOVED` | info | managed node removed because it no longer exists in code (impact: instance count) |
| `SYNC_TYPE_CHANGE_RECREATE` | warn | node type change forced recreation; overrides restored/dropped counts |
| `SYNC_OVERRIDES_AT_RISK` | warn | change may drop overrides in library consumer files |
| `SYNC_BREAKING_CHANGE` | warn | breaking change in plan (§8.3); requires acknowledgement |
| `SYNC_DEPRECATED` / `SYNC_UNDEPRECATED` | info | lifecycle transitions |
| `SYNC_LEASE_HELD` | warn | another session holds the sync lease |
| `SYNC_STALE_PLAN` | info | registry changed since planning; re-planned |
| `SYNC_UNMANAGED_AFFECTS_LAYOUT` | info | an unmanaged designer layer caused a layout fallback |

---

## 17. Open questions / spikes

1. **S-02** (critical, Phase 4 gate): the full §11.1 matrix, same-file and cross-file. In particular:
   - whether `insertChild` reparenting keeps override identity;
   - whether `set.appendChild(component)` keeps links;
   - whether moving a set across pages keeps library keys;
   - whether plugin data survives branch merges.
2. **S-06:** lease propagation latency in multiplayer; `getInstancesAsync` cost on large files (bounds the plan's lazy `impact`); clipboard copy from the plugin UI.
3. **Proposed S-14** (new): REST read of root shared plugin data for CI status checks (`plugin_data=shared` on the document node).
4. Whether hashing per-group `ah` by reading `getStyledTextSegments` is fast enough on text-heavy components (part of S-06).
