# 05: Capture engine

> **Package:** `@holotype/capture` (Node orchestrator + in-page serializer bundle).
> **Input:** `PlannedVariant` / `ProbeRender` from [04](04-variant-model.md), rendered through the `RenderDriver` from [03](03-storybook.md).
> **Output:** **Capture IR** (`CaptureDoc`, schema in [06](06-ir.md)), one per variant, cached on the CLI side (D-08).
> **Governing decisions:** D-05 (Chromium + CDP, pinned), D-08, D-14, D-17, D-18, D-24.
> **Research:** [dom-to-figma brief](../research/dom-to-figma-brief.md) §§1–5. It studied BuilderIO/html-to-figma `7fece25`, figitdesign/web-to-figma `859efea`, Lynavo/web2ui `6753aaf`, html2canvas, modern-screenshot and satori.

> **Loop slice subset:** light DOM + open shadow, CDP geometry, solid paints, per-side borders, radius, simple shadows, opacity, clip, Latin text with platform fonts, inline SVG, PNG/JPEG, matched styles for `var()` chains and rule locations. The rest is hardening H-A ([14](14-roadmap.md#hardening)).

Capture records **facts**, not Figma decisions. It records:

- measured geometry;
- computed and authored styles;
- text lines;
- the fonts actually used;
- assets;
- paint order.

All inference (auto layout, sizing, simplification, token binding) happens in `mapper` ([07](07-mapping.md), [08](08-tokens.md)), so it can be re-run offline without re-rendering. The browser's measured geometry is ground truth.

---

## 1. Orchestration <a id="orchestration"></a>

### 1.1 Process model

```
CaptureRunner (Node)
 ├─ BrowserPool: 1 Chromium process per runner (pinned build, D-05; flags in §1.3)
 │   └─ N workers = N BrowserContexts (isolated cookies/storage), each with 1 long-lived Page
 │        on iframe.html (RenderDriver) + 1 CDPSession
 ├─ Job queue: components ordered by dependency (icons/atoms first, [09]), variants FIFO within component
 └─ Writer: Capture IR → cache (.holotype/cache/capture/<key>.json.gz, fflate) + assets (assets/<sha256>, 02)
```

- **Concurrency:** `N = min(8, max(1, os.availableParallelism() - 1))` locally and `min(4, cpus)` in CI. This is configurable (`capture.workers`, `--concurrency`). All variants of a component go to **one worker**, so the warm page stays on the same story and cheap arg updates are possible ([03 §5.3](03-storybook.md#render-loop-driver)). Components are distributed across workers.
- **Context options (D-24):**

```ts
const ctxOpts: BrowserContextOptions = {
  viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2,
  locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce',
  userAgent: `${defaultUA} StorybookTestRunner holotype/${version}`,
  serviceWorkers: 'block', bypassCSP: false, javaScriptEnabled: true,
  ...auth /* httpCredentials | storageState | extraHTTPHeaders via route, [03 §9.4] */,
};
await page.clock.setFixedTime(new Date('2026-01-01T00:00:00Z')); // Date frozen; timers and rAF stay real
await page.addInitScript({ content: `Math.random = ${seededRandomSrc}(0xF16B00C);` }); // opt-out: capture.determinism.random: false
```

  `capture.clock` sets the frozen date (`false` leaves the real clock, [16](16-config.md#capture)). `clock.install()` is opt-in per story (a story parameter) for stories that need controllable timers.
- **Animations.** Storybook pauses CSS animations for this UA instead of waiting ([03 §5.5](03-storybook.md#settle-protocol)). After render: finish finite Web Animations, then wait for two rAF-stable frames (`capture.animations: 'finish'`; `'pause-only'` skips the finishing step).
- `colorScheme` changes only for `:appearance`-style modes ([04 §10.1](04-variant-model.md#compatibility-readers)).
- **Crash recovery:**
  - `page.on('crash')` or a closed target recreates the page, and the whole context if it happens twice. The current variant is retried once (`CAP_PAGE_CRASHED`).
  - A browser disconnect restarts the pool and resumes from the queue.
  - Captures are idempotent and cached, so a resumed run never redoes finished variants.
- **Memory hygiene:** recycle a worker's page every 500 variants, or when the JS heap exceeds 1 GB (`Performance.getMetrics`).

### 1.2 Per-variant pipeline

```
render (03 §5)  → settle (03 §5.5)
  → [state] apply pseudo-state (§9)                → settle (short: 2 rAF + fonts)
  → serialize (in-page, §3–§8)                      → returns CaptureDoc skeleton + pending asset refs
  → CDP enrichment (§2.3, §6, §7): boxes for transformed nodes, platform fonts, matched styles, pseudo boxes
  → asset fetch & normalize (§5)
  → screenshot of capture root (element clip, DPR 2) for fidelity harness ([12]) — optional, on by default
  → [probe] if width probes requested (§11) → re-measure at N widths
  → [state] clear pseudo-state
  → finalize: canonicalize, hash, write cache
```

Probe captures ([04 §4.1](04-variant-model.md#classification)) run the same pipeline with `mode:'probe'`. That mode skips assets, screenshots, matched styles and platform fonts, and emits only geometry, text and paint hashes.

### 1.3 Chromium flags

- `--font-render-hinting=none`. It makes advances closer to Figma's unhinted layout (verify, S-04).
- `--disable-lcd-text`.
- `--force-color-profile=srgb`, so that screenshots are comparable.
- `--hide-scrollbars`.
- `--disable-features=PaintHolding`.

GPU stays default, because rasterization does not affect DOM geometry. Headless uses the new headless mode (`chromium` channel, not `headless-shell`), for parity with headed font rendering.

---

## 2. Injection <a id="injection"></a>

### 2.1 Serializer bundle

- `packages/capture/src/page/*` is built by esbuild into **one IIFE string** (`dist/page.js`, target es2022, no imports). It exposes `window.__holotype` with these entry points:
  - `safe`
  - `rehydrate`
  - `sb.*` (render-loop helpers, [03](03-storybook.md))
  - `serialize(rootSpec, opts)`
  - `probe(rootSpec)`
  - `measure(ids)`
  - `enhancers.*` (framework hooks, [03 §10](03-storybook.md#framework-enhancers))
- It is injected with `page.addInitScript({ content })`, so it runs **before** any Storybook or component code. The same bundle is reused by the optional addon's preview hook ([03 §11](03-storybook.md#optional-storybook-addon-holotypestorybook-addon)).
- Size budget: ≤150 kB minified. `colorjs.io` (§7.1) is tree-shaken to the conversion and gamut-mapping modules.

### 2.2 Init-time hooks

These are installed by the init script before the page's code runs:

```ts
// 1. Closed shadow roots: keep a reference (do NOT force open — that changes component behaviour)
const closedRoots = new WeakMap<Element, ShadowRoot>();
const origAttach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init) { const r = origAttach.call(this, init);
  if (init.mode === 'closed') closedRoots.set(this, r); return r; };
// 2. Constructable stylesheets bookkeeping (for authored-style fallback when CDP can't see adopted sheets)
// 3. Element id assignment is lazy (at serialize time), not here.
```

If a closed root was created before the init script ran (very rare: `addInitScript` precedes everything), the CDP `DOM.getDocument({pierce:true})` fallback finds it (§2.3) and the walk reads it through CDP, with `CAP_CLOSED_SHADOW_LATE` (warn).

### 2.3 CDP session

There is one `CDPSession` per page. Domains enabled: `DOM`, `CSS`, `Page`, `Network` and `Runtime` (`Overlay` is not used).

| Method | Used for |
|---|---|
| `DOM.getDocument({depth:-1, pierce:true})` | node ids, including closed shadow roots and pseudo-elements |
| `DOM.pushNodesByBackendIdsToFrontend` / `DOM.requestNode({objectId})` | mapping our elements to node ids |
| `DOM.getBoxModel` / `DOM.getContentQuads` | transformed geometry |
| `CSS.getComputedStyleForNode` | pseudo-element styles |
| `CSS.getMatchedStylesForNode` | authored declarations: `var()`, keywords, `fr`, `minmax`, `@media`/`@container` |
| `CSS.getPlatformFontsForNode` | the fonts actually used |
| `CSS.forcePseudoState` | states |
| `Network.getResponseBody` | asset bytes |
| `Page.captureScreenshot({clip})` | rasters |

**Mapping our elements to CDP nodes.** The serializer stamps each captured element with `data-holotype-id="<n>"`. The orchestrator then runs one `DOM.querySelectorAll(documentNodeId, '[data-holotype-id]')` per shadow root (root ids come from the pierced document) and builds `Map<id, nodeId>`. This avoids one `requestNode` per element.

**Batching.** CDP calls are pipelined. We send up to 64 concurrent requests per session and await them all, without serializing round-trips. Expected cost for a 60-node Button variant: about 20ms of CDP enrichment (verify, S-07).

---

## 3. Composed-tree walk <a id="walk"></a><a id="tree-walk"></a>

```ts
function* composedChildren(n: Node): Iterable<Node> {
  if (n instanceof HTMLSlotElement) {
    const a = n.assignedNodes({ flatten: true });
    yield* (a.length ? a : n.childNodes);                 // fallback content
    return;
  }
  const root = (n as Element).shadowRoot ?? closedRoots.get(n as Element);
  yield* (root ? root.childNodes : n.childNodes);         // host light children render only via slots
}
```

Per element, in walk order:

1. **Skip:**
   - `script`, `style`, `template`, `head`, `noscript`, `meta`, `link`, and `<source>`/`<track>`;
   - `display:none` (whole subtree);
   - nodes in `parameters.holotype.exclude`;
   - elements with `[data-holotype-ignore]`;
   - sr-only patterns: 1×1 px and `clip: rect(0 0 0 0)`, or `clip-path: inset(50%)` (web2ui), with `CAP_SR_ONLY_SKIPPED` (info, counted only).
2. **`display: contents`.** Emit no node and splice its children into the parent. Their inherited styles are already resolved.
3. **`visibility: hidden|collapse`.** Emit no own paint, but keep walking, because descendants with `visibility: visible` still render. The node is recorded with `paintVisible:false`, so that layout keeps its box.
4. **`opacity: 0`.** Emitted with `opacity:0`. The mapper decides whether to keep it hidden (useful for state toggles).
5. **Fully clipped.** If the element's rect lies fully outside every ancestor clip, it is culled (`CAP_CLIPPED_CULLED`, info), unless it is a planner-bound node such as a BOOLEAN target, which must exist in all variants.
6. **Iframes:**
   - same-origin: recurse into `contentDocument`, with geometry offset by the iframe content box;
   - cross-origin (OOPIF): use `page.frames()`, then `frame.evaluate(__holotype.serialize)` per frame, and compose offsets;
   - failure: rasterize via `Page.captureScreenshot({clip})`, with `CAP_IFRAME_RASTERIZED`.
7. **Text nodes** are collected per inline formatting context (§4).
8. **Element ids.** Each emitted element gets an `id` (`"c<n>"`, a sequence number, stamped as `data-holotype-id`) and a **structural path** `source.path`: `tag[:nth-of-signature]` segments, crossing shadow roots with `::shadow`, e.g. `div>my-button::shadow>button>span.label`. Paths are the basis for `nk` alignment in [07](07-mapping.md), and they are stable across arg changes when the structure is stable.

**Per-element facts collected** (fields of `CNode`, [06 §2.1](06-ir.md); 06 owns the shape):

```ts
{
  id, type,                                        // 'element' | 'text' | 'pseudo' | 'replaced'
  source: { tag, path, classes, id?, role?, ariaLabel?, testId?, figmaName?, figmaKey?,
            component?, shadowHost?, slotName?, pseudo?, nativeControl?, srOnly?, loc? },   // enhancers (03 §10)
  borderBox, quads?, untransformed?, transform?, nonAffine?,   // §3.1
  computed,                                        // §3.2
  authored?,                                       // §6: Typed-OM keywords (§6.1) + matched declarations (§6.2, CDP)
  fragments?,                                      // inline boxes, §3.1
  scroll?,
  text?, replaced?,                                // §4, §5
  paint,                                           // stacking facts, §8
  children                                         // composed order; pseudo-elements are children (§5.5)
}
```

### 3.1 Geometry

- **Fast path.** If no ancestor (up to the capture root) has a non-identity `transform`, `rotate`, `scale`, `translate`, `perspective` or `offset-path`, use `borderBox = el.getBoundingClientRect()` in page space, rounded to 1/64 px. The serializer tracks transforms while walking, so the check is free.
- **Fields.** `borderBox` is the axis-aligned border box; `quads`, `untransformed` and `transform` are present only for transformed nodes (06 §2.1).
- **Transformed nodes.** Use CDP `DOM.getBoxModel(nodeId).model.border`, which gives the post-transform quad in page space. Then derive the page-space affine from the quad and the **untransformed** border-box size (`offsetWidth/Height`, or the computed width plus padding plus border for SVG/inline):

```ts
function affineFromQuad(q: number[], w: number, h: number): Mat2x3 {   // q = TL,TR,BR,BL
  const a = (q[2]-q[0])/w, b = (q[3]-q[1])/w, c = (q[6]-q[0])/h, d = (q[7]-q[1])/h;
  return [[a, c, q[0]], [b, d, q[1]]];
}
// transform = nodePageMatrix; the mapper derives relativeTransform = inverse(parentPageMatrix) · nodePageMatrix
```

  `untransformed` then holds the box size before transforms. This handles transform-origin, nesting and scroll in one go.
- **Non-affine transforms.** `matrix3d`, perspective or rotateX/Y, detected by `DOMMatrix.is2D === false`, set `nonAffine: true`, and the subtree is rasterized (`CAP_NON_AFFINE_RASTERIZED`).
- **Inline elements** with paint (background, border, outline or shadow): `fragments = [...el.getClientRects()]`, one per line fragment. The mapper emits one rect per fragment behind the text.
- **Scroll containers.** Record `scrollLeft/Top` and `scrollWidth/Height`. Children rects are as rendered, already offset by the scroll.
- **Sub-pixel rule.** All geometry is kept in CSS px with 1/64 precision. No rounding happens until the plugin.

### 3.2 Computed subset

We serialize **about 95 properties**, not all 500+. The list is grouped and versioned in `ir` as `COMPUTED_PROPS_V1`:

| Group | Properties |
|---|---|
| box | `box-sizing`, `width`, `height`, `min-*`, `max-*`, `padding-*`, `border-*-width/style/color`, `border-*-radius` (both radii), `margin-*`, `outline-*`, `outline-offset` |
| layout | `display`, `position`, `inset` (4), `float`, `z-index`, `flex-*`, `order`, `align-*`, `justify-*`, `place-*`, `gap`, `row-gap`, `column-gap`, `grid-template-*` (resolved px), `grid-auto-*`, `grid-row/column-start/end`, `overflow-x/y`, `contain`, `aspect-ratio` |
| paint | `background-*` (all longhands, layered), `color`, `opacity`, `mix-blend-mode`, `isolation`, `box-shadow`, `filter`, `backdrop-filter`, `clip-path`, `mask-*`, `visibility`, `transform`, `transform-origin`, `will-change`, `accent-color` |
| text | `font-family`, `font-size`, `font-weight`, `font-style`, `font-stretch`, `font-variant-*`, `font-feature-settings`, `font-variation-settings`, `font-optical-sizing`, `font-synthesis`, `line-height`, `letter-spacing`, `word-spacing`, `text-align`, `text-align-last`, `text-indent`, `text-transform`, `text-decoration-*`, `text-underline-offset`, `text-shadow`, `text-overflow`, `white-space-collapse`/`text-wrap-mode`/`white-space`, `text-wrap-style`, `word-break`, `overflow-wrap`, `hyphens`, `-webkit-line-clamp`, `direction`, `writing-mode`, `text-box-trim`, `text-box-edge`, `-webkit-background-clip`/`background-clip` |
| svg | `fill`, `fill-opacity`, `stroke*`, `paint-order`, `vector-effect` (inlined into the SVG, §5.4) |

**Diffing against defaults.** Before serialization, values equal to a per-tag default are dropped. The defaults come from a sandbox iframe's computed style for a bare element of that tag, the modern-screenshot `get-default-style.ts` technique. This cuts IR size by about 70%. The mapper treats a missing key as the default.

---

## 4. Text

### 4.1 Inline formatting contexts

A **text-bearing block** is an element that establishes an inline formatting context and has non-empty rendered text descendants.

For each one, the serializer extracts **one text fact** with styled runs:

- `characters`
- `runs`
- `lines`

It stops at atomic inlines: `inline-block`, `inline-flex`, `inline-grid`, and replaced elements such as `img`, `svg` and form controls. These are emitted as child nodes, with a `breaksRun: true` marker so the mapper knows the text is split around them.

Inline elements that carry paint (`<mark>`, `<code>` with background, links with borders) contribute their runs to the text and also emit **overlay facts** (`fragments`, §3.1).

**Run extraction.** This follows the algorithm in the research brief §3.1, with these changes:

- **Per-word Range measurement.** Ranges are measured per word: split on whitespace boundaries, then measure each word with one `Range`. A range is split down to per character only when a word straddles a line break, detected by its rect height exceeding 1.5× the line height or by multiple client rects. This avoids O(n) ranges.
- **Whitespace collapse.** Collapsing follows the rendered result, not a reimplementation: a whitespace character is kept iff its Range rect has width >0.01, or it is `\n` under `pre*`/`preserve-breaks`.
- **`<br>`.** A `<br>` inside a block becomes U+2028 (LINE SEPARATOR). Separate blocks are never merged by capture; the mapper may merge them.
- **Run styles.** Each run carries a `styleId`, a key into `CaptureDoc.textStyles`. It is the hash of the text-relevant computed subset (§3.2 text group, plus `color` and the effective `text-decoration` propagated from ancestors), plus `href` for the closest `<a>`.
- **Gradient text.** If an ancestor (up to the block) has `background-clip:text`, the run records `gradientFrom`, the `CNode` id of that ancestor. The mapper sizes the gradient to that element's box.

### 4.2 Lines

`lines[]` is the browser's line breaking, recorded as truth:

```ts
interface LineFact { top: number; height: number; baseline?: number; left: number; width: number; startChar: number; endChar: number }
```

- **Line boxes** come from the client rects of the per-word ranges, grouped by top (±1px). `startChar`/`endChar` index into `characters`.
- **Baselines.** The baseline is measured with an inline zero-size `<span style="display:inline-block;width:0;height:0;vertical-align:baseline">` probe inserted at the first character of each line, then removed. This runs only when the line count is >1 or `align-items: baseline` is involved. Otherwise it is computed from font metrics ([07](07-mapping.md)).
- **`line-height: normal`.**
  - **Multiple lines:** measure the pitch, which is the median difference between consecutive `top`s.
  - **Single line:** run one probe. Clone the block's font styles into an off-screen `<div style="line-height:normal">x</div>` and read `offsetHeight`.
  - **Recording:** the result is stored as `lineHeightPx`, which is always explicit (D-17).
  - **Exceptions:** Never use 1.2 × size (it is wrong for Inter, Roboto and others).
- **Truncation facts:**
  - `text-overflow:ellipsis` with `overflow:hidden` and nowrap → `truncation:{maxLines:1}`.
  - `-webkit-line-clamp:N` → `truncation:{maxLines:N}`.
  - The **full** source text is captured, because the ellipsis is drawn by the browser.
- **Directionality.** Store `direction` and resolve `text-align: start|end`. For RTL, `lines[].left` is the visual left.

### 4.3 Fonts actually used (D-17) <a id="fonts"></a>

For each text-bearing block, and for each distinct run `styleId`, take the run's parent element. The CDP method reports for an element's child text nodes, so a run whose parent is shared with other runs is attributed by majority.

Then call `CSS.getPlatformFontsForNode(nodeId)`. It returns `fonts: [{familyName, postScriptName, isCustomFont, glyphCount}]`, sorted by glyph count.

```ts
interface FontUse { familyName: string; postScriptName: string; isCustom: boolean; glyphCount: number }
// run.fontsUsed: FontUse[]; dominant = fontsUsed[0]
```

- **More than one entry means fallback happened.** The serializer then splits the run by Unicode script (Latin, CJK, Arabic, emoji…) using `Intl.Segmenter` plus script regexes. Each sub-run is re-queried via a temporarily wrapped `<span>`, which is unwrapped afterwards (cost is paid only when there are multiple fonts). Each sub-run gets its own dominant face (`FONT_FALLBACK_USED`, info).
- **Synthetic styles.** If the computed weight is ≥600 but the `postScriptName` does not contain a weight token ≥ SemiBold, flag `synthetic: ['bold']`. If the style is italic or oblique but the postScriptName lacks Italic/Oblique, flag `synthetic: ['italic']` (`FONT_SYNTHETIC`, warn).
- **Web font inventory.** Record `document.fonts` with `family`, `weight`, `style`, `stretch`, `unicodeRange`, `status` and the `src` URL. The URL is resolved by scanning `@font-face` rules through CDP `CSS.getStyleSheetText` on stylesheets whose rule text contains `@font-face`. This goes into `CaptureDoc.fonts`, so the plugin's font preflight ([09](09-plugin.md), [11](11-ux.md)) can say "Acme Sans 600 is a web font loaded from …/acme-600.woff2; install it in Figma".
- **Variable fonts.** Record `font-variation-settings` and, through the face inventory, whether the face is variable. This uses `fvar` detection: the CLI fetches the font file (cached by URL hash) and parses it with `fontkit`, which runs in Node, not in the page. It records the axes and the ascender, descender, lineGap and unitsPerEm metrics needed by [07](07-mapping.md) for baseline and line-height checks.

### 4.4 Icon fonts (S-09) <a id="icon-fonts"></a>

A run is classified as an icon font if any of these hold:

- the family matches a known list: Material Icons/Symbols, Font Awesome, Ionicons, Phosphor, Remix, bootstrap-icons, icomoon;
- every codepoint is in the PUA (U+E000–F8FF, U+F0000+);
- it is a ligature icon, meaning the text is ASCII but the rendered width differs by more than 30% from the same string in the computed fallback face. That width is measured in an off-screen span.

The run is then marked `iconFont: { family, text, codepoints }`.

- The **CLI** converts it to SVG. It fetches the font file, and `harfbuzzjs` shapes the text (honouring GSUB ligatures). fontkit then gives the glyph outlines, from which the CLI builds an SVG path scaled to the font size, using the color of the run.
- The result is stored as an SVG asset, and the node becomes `kind:'svg'` in the mapper.
- On success the CLI emits `FONT_ICON_VECTORIZED` (info).
- If shaping fails, the fallback is a clip screenshot at DPR 2 (`SVG_ICON_FONT_RASTERIZED`, warn).

---

## 5. Replaced content, form controls, media, SVG

### 5.1 Images <a id="images"></a>

- **`<img>`.** Use `currentSrc`, which is the resolved candidate from `srcset`/`picture`. Record `naturalWidth/Height`, `object-fit` and `object-position`, plus `alt`.
- **CSS images.** Record `background-image` (`url()`), `mask-image`, `border-image-source` and `list-style-image`, each layer with its `background-size/position/repeat/origin/clip`. Gradients are **not** assets; they are parsed into paint facts (§7.2).
- **Fetching** happens in Node, never via in-page `fetch`, which would hit CORS. First choice is CDP `Network.getResponseBody` for the request id that loaded the URL; request ids are tracked by URL during settle. Otherwise use `context.request.get(url)` with the same auth. `data:` URLs are decoded locally. `blob:` URLs are read in-page through `fetch(blobUrl)` and `arrayBuffer`, which is allowed because they are same-origin.
- **Normalization.** Figma accepts PNG, JPEG and GIF up to 4096×4096 only ([research Figma brief](../research/)):

| Input | Action |
|---|---|
| PNG/JPEG ≤4096 | as-is |
| GIF | as-is. Animated GIFs keep their first frame plus `CAP_ANIMATED_GIF` (info) |
| WebP/AVIF/HEIC/ICO/BMP | decoded with `sharp` and re-encoded as PNG (lossless sources: lossless PNG) or JPEG q92 (photographic: entropy heuristic), with `CAP_IMAGE_TRANSCODED` (info) |
| SVG referenced by `<img>`/CSS | **kept as SVG** (vector, [09](09-plugin.md)) when it has no `<script>`/`<foreignObject>` and is ≤256 kB. Otherwise rasterized at DPR 2 |
| any >4096 px on an axis | downscaled to fit 4096, preserving aspect ratio (`CAP_IMAGE_DOWNSCALED`) |

- **Assets** are content-addressed: `sha256` of the normalized bytes goes into `CaptureDoc.assets[sha]`, holding a `CAsset` ([06 §2.3](06-ir.md)). The bytes live in `assets/<sha256>`. Dedup happens across the whole run.

### 5.2 Canvas, video, embeds

- **`<canvas>`:**
  - not tainted: use `toDataURL('image/png')`;
  - tainted or WebGL with `preserveDrawingBuffer:false`: take an element clip screenshot instead;
  - in both cases, record it as an image fact (`CAP_CANVAS_RASTERIZED`, info).
- **`<video>`:**
  - if it has a `poster`, use the poster;
  - otherwise, after `currentTime=0` and `seeked`, draw the frame to a canvas;
  - if that fails, take a screenshot.
- **`<object>`/`<embed>`** are captured by screenshot.

### 5.3 Form controls <a id="controls"></a>

- **`appearance: none`** (most design systems): walk the control as an ordinary box. Add its text, which is `value`, or `placeholder` when the value is empty, along with the `::placeholder` computed color (§5.5).
- **Native appearance:** record `nativeControl` facts so the mapper can synthesize ([07](07-mapping.md)):

```ts
type ReplacedFacts =
 | { kind: 'img'; assetId; natural:{w,h}; fit; position }
 | { kind: 'svg'; assetId }                                   // §5.4
 | { kind: 'raster'; assetId; reason: string }
 | { kind: 'native-control'; control: 'checkbox'|'radio'|'select'|'range'|'progress'|'meter'|'color'|'file'|'date'|'text';
     checked?: boolean; indeterminate?: boolean; value?: string|number; min?: number; max?: number;
     selectedText?: string; accentColor?: string; placeholder?: string;
     fallbackAssetId: string /* element screenshot DPR2, always taken */ };
```

  The screenshot fallback is always captured, because native rendering differs per OS. The mapper chooses between synthesis and the raster according to `mapper.nativeControls: 'synthesize' | 'raster'`, default `synthesize` ([16](16-config.md#mapper)).

### 5.4 Inline SVG serialization

Serialize a **clone** with resolved presentation:

1. **Inline styles.** For every element in the SVG subtree, inline the computed `fill`, `fill-opacity`, `fill-rule`, `stroke`, `stroke-width`, `stroke-opacity`, `stroke-dasharray`, `stroke-dashoffset`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `opacity`, `visibility`, `display`, `transform` (computed matrix), `font-*` (for `<text>`), `paint-order` and `vector-effect` as **attributes**.
2. **`currentColor`.** Replace it with each element's resolved `color`, recording `currentColorUsed: true`. The mapper then marks those fills as "tintable" for instance overrides ([04 §11.4](04-variant-model.md#worked-examples)).
3. **`var()` in attributes.** These are already resolved by step 1.
4. **`<use href>`.** Resolve the target by id in the SVG's own root, then the document, then **every shadow root** in the composed tree. This is the modern-screenshot `embed-svg-use.ts` technique. For external sprites (`sprite.svg#id`), fetch them in Node (§5.1) and extract `#id`. Inline the target as a `<g>` with the `<use>`'s x, y and transform applied. A `<symbol>` becomes a nested `<svg>` with its `viewBox`. A target found nowhere is dropped, with `SVG_USE_UNRESOLVED` (warn).
5. **`<defs>`.** Copy every referenced `<defs>` entry: `linearGradient`, `radialGradient`, `clipPath`, `mask`, `pattern`, `filter`, `marker`. Rename ids with a `h<n>-` prefix to avoid collisions, and rewrite the `url(#…)` references.
6. **Root size.** Set explicit `width`, `height` and `viewBox` from the rendered box. Strip `class`, `style`, `data-*`, event handlers and `<script>`.
7. **Risk classification:** `svgRisk: 'safe'|'filter'|'mask'|'foreignObject'|'text'`. SVGs with filter, mask or foreignObject are rasterized by default (§5.1 rules, `SVG_RASTERIZED`), because `createNodeFromSvg` handles them poorly (verify, S-09). `capture.svg.rasterizeFilters: false` keeps them as vectors ([16](16-config.md#capture)).
8. **Normalization hash** for icon dedup ([07](07-mapping.md), [09](09-plugin.md)): `sha256` of the canonical SVG, meaning attributes sorted, numbers rounded to 1e-3, ids renamed, and **fill/stroke colors replaced by a placeholder** when `currentColorUsed`. This makes the same icon in different colors dedupe to one icon component.

The result is an asset `{mime:'image/svg+xml', svgText}`.

### 5.5 Pseudo-elements

Read `getComputedStyle(el, '::before' | '::after' | '::marker' | '::placeholder')`. A `::before`/`::after` exists iff `content ∉ {none, normal}` and `display ≠ none`.

- **Box (preferred, non-mutating).** In the pierced CDP document, element nodes carry `pseudoElements[]` with `pseudoType ∈ {before, after, marker}`. For their node ids, call `DOM.getBoxModel` and `CSS.getComputedStyleForNode`. Pseudo-element text rects come from `DOM.getContentQuads`.
- **Content resolution** happens in-page, reimplementing html2canvas `document-cloner.ts` L380–470:
  - strings and `attr(x)`
  - `counter()`/`counters()`, evaluated by walking `counter-reset`/`counter-increment` in DOM order
  - `open-quote`/`close-quote` with `quotes`
  - `url()`, which becomes an image asset
  - `content: ""` with a box means a pure decoration (common for icons and dividers)
- **Fallback materialization.** When CDP returns no pseudo node, for example in closed shadow roots in some versions:
  - Cloning the document into a hidden iframe is too expensive. Instead, insert `<holotype-pseudo>` with the computed styles inlined, and hide the original via an injected `[data-holotype-hide-before]::before{content:none!important}`. Measure, then remove. The pseudo-element becomes a node, with `CAP_PSEUDO_MATERIALIZED` (info).
  - Verify that the parent rect is unchanged before and after. If it changed, discard the measurement and emit `CAP_PSEUDO_UNMEASURED` (warn).
  - Selectors like `:nth-child`/`:empty` may change during insertion. This is why the verification exists.
- **`::marker`.** Use the CDP marker node. Its text is `list-style-type` formatted through `Intl` plus our counter-style table (ported from satori `counter-styles.ts`). An image marker comes from `list-style-image`.
- **`::placeholder`.** Captured when `value===''` and a placeholder exists, with the `::placeholder` color and font.

Pseudo-elements become child `CNode`s (`type: 'pseudo'`) with `source.pseudo` set. `::before` is the first child and `::after` the last, which matches paint and flow order.

---

## 6. Authored styles (needed by [07](07-mapping.md) and [08](08-tokens.md)) <a id="authored"></a>

Computed style loses *intent*: `auto`, `fr`, `minmax()`, `var(--x)` and percentages all arrive resolved to px or colors. Two sources recover it.

### 6.1 Typed OM keywords (in-page, cheap)

`el.computedStyleMap()` keeps keywords and percentages. For `width`, `height`, `min-*`, `max-*`, `flex-basis`, `margin-*` (to spot `auto`) and `inset-*`, record:

```ts
type TypedKeywords = Partial<Record<'width'|'height'|'minWidth'|'maxWidth'|'minHeight'|'maxHeight'|'flexBasis'
  |'marginTop'|'marginRight'|'marginBottom'|'marginLeft'|'top'|'right'|'bottom'|'left',
  { kw: 'auto'|'fit-content'|'min-content'|'max-content'|'none' } | { pct: number } | { px: number } | { calc: string }>>;
```

Use the element's own realm for the `instanceof CSSKeywordValue` checks (iframes), following figit `hasContentSizedKeyword`.

### 6.2 Matched styles via CDP (orchestrator)

`CSS.getMatchedStylesForNode(nodeId)` returns:

- `inlineStyle`
- `attributesStyle`
- `matchedCSSRules[]`, each with `rule.selectorList`, `style.cssProperties[{name, value, important, disabled, parsedOk}]` and `rule.media`/`containerQueries`
- `pseudoElements`
- `inherited[]`
- **`cssKeyframesRules`** (ignored)

For each node we store only the **winning declaration** for each property in a fixed set:

- layout-intent properties: `width`, `height`, `flex*`, `grid-template-*`, `grid-*`, `gap`, `justify-*`, `align-*`
- all paint, spacing, radius and typography properties that could be token-bound

The winner is chosen by the cascade: important > specificity > order. CDP returns rules in cascade order, so the winner is the last applicable non-disabled declaration, with `!important` overriding.

```ts
interface AuthoredDecl { value: string /* raw, e.g. "var(--btn-bg, var(--color-primary))" */;
  source: 'inline'|'rule'|'attr'|'inherited'; selector?: string; media?: string; container?: string; important?: boolean;
  sheet?: { styleSheetId: string; range: { startLine: number; startColumn: number; endLine: number; endColumn: number } } }  // branch mode
type AuthoredStyles = Record<string /* property */, AuthoredDecl>;
```

**Rule locations (branch mode, D-36).** For DCR provenance ([15 §5](15-change-requests.md#provenance)) the orchestrator also keeps, for each winning `rule` declaration, `rule.styleSheetId` and the declaration's `style.range` (0-based line/column in the *served* stylesheet). It listens to `CSS.styleSheetAdded` from `CSS.enable` onward and records each header's `sourceURL` and `sourceMapURL` in a per-document table (`CaptureDoc.styleSheets`, [06 §2](06-ir.md)).

Vite's `css.devSourcemap` defaults to false, and dev CSS is injected as `<style>` elements. The header's `sourceURL` is then the document URL (`isInline: true`). So:

- **Source maps on.** In branch mode the CLI forces `css: { devSourcemap: true }` through Storybook `viteFinal` (a `main.ts` snippet or `@holotype/vite-plugin`); `capture.devSourcemap: 'keep'` opts out ([16](16-config.md#capture)).
- **Inline sheets.** They are resolved through `CSSStyleSheetHeader.ownerNode` → `data-vite-dev-id` (the file) and the inline source map.
- **Ranges.** For inline sheets `style.range` is document-relative, so subtract `header.startLine/startColumn`.
- **No map.** A sheet with neither a source map nor `data-vite-dev-id` raises `DCR_PROVENANCE_NO_SOURCEMAP` (warn).

Resolution to the original file:line happens later, in the CLI right before mapping (the mapper itself stays pure, [07 §16.1](07-mapping.md)), and is cached per `styleSheetId` revision (verify coverage per styling approach, S-19). The ranges cost nothing extra: they are already in the `getMatchedStylesForNode` response. Outside branch mode `sheet` is omitted, so library captures and their cache keys are unchanged.

**JSX locations.** When the optional `@holotype/vite-plugin` is installed, host elements carry `data-holotype-loc="src/components/Button/Button.tsx:42:7"`. The serializer reads it into `CSource.loc` (`{file, line, col}`), validates that the path is repo-relative with no `..` segments ([15 §10.3](15-change-requests.md#security)), and strips the attribute from `attrs` so it never affects alignment or naming. Without the plugin `loc` is absent and provenance falls back to the CSS rule (`DCR_PROVENANCE_MISSING` only if both are missing).

**Custom properties.**

- For every `var(--x)` referenced by a stored declaration, also capture the **definition chain**: the winning declaration of `--x` *at this element*, which comes from matched or inherited rules (inherited custom properties are in `inherited[]`). Recurse into the `var()`s inside that value, up to depth 16. Record each step as `{name, value, definedOn: <CNode id>|'root'|'host', selector}`; the declarations land in `CaptureDoc.customProperties` ([06 §2.3](06-ir.md)).
- Also record the **computed value** of each custom property at the element: `getComputedStyle(el).getPropertyValue('--x')`.
- [08](08-tokens.md) uses the chain to bind variables and build aliases, under D-18 (provable `var()` chains only).

**Cost control.**

- Matched styles are the most expensive CDP call, at about 1–3ms each. They are fetched only for nodes that will become Scene nodes, meaning not culled and not inside rasterized subtrees, and only in `mode:'full'`.
- Results are memoized per `(stylesheet revision, selector-match signature)`. The signature is `tag + sorted classes + attribute set + pseudo state`, so 50 identical list items cost one call (verify the hit-rate, S-07).

**Media and container queries** found on winning declarations are recorded. Their presence makes the layout probe (§11) narrower, and raises `LAYOUT_BREAKPOINT_IN_PROBE` in [07](07-mapping.md).

**Unsupported properties.** A winning declaration of a property with no Figma equivalent is ignored, with `CAP_CSS_UNSUPPORTED` (warn, `data.property`).

**Adopted stylesheets.** CDP covers constructable stylesheets and shadow DOM styles (verify, S-19). If `getMatchedStylesForNode` fails for a node inside a shadow root, authored styles are omitted for it. Token binding then degrades for that node (`TOKEN_AUTHORED_UNAVAILABLE`, info).

---

## 7. Paint facts

### 7.1 Colors

- **Parsing.** Every computed color string is parsed with colorjs.io. Chromium returns modern colors in their own space: `oklch()`, `color(display-p3 …)`, and `color-mix()` results as `oklab`/`color(srgb …)`.
- **Conversion targets.** Values are stored as `{ r, g, b, a, space: 'srgb' | 'display-p3', original }`, where `original` is the raw computed string:
  - **sRGB**: always converted, with CSS gamut mapping (`toGamut({space:'srgb', method:'css'})`).
  - **Display P3**: also converted when the source is wider than sRGB.
- **Profile choice.** The plugin picks the P3 or sRGB value based on `figma.root.documentColorProfile` ([09](09-plugin.md)). `documentColorProfile` is `'LEGACY' | 'SRGB' | 'DISPLAY_P3'`; LEGACY is treated as sRGB. Capture keeps the original CSS color string, so the applier can prefer `figma.util.solidPaint(original)` ([07 §9](07-mapping.md#color); verify, S-03).
- **Fallback.** For unparseable values (exotic `color-mix` with `currentColor` in old engines), read back through a 1×1 canvas, using the web2ui technique. The result is clipped to sRGB (`PAINT_COLOR_READBACK`, info).

### 7.2 Backgrounds, gradients, shadows

**Gradients.** `background-image` layers are split at top-level commas (paren-depth aware) and parsed into structured facts:

```ts
type GradientFact = { type: 'linear'; angleDeg: number; stops: StopFact[]; repeating: boolean; interpolation?: string }
  | { type: 'radial'; shape: 'circle'|'ellipse'; size: string; rx: number; ry: number; cx: number; cy: number; stops: StopFact[]; repeating: boolean }
  | { type: 'conic'; fromDeg: number; cx: number; cy: number; stops: StopFact[]; repeating: boolean };
type StopFact = { color: ColorFact; pos: number /* resolved 0..1 on the gradient line/ray */; hint?: number };
```

- Lengths are resolved against the box, `to <corner>` against the box aspect, and the `farthest-corner` defaults are computed in-page.
- The matrix math lives in the mapper ([07](07-mapping.md); research brief §5.2). Capture records only the resolved geometry in px.

**Shadows.**

- `box-shadow` and `text-shadow` are split into a list of `{inset, x, y, blur, spread, color}`, in CSS order (first = top).
- `filter`/`backdrop-filter` are split into function lists `[{fn:'blur', px}, {fn:'drop-shadow', …}, …]`.

**Borders and radius.**

- Record per side `{width, style, color}`, the raw per-corner radii as `[h, v]` pairs, and `outline`.
- The overlap reduction factor is computed in the mapper (§5.3 of the research brief).

### 7.3 Clips and masks

- **`overflow`:** record x and y separately.
- **`clip-path`:** recorded raw plus parsed (`inset`, `circle`, `ellipse`, `polygon`, `path`, `url(#…)`, which resolves to an SVG clipPath in the composed tree), with the reference box.
- **`mask-image`:** recorded as layers of gradient or url facts.
- **Icon-mask pattern** (web2ui): a single URL mask over a solid background color. It is flagged `maskIcon:true`, and its SVG is fetched (§5.1) so the mapper can emit a tinted vector.

---

## 8. Stacking and paint order

The serializer computes, per node:

- `stackingContext: boolean`. A node creates one if it is positioned with `z ≠ auto`, has `opacity < 1`, `transform`, `filter`, `backdrop-filter`, `isolation:isolate`, `mix-blend-mode ≠ normal`, `will-change` (for an SCP property), `contain: paint|layout|strict|content`, is `fixed`/`sticky`, or is a flex/grid item with `z ≠ auto`.
- `layer`, one of the CSS 2.1 Appendix E buckets within its stacking context: `negZ | blockFlow | float | inline | positioned0 | posZ`.
- `order`, the sequence number within the bucket: order-modified document order, where `order` is applied for flex and grid items.

`children` in the Capture IR stay in **DOM (composed) order**. Paint order is reconstructed by the mapper, which also detects **z-index escapes**: a descendant painting above a sibling of its ancestor. Those are hoisted, with `LAYOUT_ZINDEX_HOIST` ([07](07-mapping.md)). The facts go into `CNode.paint` (`CPaintOrder`: `stackingContext`, `zIndex`, `layer`, `domIndex`, [06 §2.1](06-ir.md)).

---

## 9. Pseudo-state application <a id="pseudo-states"></a>

Policy is in [04 §6](04-variant-model.md#states-d-14). Mechanics:

```ts
async function forceState(cdp: CDPSession, target: ElementHandle, rootId: string, state: PseudoState) {
  const chain = await target.evaluate((el, rootId) => __holotype.ancestorChain(el, rootId), rootId);  // composed-tree ancestors, crossing shadow hosts, up to capture root
  for (const [i, h] of chain.entries()) {
    const { objectId } = (await cdp.send('DOM.resolveNode', { backendNodeId: await backendIdOf(h) })).object;
    const { nodeId } = await cdp.send('DOM.requestNode', { objectId: objectId! });   // works inside open & closed shadow roots
    const classes = i === 0 ? targetClasses(state) : ancestorClasses(state);
    // targetClasses: hover→['hover'], active→['active','hover'], focus→['focus'], focus-visible→['focus','focus-visible'], focus-within→['focus-within']
    // ancestorClasses: hover→['hover'], active→['active','hover'], focus*/→['focus-within']
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes });
    forced.push(nodeId);
  }
}
// Clearing: forcePseudoState({nodeId, forcedPseudoClasses: []}) for every forced node; forced states are also dropped if the node is re-created (re-force after re-render).
```

- **Real focus.** For `focus`/`focus-visible`, the target's `:focus` is forced, but **actual focus is not moved**. Components that render focus rings via JS (`data-focus-visible` from react-aria) therefore need `mode:'interact'`. The planner's no-effect check catches this ([04 §6.4](04-variant-model.md#states-d-14)).
- **Interaction mode:**
  - `hover`: `target.hover({force:true})`.
  - `focus-visible`: `page.keyboard.press('Tab')`, repeated until `document.activeElement` (composed) is the target, at most 50 times; otherwise `target.focus()` plus `CAP_FOCUS_VISIBLE_UNREACHED`.
  - `active`: `mouse.move` to the center, then `mouse.down()` and capture, then `mouse.up()` after.
  - Then settle again and capture. Reset with `mouse.move(0,0)`, `blur`, and a `forceRemount` if `remount` is set.
- **Re-render guard.** If the framework re-renders on hover (common), CDP forced state on a replaced node is lost. The capture verifies after settle that the forced nodes are still connected, re-forcing once if not (`CAP_STATE_LOST`, warn).

---

## 10. Determinism and cache key <a id="determinism"></a>

### 10.1 Determinism measures

- D-24 context settings and pinned Chromium (D-05).
- `Date` frozen with `setFixedTime`, and seeded `Math.random`.
- Animations frozen ([03 §5.5](03-storybook.md#settle-protocol)).
- Fonts and images awaited.
- Serialization is canonical: sorted keys, numbers rounded to 1/64 px for geometry and 1e-4 for colors, stable node `id`s from walk order.
- CI gate ([03 §12](03-storybook.md#version-and-framework-test-matrix)): three consecutive captures of each fixture must produce an identical `captureHash`. One fixture story renders `new Date().toISOString()`; it must hash identically across the 3 runs.

### 10.2 Capture cache key

Single definition: [02 §5.4](02-architecture.md#capture-key). Why each input matters:

| Input | Why |
|---|---|
| capture engine version, Capture IR major | serializer or schema changes invalidate old captures |
| Chromium and Playwright versions | layout and text rendering differ between builds (D-05) |
| Storybook build hash, index hash, story id ([03 §9](03-storybook.md)) | the rendered code and story |
| args, globals, state, viewport, width, remount (from `PlannedVariant`) | what is rendered |
| DPR, locale, timezone, color scheme, reduced motion, UA (D-24) | the rendering context |
| capture options (mode, native controls, SVG, exclude, root selector, unwrap, portal) | what is serialized |
| host fonts fingerprint | installed system fonts can change fallback rendering |

Dev server: branch mode keys on `H(baseCommit ∥ dirtyTreeHash)`; otherwise a per-run nonce ([03 §9.2](03-storybook.md#dev-server)) unless `--trust-dev-cache`.

The cache stores the Capture IR (`.json.gz`, fflate), the assets (`assets/<sha256>`, 02) and the screenshot. A local LRU cap of 2 GB is configurable, and a remote cache in CI uses the same keys ([12](12-quality.md)).

---

## 11. Layout probing <a id="probing"></a>

This is enabled by `width: { probe: [...] }` ([04 §7.3](04-variant-model.md#themes)). It is also enabled automatically for components that the mapper flags as having ambiguous sizing after the first pass. The mapper requests re-probes through `planner`, at most once.

1. After the main serialize, keep the `data-holotype-id` stamps in the DOM.
2. For each probe width `W`, constrain the root wrapper: inject `#storybook-root > [data-holotype-id="<root>"] { width: Wpx !important }` for root width probes. For container probes, set `#storybook-root{width:Wpx}`. Then `await settle(short)`.
3. Measure the border box of every `[data-holotype-id]` with `__holotype.measure(ids)`. This is a batched `getBoundingClientRect`. Re-query text `lines` only for text blocks.
4. **Re-mount detection.** If more than 10% of ids are missing (the framework re-mounted on resize), match nodes by `source.path` plus tag/class signature instead, and emit `CAP_PROBE_REMOUNTED` (info).
5. Record `probes: CProbe[]` ([06 §2.3](06-ir.md)): per width, the rect of each node by `CNode` id, plus a structure hash. Interpretation (FILL/HUG/FIXED via `k = Δchild/ΔparentInner`) is done in the mapper ([07](07-mapping.md)).
6. If any winning declaration has `@media`/`@container` (§6.2), probe widths are restricted to the range that doesn't cross a breakpoint boundary. The breakpoint values are parsed from the media text. Crossing widths are skipped, with `LAYOUT_BREAKPOINT_IN_PROBE` (info).

Default probe widths are `[0.75W, W, 1.25W, 320]`, where W is the natural width. Each probe costs about one short settle plus one measure, roughly 30–60ms.

---

## 12. Portals and multi-root

- The story root is `CaptureDoc.root`. Portals from [03 §6.3](03-storybook.md#portals-and-overlays) go into `CaptureDoc.portals[]`, in paint order. There is no virtual root. `CaptureDoc.rootRect` is the union rect of root and portals in page space; all geometry stays page-space.
- Fixed-position backdrops are kept as the first portal (bottom).
- `position: fixed` elements inside the normal root are captured relative to the viewport. They are marked `fixedToViewport:true`, and the mapper places them absolutely.

---

## 13. Capture IR fill contract

Schema in [06 §2](06-ir.md) (06 owns every name). Capture **must** fill:

| Field | Must contain |
|---|---|
| `captureVersion`, `engine` | schema semver; capture engine name and version, Chromium and Playwright versions |
| `target` | story url (credentials stripped), `storyId`, `sid`, `vk`, applied args and globals, `state`, viewport, DPR, color scheme, resolved root selector |
| `timing` | render, settle and serialize ms |
| `rootRect`, `root`, `portals` | union rect; the `CNode` tree of the story root (§3), in DOM composed order; body-level portals (§12). No virtual root |
| per `CNode` | `id`, `type`, `source`, `borderBox`, `computed` (diffed against defaults), `paint`, `children`; plus, where applicable, `quads`/`transform`/`untransformed`/`nonAffine`, `authored` (full mode), `fragments`, `replaced`, `text`, `scroll` |
| `CNode.text` | `characters`, `runs[{start, end, styleId, href?, gradientFrom?}]`, `lines`, wrap and truncation facts, `textAlign` (resolved) |
| `textStyles` | `styleId` → `CTextStyle` (family list, used faces, weight, italic, stretch, size, `lineHeightPx`, letter spacing px, transform, decoration, color, features, variation, synthetic) |
| `fonts` | `CFontUsage` inventory: used faces, web-font `srcUrl` and `status`, icon-font flag |
| `assets` | `sha` → `CAsset` (bytes stored out of line in `assets/<sha>`) |
| `customProperties` | the declarations table (§6.2): name, value, resolved value, selector, origin |
| `probes?` | `CProbe[]` (§11) |
| `styleSheets?` | stylesheet headers, branch mode only (§6.2) |
| `screenshot?` | `AssetRef` of the root clip screenshot @2x, used by the fidelity harness ([12](12-quality.md)) |
| `diagnostics` | `CAP_*`, `FONT_*`, `SVG_*`, `PAINT_*` entries with the `CNode` id |

Probe-mode documents fill only `captureVersion`, `engine`, `target`, `root` (with `borderBox`, `source.path`, `source.tag` and text `characters`), `probes` and `diagnostics`.

---

## 14. Performance budget (capture side)

| Step | Target (Button, about 60 nodes; warm page) |
|---|---|
| render + settle | ≤200ms (args update; no navigation) |
| in-page serialize | ≤40ms |
| CDP enrichment (boxes for transformed nodes, fonts, matched styles) | ≤60ms |
| assets (cached) | ≈0ms; first fetch is network-bound |
| screenshot | ≤40ms |
| **total** | **≤400ms median** (README §4) |

Probe capture is ≤120ms. Main levers:

- per-word Range measurement (§4.1);
- defaults diffing (§3.2);
- matched-style memoization (§6.2);
- one worker per component (warm story);
- CDP pipelining (§2.3).

Capture-side throughput is measured in S-07; S-06 covers the plugin side.

---

## 15. Failure handling

| Failure | Behaviour |
|---|---|
| render error or timeout | variant failed (`SB_*`). The other variants continue. A component with <50% successful variants fails, with all diagnostics |
| serializer exception | retry once after `reload()`. If it fails again, `CAP_SERIALIZE_FAILED` (error, with stack) |
| CDP call failure for a node | degrade that node: missing authored styles (`TOKEN_AUTHORED_UNAVAILABLE`), missing transformed box (fast-path rect plus `CAP_BOX_MODEL_FAILED`), missing platform fonts (fall back to the first family in the list plus `FONT_UNRESOLVED`) |
| asset fetch failure | placeholder gray image fill plus `CAP_ASSET_FETCH_FAILED` (warn) |
| oversized document (>20 MB Capture IR or >5,000 nodes) | `CAP_DOC_TOO_LARGE` (warn). Subtrees beyond 5,000 nodes are rasterized, largest first |
| browser crash | §1.1 recovery |
| non-determinism detected (cache verification mode) | `CAP_NONDETERMINISTIC` (warn), with the differing node paths |

---

## 16. Diagnostics coined here

| Code | Severity | Meaning |
|---|---|---|
| `CAP_PAGE_CRASHED` | warn | page crashed; retried |
| `CAP_SR_ONLY_SKIPPED` | info | screen-reader-only content skipped |
| `CAP_CLIPPED_CULLED` | info | fully clipped node removed |
| `CAP_IFRAME_RASTERIZED` | warn | iframe captured as a raster |
| `CAP_NON_AFFINE_RASTERIZED` | warn | 3D transform subtree rasterized |
| `CAP_ANIMATED_GIF` | info | first frame only |
| `CAP_IMAGE_DOWNSCALED` | info | image >4096 px downscaled |
| `CAP_IMAGE_TRANSCODED` | info | WebP/AVIF/HEIC/ICO/BMP re-encoded as PNG or JPEG |
| `CAP_CANVAS_RASTERIZED` | info | canvas captured as an image |
| `CAP_PSEUDO_UNMEASURED` | warn | pseudo-element could not be measured |
| `CAP_FOCUS_VISIBLE_UNREACHED` | warn | Tab navigation did not reach the target |
| `CAP_STATE_LOST` | warn | forced state lost due to re-render |
| `CAP_PROBE_REMOUNTED` | info | layout probe matched by path |
| `CAP_SERIALIZE_FAILED` | error | serializer threw |
| `CAP_BOX_MODEL_FAILED` | info | CDP box model unavailable |
| `CAP_ASSET_FETCH_FAILED` | warn | asset missing |
| `CAP_DOC_TOO_LARGE` | warn | partial rasterization |
| `CAP_NONDETERMINISTIC` | warn | repeated captures differ |
| `CAP_PSEUDO_MATERIALIZED` | info | pseudo-element measured through the materialization fallback (§5.5) |
| `CAP_CLOSED_SHADOW_LATE` | warn | closed shadow root created before the hook; read through CDP (§2.2) |
| `CAP_CSS_UNSUPPORTED` | warn | CSS property with no Figma equivalent ignored (§6.2) |
| `DCR_PROVENANCE_NO_SOURCEMAP` | warn | dev-server stylesheet without source map or `data-vite-dev-id` (§6.2) |
| `FONT_ICON_VECTORIZED` | info | icon-font glyphs converted to vector paths (§4.4) |
| `SVG_USE_UNRESOLVED` | warn | SVG `<use>` target not found (§5.4) |
| `FONT_FALLBACK_USED` | info | run split by script due to fallback |
| `FONT_SYNTHETIC` | warn | synthetic bold or italic |
| `FONT_UNRESOLVED` | warn | platform font unknown |
| `SVG_ICON_FONT_RASTERIZED` | warn | icon-font glyph rasterized |
| `SVG_RASTERIZED` | warn | SVG with filter, mask or foreignObject rasterized (emitted by the mapper, [07](07-mapping.md)) |
| `PAINT_COLOR_READBACK` | info | color resolved through canvas readback |
| `TOKEN_AUTHORED_UNAVAILABLE` | info | no matched styles for node; token binding degraded |
