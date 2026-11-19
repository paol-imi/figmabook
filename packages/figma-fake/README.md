# @holotype/figma-fake

An in-memory Figma document behind the plugin's `FigmaPort` (BUILD §8, [09 §18](../../internal/plan/09-plugin.md#testing)).
Applier tests in `packages/plugin` run against it instead of the real Plugin API.

- **Typed by Figma.** `createFakeFigma()` satisfies `FigmaPort` (a `Pick<>` of
  `@figma/plugin-typings@1.142.0`, see `packages/plugin/src/port.ts`) with no casts. Every node
  it returns is a class that structurally implements the typings interface (`FrameNode`,
  `TextNode`, `InstanceNode`, …), built from one mixin per typings mixin, so a node has exactly
  the members its type has (`'layoutMode' in text` is `false`, as in Figma).
- **Throws where Figma throws**, with the same class (`Error`, or `TypeError` for mutating a
  frozen value) and the same `in <api>:` message prefix. Every emulated rule cites its source in
  the code: a docs URL or `typings:<line>` (a line of `plugin-api.d.ts` in the pinned typings).
- **Lays out like Figma.** After every write, text sizes, auto layout (through
  `@holotype/layout-sim`) and instance contents are brought up to date synchronously, as in
  Figma, so read-back verification (09 §11) can be exercised.
- **Records every write** in an operation log, so "a no-op re-sync makes zero writes"
  (I-2, [10 §1](../../internal/plan/10-sync.md)) is one assertion. Derived state (layout, text size,
  instance sync, variable propagation) is not logged.
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

Oracle mode, to test the line-parity check (09 §11.1) without the approximate line breaking:

```ts
const figma = createFakeFigma({
  textOracle: (node) => linesByNk.get(node.getSharedPluginData('holotype', 'nk')), // Scene IR text.lines.length
});
```

## Public API

| Export                                                                                                                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFakeFigma(options?)`                                                                                               | A new fake document. Returns `FakeFigma`                                                                                                                                                                                                                                                                                                                                                                                                |
| `FakeFigma`                                                                                                               | `FigmaPort & FakeControls`                                                                                                                                                                                                                                                                                                                                                                                                              |
| `FakeFigmaOptions`                                                                                                        | `fonts` (available fonts, default Inter Regular/Italic/Medium/Semi Bold/Bold and Roboto Regular/Medium/Bold), `pages` (initial page names, default `['Page 1']`), `fileKey` (default a stable placeholder; `undefined` models a plugin without access, typings:74-79), `fileName` (`figma.root.name`), `pluginId` (scopes private plugin data, default `holotype`), `sessionId` (node ids are `<session>:<n>`, default 1), `textOracle` |
| `TextOracle`                                                                                                              | `(node: TextNode) => number \| undefined`: the line count of a text node (oracle mode, BUILD §8.1); `undefined` uses the approximate metrics                                                                                                                                                                                                                                                                                            |
| `VariablesPort`                                                                                                           | The `figma.variables` members in the port                                                                                                                                                                                                                                                                                                                                                                                               |
| `FakeControls.snapshot()`                                                                                                 | `FakeTree`: canonical JSON of the document (see below)                                                                                                                                                                                                                                                                                                                                                                                  |
| `FakeControls.ops()`                                                                                                      | `readonly Op[]`: every document write since creation or the last `reset()`                                                                                                                                                                                                                                                                                                                                                              |
| `FakeControls.reset()`                                                                                                    | Simulates a new plugin run on the same document: clears ops and notifications, unloads fonts, unloads every page except the current one, restores `skipInvisibleInstanceChildren`. Keeps the document, variables and `clientStorage`                                                                                                                                                                                                    |
| `FakeControls.notifications()`                                                                                            | Messages passed to `notify()`                                                                                                                                                                                                                                                                                                                                                                                                           |
| `FakeControls.getNodeById()`                                                                                              | Exists on the real API but throws under `documentAccess: "dynamic-page"` (typings:422-427)                                                                                                                                                                                                                                                                                                                                              |
| `FakeControls.setTextOracle(oracle \| null)`                                                                              | Turns oracle mode on or off; a text is re-measured on its next write                                                                                                                                                                                                                                                                                                                                                                    |
| `Op`                                                                                                                      | `{ method, nodeId, property, value }` (see "Operation log")                                                                                                                                                                                                                                                                                                                                                                             |
| `FakeTree`, `FakeNodeSnapshot`, `FakeNodeType`, `JsonValue`                                                               | Snapshot types                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DEFAULT_FONTS`, `MIN_SIZE` (0.01), `MAX_IMAGE_SIZE` (4096), `PLUGIN_DATA_LIMIT` (100 000 bytes), `MIXED_JSON`, `TYPINGS` | Constants                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Snapshot

