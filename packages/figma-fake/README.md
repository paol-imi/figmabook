# @holotype/figma-fake

An in-memory Figma document behind the plugin's `FigmaPort` (BUILD §8, [09 §18](../../docs/plan/09-plugin.md#testing)).
Applier tests in `packages/plugin` run against it instead of the real Plugin API.

- **Typed by Figma.** `createFakeFigma()` satisfies `FigmaPort` (a `Pick<>` of
  `@figma/plugin-typings@1.142.0`, see `packages/plugin/src/port.ts`) with no casts. Every node
  it returns is a class that structurally implements the typings interface (`FrameNode`,
  `TextNode`, …), built from one mixin per typings mixin, so a node has exactly the members its
  type has (`'layoutMode' in text` is `false`, as in Figma).
- **Throws where Figma throws**, with the same class (`Error`, or `TypeError` for mutating a
  frozen value) and the same `in <api>:` message prefix. Every emulated rule cites its source in
  the code: a docs URL or `typings:<line>` (a line of `plugin-api.d.ts` in the pinned typings).
- **Records every write** in an operation log, so "a no-op re-sync makes zero writes"
  (I-2, [10 §1](../../docs/plan/10-sync.md)) is one assertion.
- **Fails loudly** on members it does not model yet: they throw `NotImplementedError` naming
  the work item that adds them. No test can pass on behaviour the fake does not emulate.

## Usage

```ts
import { createFakeFigma } from '@holotype/figma-fake';

const figma = createFakeFigma({ pages: ['Cover', 'Components'] });
await applyBundle(figma, bundle); // the applier takes a FigmaPort
expect(figma.snapshot()).toMatchSnapshot();

figma.reset(); // "close and reopen the plugin"
await applyBundle(figma, bundle);
expect(figma.ops()).toEqual([]); // no-op re-sync
```

## Public API