`snapshot()` returns `{ document, currentPage, images, variables? }`. Each node lists `id`,
`type`, `name`, then `x`, `y`, `width`, `height` (and `relativeTransform` when rotated), plugin
data (`pluginData`, `sharedPluginData`, `relaunchData`; a sublayer lists only its own), every
property whose value differs from a newly created node of the same type, derived
`layoutSizingHorizontal`/`Vertical` when not `FIXED`, `variantProperties` for variants, text as
`characters` plus `textStyle` runs (fields that differ from a new text node, `boundVariables`
included), `loaded: false` for unloaded pages, then `children`. Component data: an instance's
`mainComponent` (id) and the `componentProperties` set on it; a component's or set's stored
`componentPropertyDefinitions` (VARIANT axes are visible in the variant names);
`componentPropertyReferences`; field `boundVariables` (variable ids). Instance sublayers are
listed under their instance with their `I…` ids. `variables` (present once a collection exists)
lists collections and variables in creation order. Keys are sorted, so
`JSON.stringify(snapshot())` gives the same bytes for the same document.

### Operation log

| Write                                           | Op                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `node.opacity = 0.5`                            | `{ method: 'set', nodeId, property: 'opacity', value: 0.5 }`                                     |
| `node.resize(10, 20)`                           | `{ method: 'resize', nodeId, property: null, value: { width: 10, height: 20 } }`                 |
| `figma.createFrame()`                           | `{ method: 'createFrame', nodeId: <new id>, property: null, value: null }`                       |
| `component.createInstance()`                    | `{ method: 'createInstance', nodeId: <instance id>, property: null, value: <component id> }`     |
| `parent.insertChild(1, c)`                      | `{ method: 'insertChild', nodeId: <parent>, property: null, value: { index: 1, child: <id> } }`  |
| `node.setSharedPluginData('holotype', 'nk', v)` | `{ method: 'setSharedPluginData', nodeId, property: 'holotype/nk', value: v }`                   |
| `text.setRangeFontSize(0, 2, 20)`               | `{ method: 'setRangeFontSize', nodeId, property: null, value: { start: 0, end: 2, value: 20 } }` |
| `node.setBoundVariable('paddingLeft', v)`       | `{ method: 'setBoundVariable', nodeId, property: 'paddingLeft', value: <variable id> }`          |
| `instance.setProperties(p)`                     | `{ method: 'setProperties', nodeId, property: null, value: p }`                                  |
| `variable.setValueForMode(mode, 4)`             | `{ method: 'setValueForMode', nodeId: <variable id>, property: mode, value: 4 }`                 |
| `figma.createImage(bytes)`                      | `{ method: 'createImage', nodeId: null, property: null, value: { hash } }`                       |

Every assignment is logged, even one that stores the value already there. A write that throws
is not logged. Reads, `exportAsync`, `loadFontAsync`, `loadAsync`, `setCurrentPageAsync`,
`selection`, `notify`, `commitUndo`, `clientStorage`, `createVariableAlias` and
`setBoundVariableForPaint` (which returns a new paint) are not document writes and are not
logged; neither is derived state (layout, text size, instance sync, values of bound fields).

## Surface (BUILD §8.1, B-06 and B-54)

| Area               | Modelled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global             | `createFrame`, `createComponent`, `createComponentFromNode`, `createText`, `createRectangle`, `createEllipse`, `createVector`, `createSection`, `createPage`, `createNodeFromSvg`, `combineAsVariants`, `createImage`, `getImageByHash`, `getNodeByIdAsync`, `loadFontAsync`, `listAvailableFontsAsync`, `root`, `currentPage`, `setCurrentPageAsync`, `mixed`, `skipInvisibleInstanceChildren`, `fileKey`, `notify`, `commitUndo`, `clientStorage`, `variables`                                      |
| BaseNode           | `id`, `type`, `name`, `parent`, `removed`, `remove()`, `toString()`, plugin data (private and shared, read through for instance sublayers), relaunch data                                                                                                                                                                                                                                                                                                                                             |
| Children           | `children`, `appendChild`, `insertChild`, `findChildren`, `findChild`, `findAll`, `findOne`, `findAllWithCriteria`; page `loadAsync`                                                                                                                                                                                                                                                                                                                                                                  |
| Geometry           | `x`, `y`, `width`, `height`, `relativeTransform`, `rotation`, `absoluteTransform`, `absoluteBoundingBox`, `absoluteRenderBounds`, `resize` (with constraints), `resizeWithoutConstraints`, `constraints`, min/max sizes, `layoutSizingHorizontal`/`Vertical`, `layoutAlign`, `layoutGrow`, `layoutPositioning`, auto-layout frame properties                                                                                                                                                          |
| Stack layout       | HORIZONTAL/VERTICAL positions and HUG/FILL sizes from `@holotype/layout-sim` after every write: padding, spacing, alignment (incl. SPACE_BETWEEN, BASELINE), min/max, hidden and ABSOLUTE children, strokes in layout, nested stacks; FILL on a HUG axis makes the parent FIXED                                                                                                                                                                                                                       |
| Paint              | `fills`, `strokes`, `setFillsAsync`, `setStrokesAsync`, `strokeWeight` and per-side weights, `strokeAlign`, `strokeJoin`, `strokeCap`, `strokeMiterLimit`, `dashPattern`, corner radii, `cornerSmoothing`, `effects`, `opacity`, `blendMode`, `isMask`, `maskType`, `visible`, `locked`, `clipsContent`, `guides`, `layoutGrids`, `exportSettings`, `annotations`                                                                                                                                     |
| Text               | `characters`, `insertCharacters`, `deleteCharacters`, `fontName`, `fontSize`, `fontWeight`, `textCase`, `letterSpacing`, `lineHeight`, `hyperlink`, decoration, node and range getters/setters (`setRange*`, `getRange*`, `getRangeAllFontNames`, `setRangeBoundVariable`, `getRangeBoundVariable`), `getStyledTextSegments`, alignment, `textAutoResize`, `textTruncation`, `maxLines`, `autoRename`, paragraph indent/spacing, `leadingTrim`, `textWrapStyle`, `hasMissingFont`, `openTypeFeatures` |
| Text metrics       | Deterministic size from the characters and styles (per-class advances, family, weight, letter spacing, case; greedy wrapping; PIXELS/PERCENT/AUTO line heights; paragraph spacing; truncation), or the oracle's line count                                                                                                                                                                                                                                                                            |
| Vectors and SVG    | `vectorPaths`, `vectorNetwork` (derived), `setVectorNetworkAsync`, `handleMirroring`; `createNodeFromSvg` for `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `g` transforms, inherited and `style` paint attributes, solid colours, linear/radial gradients, `viewBox`                                                                                                                                                                                                           |
| Components         | `description`, `descriptionMarkdown`, `documentationLinks` (one link), `key`, `remote`, `getPublishStatusAsync`, `variantProperties`, set `defaultVariant` and `variantGroupProperties`, `createInstance`, `getInstancesAsync`, `componentPropertyDefinitions`, `addComponentProperty`, `editComponentProperty`, `deleteComponentProperty` (BOOLEAN, TEXT, INSTANCE_SWAP, VARIANT), `componentPropertyReferences`                                                                                     |
| Instances (basic)  | sublayer ids `I<instance>;<child>` (nested: `I<a>;<b>;<c>`) that read the main component's plugin data, `getMainComponentAsync`, `mainComponent =`, `swapComponent`, `setProperties`, `componentProperties`, `variantProperties`, `scaleFactor`, `exposedInstances` (empty); instances follow their main component and keep their overrides                                                                                                                                                           |
| Variables (subset) | `createVariableCollection`, `createVariable`, `createVariableAlias`, `getLocalVariablesAsync`, `getLocalVariableCollectionsAsync`, `getVariableByIdAsync`, `setBoundVariableForPaint`; `Variable` name, description, `setValueForMode`, `valuesByMode`, `resolveForConsumer`, `scopes`, `codeSyntax`, plugin data, `remove`; collection `modes`, `defaultModeId`, `variableIds`, `renameMode`, `remove`; node `setBoundVariable`, `boundVariables`                                                    |
| Export             | `exportAsync` PNG (deterministic transparent placeholder of the exported pixel size) and SVG / SVG_STRING placeholders                                                                                                                                                                                                                                                                                                                                                                                |

### Emulated Figma rules

All cited in the source next to the code that enforces them.

- **Fonts.** Writes that can change rendered text throw until every affected font is loaded:
  `characters`, `fontSize`, `textCase`, `textDecoration*`, `letterSpacing`, `lineHeight`,
  `leadingTrim`, paragraph spacing/indent, `textAlignHorizontal`/`Vertical`, `textAutoResize`,
  `insertCharacters`, `deleteCharacters`, the matching `setRange*`, text variable bindings and
  `setProperties` on a TEXT property; `fontName` and `setRangeFontName` need only the new font.
  `fills` and hyperlinks need none.
- **Text.** Replacing `characters` resets range styles to the first character's style and
  renames the node while `autoRename` is on; renaming turns `autoRename` off; `fontSize` ≥ 1;
  `maxLines` ≥ 1 or `null`; ranges are `[start, end)` inside the text; node getters return
  `figma.mixed` when characters differ. Auto-width text takes its content size; `HEIGHT` text
  keeps its width and takes its content height; `NONE` keeps its size.
- **Auto layout.** Padding, spacing, alignment, sizing modes, `itemReverseZIndex` and
  `strokesIncludedInLayout` need `layoutMode ≠ NONE` (spacing, alignment and wrap need
  `HORIZONTAL`/`VERTICAL`); `layoutWrap` throws on other modes, so `WRAP` on `GRID` throws;
  `counterAxisSpacing` and `counterAxisAlignContent` need `WRAP`; `BASELINE` only on horizontal
  frames; `FILL` only on auto-layout children; `HUG` only on auto-layout frames and text;
  `ABSOLUTE` only inside an auto-layout parent; `layoutGrow` is 0 or 1; `x`/`y` writes on
  laid-out children are ignored; `resize()` makes auto-layout axes `FIXED` and stops a child from
  filling. A child that fills makes its parent FIXED on that axis; a frame set to HUG an axis its
  children fill turns them FIXED. Children are positioned and HUG/FILL frames sized by
  `layout-sim`; a non-stack frame resized by its parent's layout applies its children's
  constraints.
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
- **Instances.** Nothing can be appended to an instance or its sublayers, and sublayers cannot be
  moved out or removed; a component cannot contain an instance of itself, directly or through
  other components (also for `swapComponent` and `mainComponent =`); reading `mainComponent`
  throws under dynamic-page; `combineAsVariants` and `createComponentFromNode` refuse targets
  inside an instance. With `skipInvisibleInstanceChildren`, invisible sublayers and their
  descendants are left out of `children` and `findAll*`, `getNodeByIdAsync` returns `null` for
  them and reading them throws.
- **Component properties.** Definitions live on the set (or a component outside a set):
  reading or changing them on a variant throws; BOOLEAN defaults are booleans, TEXT strings,
  INSTANCE_SWAP the id of a component; `preferredValues` only for INSTANCE_SWAP; `description` and
  `slotSettings` only for SLOT; `defaultValue` cannot be edited on VARIANT properties, which also
  cannot be deleted; references must name a property of the containing component with the
  matching type, `characters` only on text, `mainComponent` only on instances, and cannot be set
  on instance sublayers; `setProperties` takes VARIANT names first, needs a variant with the new
  values, and checks names and value types.
- **Variables.** A COLOR, FLOAT, STRING or BOOLEAN value must match the variable's type; aliases
  must point to a variable of the same type and cannot form a cycle; variable ids as arguments
  (deprecated) throw under dynamic-page; a binding needs a field the node has and a variable of
  the field's type, and writes the value through the field's setter (so padding needs auto
  layout); a literal write to a bound field unbinds it; when a value changes, bound fields and
  paints follow; `setBoundVariableForPaint` accepts solid paints and the `color` field only and
  returns a new paint.
- **Dynamic page.** `getNodeById`, `ComponentNode.instances`, `InstanceNode.mainComponent` reads,
  `currentPage =` and deprecated sync setters throw; a page other than the current one must be
  loaded (`loadAsync` or `setCurrentPageAsync`) before its children are used or it is exported;
  document-wide `findAll*` needs `loadAllPagesAsync`, which the port does not have, so it always
  throws.
- **Plugin data.** Values are strings; `''` deletes; an entry (namespace or plugin id, key and
  value, UTF-8) is at most 100 000 bytes; namespaces are at least 3 alphanumeric characters;
  `findAllWithCriteria` matches `types`, `pluginData` and `sharedPluginData` keys (any key).
- **combineAsVariants.** At least one node, only components, all on one page, not inside an
  instance; the set is inserted at `index` under `parent`.
- **Images.** PNG, JPEG or GIF only, at most 4096 px per side; equal bytes give the same hash.

## Differences from real Figma

Known simplifications. Items marked _verify_ are checked by the Figma spikes (BUILD §9).

1. **Error messages** follow Figma's form (`in set_characters: Cannot write to node with unloaded
   font "Inter Regular". …`) but are not guaranteed to match byte for byte. Match on the class
   and a keyword.
2. **Stricter auto-layout writes.** Figma may silently ignore some layout properties on a frame
   with `layoutMode: 'NONE'`; the fake always throws (09 §6.2), and also throws for min/max sizes
   outside auto layout. Padding is accepted on `GRID` frames.
3. **Text metrics are approximate.** Advances come from a per-class table (Inter-like
   proportions, Roboto 5 % narrower, +2.5 % per 100 weight units); auto line height uses the
   family's hhea ascender + descender (Inter 1.2109, Roboto 1.1719, others 1.2). Line breaking is
   greedy at spaces and after hyphens; `leadingTrim`, OpenType features, list spacing and
   `textWrapStyle` do not change metrics. Use oracle mode where line counts matter.
4. **Sizing side effects.** `resize()` sets both own axes `FIXED` and stops filling on both
   axes, whichever dimension changed. On text it turns `WIDTH_AND_HEIGHT` into `HEIGHT`
   (09 §6.2 "sets a fixed width"; _verify_ S-04), whose height then follows the content, so
   `resize(w, h)` then `textAutoResize = 'NONE'` keeps the content height, not `h`. Setting
   `layoutMode` starts with `primaryAxisSizingMode: 'AUTO'`, `counterAxisSizingMode: 'FIXED'`
   (_verify_ S-05). A `GRID` parent is treated as horizontal for `FILL` until B-111.
5. **Constraints** ignore rotation; `STRETCH` and `SCALE` clamp sizes at 0.01.
6. **Paint normalisation** fills only `visible`, `opacity`, `blendMode` and solid
   `boundVariables`; Figma may add more defaults (e.g. image `rotation`, `filters`). Image
   hashes and variable aliases in assigned paints are not checked. Effects are checked for
   required fields only.
7. **Getter identity.** Structured getters return the same frozen object on every read; Figma
   returns a new read-only copy (`children` is new on every read in both).
8. **Defaults** not stated by the typings are the editor's: component and instance — no fill,
   `clipsContent: false`; vector — 100 × 100, no paints, `strokeAlign: 'CENTER'`; text —
   `strokeAlign: 'OUTSIDE'`, `textAutoResize: 'WIDTH_AND_HEIGHT'`, name `''` until characters are
   set; section — white fill; page — `#F5F5F5` background, names `Page N`; component set —
   named `Component Set`, no fill, dashed `#9747FF` stroke, radius 5. Instances are created at
   (0, 0).