| Export                                                                                                                    | Description                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFakeFigma(options?)`                                                                                               | A new fake document. Returns `FakeFigma`                                                                                                                                                                                                                                                                                        |
| `FakeFigma`                                                                                                               | `FigmaPort & FakeControls`                                                                                                                                                                                                                                                                                                      |
| `FakeFigmaOptions`                                                                                                        | `fonts` (available fonts, default Inter Regular/Italic/Medium/Semi Bold/Bold and Roboto Regular/Medium/Bold), `pages` (initial page names, default `['Page 1']`), `fileKey`, `fileName` (`figma.root.name`), `pluginId` (scopes private plugin data, default `holotype`), `sessionId` (node ids are `<session>:<n>`, default 1) |
| `FakeControls.snapshot()`                                                                                                 | `FakeTree`: canonical JSON of the document (see below)                                                                                                                                                                                                                                                                          |
| `FakeControls.ops()`                                                                                                      | `readonly Op[]`: every document write since creation or the last `reset()`                                                                                                                                                                                                                                                      |
| `FakeControls.reset()`                                                                                                    | Simulates a new plugin run on the same document: clears ops and notifications, unloads fonts, unloads every page except the current one, restores `skipInvisibleInstanceChildren`. Keeps the document and `clientStorage`                                                                                                       |
| `FakeControls.notifications()`                                                                                            | Messages passed to `notify()`                                                                                                                                                                                                                                                                                                   |
| `FakeControls.getNodeById()`                                                                                              | Exists on the real API but throws under `documentAccess: "dynamic-page"` (typings:422-427)                                                                                                                                                                                                                                      |
| `Op`                                                                                                                      | `{ method, nodeId, property, value }` (see "Operation log")                                                                                                                                                                                                                                                                     |
| `FakeTree`, `FakeNodeSnapshot`, `FakeNodeType`, `JsonValue`                                                               | Snapshot types                                                                                                                                                                                                                                                                                                                  |
| `DEFAULT_FONTS`, `MIN_SIZE` (0.01), `MAX_IMAGE_SIZE` (4096), `PLUGIN_DATA_LIMIT` (100 000 bytes), `MIXED_JSON`, `TYPINGS` | Constants                                                                                                                                                                                                                                                                                                                       |

### Snapshot

`snapshot()` returns `{ document, currentPage, images }`. Each node lists `id`, `type`, `name`,
then `x`, `y`, `width`, `height` (and `relativeTransform` when rotated), plugin data
(`pluginData`, `sharedPluginData`, `relaunchData`), every property whose value differs from a
newly created node of the same type, derived `layoutSizingHorizontal`/`Vertical` when not
`FIXED`, `variantProperties` for variants, text as `characters` plus `textStyle` runs (fields
that differ from a new text node), `loaded: false` for unloaded pages, then `children`. Keys
are sorted, so `JSON.stringify(snapshot())` gives the same bytes for the same document.

### Operation log

| Write                                           | Op                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `node.opacity = 0.5`                            | `{ method: 'set', nodeId, property: 'opacity', value: 0.5 }`                                     |
| `node.resize(10, 20)`                           | `{ method: 'resize', nodeId, property: null, value: { width: 10, height: 20 } }`                 |
| `figma.createFrame()`                           | `{ method: 'createFrame', nodeId: <new id>, property: null, value: null }`                       |
| `parent.insertChild(1, c)`                      | `{ method: 'insertChild', nodeId: <parent>, property: null, value: { index: 1, child: <id> } }`  |
| `node.setSharedPluginData('holotype', 'nk', v)` | `{ method: 'setSharedPluginData', nodeId, property: 'holotype/nk', value: v }`                   |
| `text.setRangeFontSize(0, 2, 20)`               | `{ method: 'setRangeFontSize', nodeId, property: null, value: { start: 0, end: 2, value: 20 } }` |
| `figma.createImage(bytes)`                      | `{ method: 'createImage', nodeId: null, property: null, value: { hash } }`                       |

Every assignment is logged, even one that stores the value already there. A write that throws
is not logged. Reads, `loadFontAsync`, `loadAsync`, `setCurrentPageAsync`, `selection`,
`notify`, `commitUndo` and `clientStorage` are not document writes and are not logged.

## Surface (B-06: BUILD §8.1 rows "Global" to "Text")

| Area               | Modelled                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global             | `createFrame`, `createComponent`, `createText`, `createRectangle`, `createEllipse`, `createVector`, `createSection`, `createPage`, `createNodeFromSvg` (paths only), `combineAsVariants`, `createImage`, `getImageByHash`, `getNodeByIdAsync`, `loadFontAsync`, `listAvailableFontsAsync`, `root`, `currentPage`, `setCurrentPageAsync`, `mixed`, `skipInvisibleInstanceChildren`, `fileKey`, `notify`, `commitUndo`, `clientStorage`                                        |
| BaseNode           | `id`, `type`, `name`, `parent`, `removed`, `remove()`, `toString()`, plugin data (private and shared), relaunch data                                                                                                                                                                                                                                                                                                                                                         |
| Children           | `children`, `appendChild`, `insertChild`, `findChildren`, `findChild`, `findAll`, `findOne`, `findAllWithCriteria`; page `loadAsync`                                                                                                                                                                                                                                                                                                                                         |
| Geometry           | `x`, `y`, `width`, `height`, `relativeTransform`, `rotation`, `absoluteTransform`, `absoluteBoundingBox`, `resize` (with constraints), `resizeWithoutConstraints`, `constraints`, min/max sizes, `layoutSizingHorizontal`/`Vertical`, `layoutAlign`, `layoutGrow`, `layoutPositioning`, auto-layout frame properties                                                                                                                                                         |
| Paint              | `fills`, `strokes`, `setFillsAsync`, `setStrokesAsync`, `strokeWeight` and per-side weights, `strokeAlign`, `strokeJoin`, `strokeCap`, `strokeMiterLimit`, `dashPattern`, corner radii, `cornerSmoothing`, `effects`, `opacity`, `blendMode`, `isMask`, `maskType`, `visible`, `locked`, `clipsContent`, `guides`, `layoutGrids`, `exportSettings`, `annotations`                                                                                                            |
| Text               | `characters`, `insertCharacters`, `deleteCharacters`, `fontName`, `fontSize`, `fontWeight`, `textCase`, `letterSpacing`, `lineHeight`, `hyperlink`, decoration (style, offset, thickness, colour, skip-ink), node and range getters/setters (`setRange*`, `getRange*`, `getRangeAllFontNames`), `getStyledTextSegments`, alignment, `textAutoResize`, `textTruncation`, `maxLines`, `autoRename`, paragraph indent/spacing, `leadingTrim`, `textWrapStyle`, `hasMissingFont` |
| Components (basic) | `description`, `descriptionMarkdown`, `documentationLinks` (one link), `key`, `remote`, `getPublishStatusAsync`, `variantProperties`, set `defaultVariant` and `variantGroupProperties`, `getInstancesAsync` (always empty until instances exist)                                                                                                                                                                                                                            |

### Emulated Figma rules

All cited in the source next to the code that enforces them.

- **Fonts.** Writes that can change rendered text throw until every affected font is loaded:
  `characters`, `fontSize`, `textCase`, `textDecoration*`, `letterSpacing`, `lineHeight`,
  `leadingTrim`, paragraph spacing/indent, `textAlignHorizontal`/`Vertical`, `textAutoResize`,
  `insertCharacters`, `deleteCharacters` and the matching `setRange*`; `fontName` and
  `setRangeFontName` need only the new font. `fills` and hyperlinks need none.
- **Text.** Replacing `characters` resets range styles to the first character's style and
  renames the node while `autoRename` is on; renaming turns `autoRename` off; `fontSize` ≥ 1;
  `maxLines` ≥ 1 or `null`; ranges are `[start, end)` inside the text; node getters return
  `figma.mixed` when characters differ.
- **Auto layout.** Padding, spacing, alignment, sizing modes, `itemReverseZIndex` and
  `strokesIncludedInLayout` need `layoutMode ≠ NONE` (spacing, alignment and wrap need
  `HORIZONTAL`/`VERTICAL`); `layoutWrap` throws on other modes, so `WRAP` on `GRID` throws;
  `counterAxisSpacing` and `counterAxisAlignContent` need `WRAP`; `BASELINE` only on horizontal
  frames; `FILL` only on auto-layout children; `HUG` only on auto-layout frames and text;
  `ABSOLUTE` only inside an auto-layout parent; `layoutGrow` is 0 or 1; `x`/`y` writes on
  laid-out children are ignored and `relativeTransform` keeps their translation; `resize()` makes
  auto-layout axes `FIXED` and stops a child from filling.
- **Geometry.** Sizes below 0.01 throw; `resize` applies `MIN`/`MAX`/`CENTER`/`STRETCH`/`SCALE`
  constraints recursively, `resizeWithoutConstraints` does not, sections never do.
- **Values.** Paints, effects, constraints, guides and other structured values are deep-frozen;
  mutating one throws `TypeError`. Paints are validated strictly (unknown keys such as `a` in a
  solid colour are rejected, channels and opacity in [0, 1]) and read back normalised with
  `visible`, `opacity`, `blendMode` (and `boundVariables` on solid paints). Pattern paints need
  `setFillsAsync`/`setStrokesAsync`. Style-id setters are read-only under dynamic-page.
- **Tree.** One parent per node; `insertChild` index 0…length; no cycles; pages only under the
  document; component sets hold only components; sections only on pages or in sections;
  no components inside components; an emptied component set deletes itself; removed nodes
  throw on access and `getNodeByIdAsync` returns `null` for them.
- **Dynamic page.** `getNodeById`, `ComponentNode.instances`, `currentPage =` and deprecated sync
  setters throw; a page other than the current one must be loaded (`loadAsync` or
  `setCurrentPageAsync`) before its children are used; document-wide `findAll*` needs
  `loadAllPagesAsync`, which the port does not have, so it always throws.
- **Plugin data.** Values are strings; `''` deletes; an entry (namespace or plugin id, key and
  value, UTF-8) is at most 100 000 bytes; namespaces are at least 3 alphanumeric characters;
  `findAllWithCriteria` matches `types`, `pluginData` and `sharedPluginData` keys (any key).
- **combineAsVariants.** At least one node, only components, all on one page; the set is
  inserted at `index` under `parent`.
- **Images.** PNG, JPEG or GIF only, at most 4096 px per side; equal bytes give the same hash.

## Differences from real Figma

Known simplifications. Items marked _verify_ are checked by the Figma spikes (BUILD §9).

1. **Error messages** follow Figma's form (`in set_characters: Cannot write to node with unloaded
   font "Inter Regular". …`) but are not guaranteed to match byte for byte. Match on the class
   and a keyword.
2. **Stricter auto-layout writes.** Figma may silently ignore some layout properties on a frame
   with `layoutMode: 'NONE'`; the fake always throws (09 §6.2), and also throws for min/max sizes
   outside auto layout. Padding is accepted on `GRID` frames.
3. **No layout engine, no text metrics** (B-54). Children of auto-layout frames keep their
   stored positions, `HUG` frames do not resize, and text size does not follow its characters
   (a new text node is 0 × 14).
4. **Sizing side effects.** `resize()` sets both own axes `FIXED` and stops filling on both
   axes, whichever dimension changed. On text it turns `WIDTH_AND_HEIGHT` into `HEIGHT`
   (09 §6.2 "sets a fixed width"; _verify_ S-04). Setting `layoutMode` starts with
   `primaryAxisSizingMode: 'AUTO'`, `counterAxisSizingMode: 'FIXED'` (_verify_ S-05). A `GRID`
   parent is treated as horizontal for `FILL` until B-111.
5. **Constraints** ignore rotation; `STRETCH` and `SCALE` clamp sizes at 0.01.
6. **Paint normalisation** fills only `visible`, `opacity`, `blendMode` and solid
   `boundVariables`; Figma may add more defaults (e.g. image `rotation`, `filters`). Image
   hashes in paints are not checked against stored images. Effects are checked for required
   fields only.
7. **Getter identity.** Structured getters return the same frozen object on every read; Figma
   returns a new read-only copy (`children` is new on every read in both).
8. **Defaults** not stated by the typings are the editor's: component — no fill,
   `clipsContent: false`; vector — 100 × 100, no paints, `strokeAlign: 'CENTER'`; text —
   `strokeAlign: 'OUTSIDE'`, `textAutoResize: 'WIDTH_AND_HEIGHT'`, name `''` until characters are
   set; section — white fill; page — `#F5F5F5` background, names `Page N`; component set —
   named `Component Set`, no fill, dashed `#9747FF` stroke, radius 5.
9. **combineAsVariants** sizes the set to the union of the variants (no padding), keeps their
   positions, and renames components whose names are not `Prop=Value` to `Property 1=<name>`.
   "Not inside an instance" is checked once instances exist (B-54).
10. **Emptied component sets** delete themselves (the typings say empty sets are not supported;
    _verify_ S-02).
11. **Moving a child within its parent** with `insertChild(i, c)` places it before the child that
    was at `i` (fractional indexing).
12. **Nesting rules** are the ones listed above; Figma has more reparenting restrictions.
13. **Unloaded pages.** `getNodeByIdAsync` returns nodes on unloaded pages without loading the
    page. Pages made with `createPage` start loaded.
14. **Fonts.** A `fontName` without `style` resolves to `Regular` (Figma picks the closest
    instance from `variationSettings`, which is not modelled). Node-level writes need every font
    the node uses; `textWrapStyle`, `hangingPunctuation`, `hangingList` and `listSpacing` are also
    gated, which may be stricter than Figma.
15. **Styled segments.** List options, indentation, paragraph spacing/indent and wrap style are
    node-level values here, not per range; `textStyleId` and `fillStyleId` are always `''`.
16. **SVG import** is minimal (B-54): root size from `width`/`height` or `viewBox`, one vector
    per `<path>` with a hex `fill` (default black), sized to the SVG box, path data stored
    verbatim (Figma rewrites it). The frame is named `svg`. Other drawing elements throw
    `NotImplementedError`.