9. **combineAsVariants** sizes the set to the union of the variants (no padding), keeps their
   positions, and renames components whose names are not `Prop=Value` to `Property 1=<name>`.
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
    node-level values here, not per range (so are paragraph bindings); `textStyleId` and
    `fillStyleId` are always `''`.
16. **SVG import.** Groups are flattened into their shapes (Figma keeps groups); every shape
    becomes a `VECTOR` named after its `id` or `Vector`, placed at its path bounds, with path data
    rewritten as absolute `M`/`L`/`Q`/`C`/`Z` commands (arcs as cubics, 4 decimals); shapes that
    draw nothing are dropped; group opacity multiplies into each shape; gradients are mapped to
    `gradientTransform` from their end points (no `gradientTransform` attribute, `href` or
    spread method); `currentColor` is black. Text, images, `use`, masks, clip paths, filters,
    patterns and `<style>` throw `NotImplementedError`.
17. **Images.** Only the header is read; the hash is SHA-1 of the bytes, so values differ from
    Figma's hashes; creating the same bytes twice returns the same `Image` object.
18. **Component keys** are SHA-1 of the node id (variables and collections likewise); `remote` is
    always `false`.
19. **clientStorage** copies values with `structuredClone`; Figma's serialisation may accept or
    reject different types.