17. **Images.** Only the header is read; the hash is SHA-1 of the bytes, so values differ from
    Figma's hashes; creating the same bytes twice returns the same `Image` object.
18. **Component keys** are SHA-1 of the node id; `remote` is always `false`.
19. **clientStorage** copies values with `structuredClone`; Figma's serialisation may accept or
    reject different types.
20. **Removed nodes** still answer `id`, `removed`, `parent` (null) and `toString()`.
21. **Undo, selection events, prototyping and Motion** are not modelled: `commitUndo` is a no-op,
    `selection` is stored per page without events.

## Not modelled yet

These throw `NotImplementedError` with the item that adds them.

| Item      | Members                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-54      | text metrics and oracle mode; stack geometry via `layout-sim`; `exportAsync`; full SVG import and `vectorNetwork`; `createInstance` and instances; component properties (`componentPropertyDefinitions`, `add/edit/deleteComponentProperty`, `componentPropertyReferences =`); variables (`setBoundVariable`, `setRangeBoundVariable`, the `variables` API); `openTypeFeatures`; `absoluteRenderBounds` |
| B-111     | `GRID` layout members (`gridRowCount`, `setGridChildPosition`, …)                                                                                                                                                                                                                                                                                                                                       |
| B-125     | `clone()`                                                                                                                                                                                                                                                                                                                                                                                               |
| B-139     | style ids (`setFillStyleIdAsync`, …), explicit variable modes                                                                                                                                                                                                                                                                                                                                           |
| B-142     | `createSlot`, library imports                                                                                                                                                                                                                                                                                                                                                                           |
| hardening | dev resources, measurements, page events, `getCSSAsync`, `isAsset`, `getTopLevelFrame`, `rescale`, `outlineStroke`, `fillGeometry`/`strokeGeometry`, pattern paints, list options and range paragraph styles, Motion, prototyping setters, `inferredAutoLayout`                                                                                                                                         |

## Type assertions

The package has three, each documented where it is made:

1. `MIXED` (`src/mixed.ts`): `PluginAPI['mixed']` is a `unique symbol` declared inside the
   typings, so no other value can carry that type without an assertion.
2. `pick` (`src/nodes/pick.ts`): `getStyledTextSegments` returns only the requested fields;
   TypeScript cannot follow the runtime key filter.
3. `NodeState.parentView` (`src/state.ts`): the typings type every `parent` as
   `BaseNode & ChildrenMixin`, which `DocumentNode` is not, yet Figma returns the document as a
   page's parent.

`createFakeFigma()` itself satisfies `FigmaPort` without any cast (`test/port.test.ts`).