20. **Removed nodes** still answer `id`, `removed`, `parent` (null) and `toString()`.
21. **Undo, selection events, prototyping and Motion** are not modelled: `commitUndo` is a no-op,
    `selection` is stored per page without events.
22. **Layout model.** Wrap (B-111) and GRID (B-112) frames do not move their children; a
    rotated child takes its bounding box in the flow and keeps its size; negative padding counts
    as 0; a max below the min is ignored; `BASELINE` kept after a switch to `VERTICAL` lays out as
    `MIN`. Making a frame hug an axis its children fill turns them FIXED (_verify_ S-05). The
    rules marked `calibrate` or `S-xx` in `@holotype/layout-sim` apply here too.
23. **Overrides** are told apart from inherited values by value: an instance field that still
    equals what it last copied follows the main component, one that differs is kept. An override
    set to the inherited value is not an override, and sublayer position and size always follow
    the main component (then the instance's own layout and constraints apply); fields driven by a
    component property follow the property, not direct writes. The override model of S-02 is
    B-125.
24. **Swapping** (`swapComponent`, VARIANT values) keeps overrides on sublayers with the same type
    and name path; an INSTANCE_SWAP property value swaps without keeping nested overrides.
    `mainComponent =` clears overrides and property values. A deleted main component leaves its
    instances as they were and `getMainComponentAsync` returns `null`.
25. **Plugin data on sublayers** written by the plugin is stored on the sublayer and shadows the
    main component's value for that key; `''` falls back to the main component's value.
26. **Component properties.** A property's default does not rewrite the main component's bound
    layers, and editing a bound layer in the main does not change the default: an instance shows
    the main component's content until `setProperties` sets a value (_verify_ S-02). Property ids
    come from a per-document counter (`#<session>:<n>`). Names are not checked beyond being
    non-empty (VARIANT names and values cannot contain `=` or `,`).
27. **createComponentFromNode** gives the component a new id (the frame is removed); any other
    layer is wrapped in a component of its size.
28. **Variables.** One mode per collection (modes are B-139); values resolve in the default mode;
    a new variable starts at `false`, `0`, `''` or white (_verify_ S-12); names and scopes are not
    validated against the variable type; binding a COLOR variable to a paint sets the paint's
    `opacity` to the colour's alpha (_verify_ S-12); `fontWeight` bindings pick an available style
    of the family with that weight.
29. **absoluteRenderBounds** adds visible strokes by alignment, drop shadows (offset, blur,
    spread) and layer blur to the bounding box, plus unclipped children; glyph outlines and
    inner shadows are not modelled.
30. **exportAsync** returns transparent placeholders: a valid PNG of the exported pixel size
    (bounds × constraint, at most 16 384 px per side) or an empty `<svg>`. Nothing is rendered.

## Not modelled yet

These throw `NotImplementedError` with the item that adds them.

| Item      | Members                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-111     | `GRID` layout members (`gridRowCount`, `gridColumnSizes`, `setGridChildPosition`, …)                                                                                                                                                                                                                                                                                                                                                             |
| B-125     | `clone()`, `InstanceNode.overrides`, `resetOverrides`, `removeOverrides`                                                                                                                                                                                                                                                                                                                                                                         |
| B-139     | style ids (`setFillStyleIdAsync`, …), explicit variable modes, `VariableCollection.addMode`/`removeMode`                                                                                                                                                                                                                                                                                                                                         |
| B-142     | `createSlot`, SLOT properties, `isExposedInstance =`, library imports                                                                                                                                                                                                                                                                                                                                                                            |
| hardening | dev resources, measurements, page events, `getCSSAsync`, `isAsset`, `getTopLevelFrame`, `rescale`, `outlineStroke`, `fillGeometry`/`strokeGeometry`, pattern paints, list options and range paragraph styles, Motion, prototyping setters, `inferredAutoLayout`, `detachInstance`, `scaleFactor =`, extended collections, EASING/TIMING variables and composed colours, export formats other than PNG and SVG, the SVG elements of difference 16 |

## Type assertions

The package has four, each documented where it is made:

1. `MIXED` (`src/mixed.ts`): `PluginAPI['mixed']` is a `unique symbol` declared inside the
   typings, so no other value can carry that type without an assertion.
2. `pick` (`src/nodes/pick.ts`): `getStyledTextSegments` returns only the requested fields;
   TypeScript cannot follow the runtime key filter.
3. `NodeState.parentView` (`src/state.ts`): the typings type every `parent` as
   `BaseNode & ChildrenMixin`, which `DocumentNode` is not, yet Figma returns the document as a
   page's parent.
4. `NO_FEATURES` (`src/nodes/text.ts`): `openTypeFeatures` "only contains features that diverge
   from their default values", which is none here, but the typings declare a map with every
   feature key.

`createFakeFigma()` itself satisfies `FigmaPort` without any cast (`test/port.test.ts`).
