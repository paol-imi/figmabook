> Research brief produced during planning (Nov 2026). Source of truth for the plan is `internal/plan/`; this file is kept as a cited reference.

# DOM to Figma conversion: technical brief and mapping spec

## 0. What I studied (sources and what each teaches)

I cloned the repos below and read their source. Paths are relative to each repo.

| Project | Key files | Takeaway |
|---|---|---|
| **BuilderIO/html-to-figma** (code removed from HEAD in March 2025; last full tree is `7fece25`) | `lib/html-to-figma/index.ts`, `helpers/{text,styles,frames,svg,image,dimensions}.ts`, `plugin/code.ts` | The naive baseline. It flattens every element into absolute RECTANGLEs plus TEXT, then rebuilds a frame tree from `ref.parentElement` (`frames.ts makeTree`). There is no auto layout. Borders are read only from the `border` shorthand, and per-side borders become extra rectangles. There is one box-shadow and no font weight (the plugin only matches `style === "Regular"`). It inlines `<use>` by replacing outerHTML. Worst hack: `plugin/code.ts` around L595 shrinks `fontSize` by 1 in a loop until Figma's text box fits, which corrupts typography. |
| **sergcen/html-to-figma** (fork, `27dc42d`) | `src/browser/dom-utils.ts`, `text-to-figma.ts`, `figma/getFont.ts` | Measures pseudo-elements by appending a `<span>` that copies every computed property (`getBoundingClientRectPseudo`). Reads input value or placeholder text. Sorts children by z-index. Font matching still ignores weight. |
| **figitdesign/web-to-figma** (`@figit/dom-to-figma`, `859efea`, MIT). The most rigorous project found. | `converter/layout/infer.ts`, `styles/gradient.ts`, `styles/blur.ts`, `styles/shadow.ts`, `nodes/frame/{converter,border-decomposition}.ts`, `nodes/text/converter.ts`, `dom.ts`, `internal/oracle-harness/` | Auto layout is inferred and then **geometry-verified**, with fallback to absolute per container. It simulates Figma's wrap packing. Hug, fill and stretch are emitted only when provably a no-op. It reads `computedStyleMap()` to recover `auto` keywords. It has gradient math normalized to the box, blur σ→radius ×2, per-side border decomposition into vectors, ring box-shadow promoted to a stroke, mid-line wrapped text splitting, and a "parity ratchet" CI. Output is Figma's kiwi clipboard format, not the Plugin API. |
| **Lynavo/web2ui** (`6753aaf`, AGPL) | `src/core/capture/in-page-extractor.ts` (7.5k LOC) | Composed-tree walk (`assignedElements({flatten:true})` and `shadowRoot`). Resolves oklch, lab and color-mix through a 1×1 canvas readback (around L305). Detects web-font load and failure through `document.fonts` (around L2373). Detects fallback glyphs by diffing canvas pixels against `sans-serif` (around L2525). Converts mask-image icons into tinted assets. Handles transformed pseudo paint rects and sr-only detection (`clip-path: inset(50%)`). |
| **html2canvas** (`src/dom/document-cloner.ts` L380–470) | Pseudo materialization | Creates a real `<html2canvaspseudoelement>` from `getComputedStyle(el,'::before')`. Resolves `content` tokens (strings, `attr()`, `counter()`/`counters()`, quotes, `url()`). Hides the original with an injected class rule. |
| **modern-screenshot** (`src/get-default-style.ts`, `copy-pseudo-class.ts`, `embed-svg-use.ts`) | Style diffing and `<use>` | Diffs computed styles against defaults from a sandbox iframe, which is useful for "is this style meaningful". Copies `<symbol>` defs across shadow roots into a local `<defs>`. |
| **satori** (`src/font.ts` around L905) | Text metrics | Computes `line-height: normal` as `(ascender − descender + lineGap)/upm × size`, with OS/2 versus hhea selection. This is the same model you need to predict Chromium. |
| **figma/plugin-typings** (Oct 2026) | `plugin-api.d.ts` | Current API: `layoutMode:'GRID'` with `GridTrackSize{FLEX|FIXED|HUG}` and `setGridChildPosition`/`gridRowSpan`. `FontNameInput.variationSettings` sets variable axes with no style name needed. Also `textTruncation`/`maxLines`, `leadingTrim`, `textDecorationStyle`/`Color`, `strokesIncludedInLayout`, `itemReverseZIndex`, `documentColorProfile` (sRGB/P3), and `showShadowBehindNode`. Shadow **spread is accepted only on rect/ellipse, or on frames with a visible fill and `clipsContent`** (L4369). |
| **Figma Code to Canvas** (`generate_figma_design`, Feb 2026; help.figma.com/hc/en-us/articles/40826832449303) | Closed source | Third-party reports say it misses shadow DOM, turns `background-clip:text` into solid text, captures only the viewport, and drops glyphs for CJK fonts (blog.codeminer42.com/figma-code-to-canvas-what-the-demo-didnt-show-you). These are the known gaps to beat. |
| Penpot | | No built-in HTML importer. The community "HTML TO DESIGN" plugin and the "Penpot Visual Fetch" extension exist. Penpot's flex-layout→CSS inspect output is another inverse-mapping reference. |

**Inverse mapping (Figma Dev Mode output) to target:**

- auto layout → `display:flex; flex-direction; gap; padding; align-items; justify-content`
- FILL on the primary axis → `flex: 1 0 0` (basis 0, no shrink)
- FILL on the counter axis → `align-self: stretch`
- HUG → no size declared
- FIXED → `width: Npx`
- wrap → `flex-wrap: wrap` + `row-gap`/`align-content`
- absolute child → `position:absolute`

Read in reverse, the CSS→Figma mapping is **lossy in exactly the places where CSS has concepts Figma lacks**: margins, per-child cross alignment other than stretch, flex-basis and weighted grow, shrink, and baseline nuances. Section 3 is about detecting those cases.

---

## 1. Architecture

```
[Playwright/Chromium]                                [Figma plugin]
 story render → stabilize → CAPTURE (page JS + CDP) → IR(JSON) → BUILD → VERIFY (read back bboxes) → patch/fallback
                    ↑ layout probing (re-measure at N widths)
```

Principles, all validated by figit's results:

1. **The browser's measured geometry is ground truth.** CSS is only used to infer *intent*: hug, fill or fixed, and the alignment semantics.
2. **Auto layout is an optimization over absolute positioning.** Emit it per container only when a simulation (capture side) *and* a read-back (plugin side) reproduce the rects within tolerance (0.5–1px).
3. **Capture everything raw into the IR and decide in a separate pass.** Do not make Figma decisions in page JS. This lets you re-run the inference without re-rendering.

**Stabilize before capture:**

- `document.fonts.ready`.
- `img.decode()` for every image.
- Disable animations and transitions (`*{animation:none!important;transition:none!important;caret-color:transparent}`), or use `page.emulateMedia({reducedMotion:'reduce'})`.
- Wait 2 rAFs.
- Set a fixed `deviceScaleFactor` (2, for raster assets).
- Pin `Date` and `Math.random` if stories animate.

---

## 2. Capture strategy

### 2.1 Tree walk: the composed (flat) tree

Walk the **render tree**, not the DOM:

```ts
function* composedChildren(n: Node): Iterable<Node> {
  if (n instanceof HTMLSlotElement) {
    const a = n.assignedNodes({ flatten: true });
    yield* (a.length ? a : n.childNodes);          // fallback content when nothing is slotted
    return;
  }
  const root = (n as Element).shadowRoot ?? closedRoots.get(n as Element);
  yield* (root ? root.childNodes : n.childNodes);  // light children of a host only render via slots
}
```

- **Closed shadow roots.** Use `page.addInitScript` to wrap `Element.prototype.attachShadow` and stash each root in a `WeakMap` (`closedRoots`) before the story mounts. Alternatively use CDP `DOM.getDocument({depth:-1, pierce:true})`, which returns `shadowRoots` with `shadowRootType:'closed'`. CDP is also the fallback for roots created before your script ran.
- **`display:contents`.** Includes slots by default. Emit no node and splice its children into the parent. Its inherited styles are already in the children's computed styles.
- **Iframes.** Same-origin: recurse into `contentDocument` and offset by the iframe's content box. Cross-origin or OOPIF: Playwright `frame.evaluate` per frame, then compose the offsets. As a last resort, use a screenshot.
- **Skip** `script/style/template/head/noscript/meta`, `display:none`, and `<source>` inside `<picture>` (BuilderIO).
- **`visibility:hidden`.** Emit nothing, but the element's visible descendants (`visibility:visible`) must still be walked.
- **`opacity:0`.** Emit with `visible:false`, so state variants stay toggleable, or skip it, as an option.
- **Content clipped away.** Elements whose ancestors' overflow clip removes them entirely can be culled.
- **sr-only.** Skip `clip: rect(0 0 0 0)` and `clip-path: inset(50%)` patterns with 1px size (web2ui).

### 2.2 Geometry

- **Elements.** Use `getBoundingClientRect()` only when there is no transform in the ancestor chain. In general, use **CDP `DOM.getBoxModel(backendNodeId)`**. It returns the border, padding and content quads after transforms. Then derive a 2D affine per node from the quad and the untransformed size (`offsetWidth/Height`, or `computedStyleMap` width plus padding plus border):

```ts
// q = [x0,y0, x1,y1, x2,y2, x3,y3] border quad (TL,TR,BR,BL) in page space; w,h untransformed border-box
function affineFromQuad(q: number[], w: number, h: number) {
  const a = (q[2]-q[0])/w, b = (q[3]-q[1])/w;   // x-axis
  const c = (q[6]-q[0])/h, d = (q[7]-q[1])/h;   // y-axis
  return [[a, c, q[0]], [b, d, q[1]]];          // page-space matrix
}
// Figma relativeTransform = inverse(parentPageMatrix) · nodePageMatrix
```

  This handles transform-origin, nested transforms and scroll automatically. figit's `getTransformOverride` only handles leaf nodes with a center origin, because it measures descendants in screen space. Store a `localRect` in the parent's untransformed space. Non-affine content (`perspective`, `rotateX`, `matrix3d` with `is2D=false`) → rasterize the subtree.
- **Inline boxes.** `el.getClientRects()` returns one rect per line fragment. Use it for inline elements with backgrounds or borders, such as chips, `<mark>` and links with underlines.
- **Text.** Use `Range.selectNodeContents(textNode).getClientRects()` for line boxes, and per-character `Range` rects to find line breaks and collapsed whitespace (zero-size rect, as in figit `splitMidLineWrappedText`). Note that Range rects give the **content area** (ascent+descent), not the line box. Store both, and compute the line box from line-height (§3).

### 2.3 Pseudo-elements

Read styles with `getComputedStyle(el,'::before' | '::after' | '::marker' | '::placeholder')`. A pseudo-element is present iff `content` is not `none`/`normal` and `display` is not `none`.

- **Boxes, preferred approach (non-mutating).** CDP DOM nodes expose `pseudoElements[]` (`pseudoType: before | after | marker`). Call `DOM.getBoxModel` / `DOM.getContentQuads` on those nodeIds, and `CSS.getComputedStyleForNode` on them. Generated text: resolve `content` yourself (`attr()`, `counter()`, quotes; see html2canvas `document-cloner.ts`).
- **Fallback: materialize** (html2canvas, sergcen). Insert a `<fx-pseudo>` element with the computed styles inline, and hide the original via an injected `.fx-hide::before{content:none!important}`. Measure it and remove it. Caveats:
  - Inserting a child changes `:first-child`, `:nth-child` and `:empty` matching. Do it in a cloned document, or verify that the parent rect did not change.
  - Its text gets a real Range, which helps multi-line pseudo content.
- **`::marker`.** Use the CDP marker node, or synthesize from `list-style-type` (satori `list-marker.ts` and `counter-styles.ts` have counter formatting). Emit it as a separate TEXT node in a horizontal stack with the `li` content.
- **`::placeholder`.** When `value===''` and a placeholder exists, emit the placeholder text with the `::placeholder` color. sergcen hardcodes the color, which is wrong.

### 2.4 Replaced content, form controls, media

- **`<img>`.** Use `currentSrc`, which is the resolved `srcset`/`picture` candidate (BuilderIO). Fetch through Playwright `page.request` or CDP `Network.getResponseBody` to avoid CORS. Map `object-fit`/`object-position`:
  - `cover` → FILL
  - `contain` → FIT
  - `none`/`scale-down`/positioned → CROP with `imageTransform` computed from natural size versus box
  - Images with non-zero radius keep the frame radius.
- **`background-image: url()`.** Map `background-size/position/repeat`:
  - `cover` → FILL, `contain` → FIT
  - explicit size or position → CROP with `imageTransform`
  - `repeat` → TILE with `scalingFactor = tileW/naturalW`
  - Multiple layers → multiple fills, **reversed** (CSS lists the first layer on top; Figma puts the last fill on top). `background-color` is always the bottom-most fill.
- **`<canvas>`.** Use `toDataURL()` if not tainted; otherwise use a CDP `Page.captureScreenshot({clip})` of its rect.
- **`<video>`.** Draw the current frame to a canvas, or use `poster`.
- **Form controls.**
  - With `appearance:none` (most design systems), they are ordinary boxes; walk them normally.
  - With native appearance there are two modes: (a) **synthesize**: input/textarea → frame + text (value or placeholder, padding-aware); checkbox/radio → frame + check vector using `accent-color`; select → frame + selected option text + chevron vector; range → track + filled track + thumb positioned by `(value-min)/(max-min)`; progress/meter likewise. (b) **Raster**: a clip screenshot as an image fill. Default to (a) and record `nativeAppearance:true` in the IR.
- **Inline SVG.** Serialize a *clone* with computed presentation styles inlined: `fill`, `stroke`, `stroke-width`, `opacity`, `font-*`, `stroke-dasharray/linecap/linejoin`, `transform`, `visibility`, `display`.
  - Replace `currentColor` with the resolved `color` of each element.
  - Resolve `var()` in attributes.
  - Inline `<use href="#id">` targets. Search the document **and every shadow root** (modern-screenshot `embed-svg-use.ts`). Fetch external sprites (`sprite.svg#id`).
  - Copy referenced `<defs>` (gradients, clipPaths, masks, filters).
  - Set explicit `width`/`height`/`viewBox`.
  - Then `figma.createNodeFromSvg`. It handles paths and gradients but not filters or masks well; rasterize SVGs containing `<filter>`/`<foreignObject>`.

### 2.5 Clipping, masks, effects, stacking

- **overflow.** Any value other than `visible` (`hidden|clip|auto|scroll`) → `clipsContent:true`, which respects corner radius. Scroll containers: offset children by `-scrollTop/-scrollLeft`. Figma clips both axes, so `overflow-x:hidden; overflow-y:visible` cannot be represented: record it and choose clip.
- **clip-path.**
  - `inset(... round r)` → a wrapper frame with radius and `clipsContent`.
  - `circle/ellipse/polygon/path()` → a vector with `isMask:true` as the first sibling inside a group or frame wrapping the element.
- **mask-image.**
  - Single SVG/PNG URL over a solid background (the icon pattern) → tinted image or SVG vector (web2ui).
  - Gradient masks → mask layer with `maskType:'ALPHA'` and a gradient fill.
  - Otherwise rasterize.
- **filter.**
  - `blur(σ)` → `LAYER_BLUR` with radius = 2σ. figit `blur.ts` measured this: Chrome 14px falloff versus 7px when passed 1:1.
  - `drop-shadow()` → DROP_SHADOW. It is alpha-based like Figma's, so it is a better semantic match than box-shadow.
  - grayscale, brightness, contrast and hue-rotate have no node-level equivalent. On image fills only, approximate them with `ImagePaint.filters`; otherwise rasterize.
- **backdrop-filter: blur(σ)** → `BACKGROUND_BLUR` (use the same ×2, and verify).
- **mix-blend-mode** → node `blendMode` (multiply, screen and so on are 1:1).
- **isolation.** Figma groups isolate by default; pass-through is `PASS_THROUGH`.
- **position: fixed.** Absolute inside the root frame. **position: sticky.** Capture at the current scroll as static.
- **Paint order.** Implement CSS 2.1 Appendix E per stacking context:
  1. negative z
  2. in-flow blocks
  3. floats
  4. inlines
  5. positioned `auto`/0 in tree order
  6. positive z

  Stacking contexts are created by: positioned elements with z-index ≠ auto; opacity < 1; transform; filter; `isolation:isolate`; `mix-blend-mode`; `will-change`; `contain:paint`; fixed/sticky; and flex/grid items with z-index. figit's `sortNodesByStackingOrder` (`dom.ts` L216) is a single-level approximation.
- **Paint-order conflicts.** When a descendant paints above a sibling of its ancestor (a z-index escape), Figma's tree cannot express it. Hoist that node into the stacking-context root frame as `layoutPositioning:'ABSOLUTE'` and report it.
- **Z-order versus flow order.** Figma's auto layout flow order equals child order, so a z-reorder among flow children forces either `itemReverseZIndex` (full reversal only) or absolute fallback (figit bails here). Absolute children can sit anywhere in the child list.
- **`order` property.** CSS paints in *order-modified document order*, so sorting flow children by `order` (stable) is consistent for both layout and paint. Do that instead of bailing.

---

## 3. Text

### 3.1 Text run extraction (one TEXT node per inline formatting context)

Merge a block's inline content into one TEXT node with styled ranges if the following holds:

- Every inline descendant is "decoration-free": no background, border, padding, `inline-block`/`inline-flex`, or image.
- Or its decorations are overlay-able: inline `<code>` or `<mark>` backgrounds become absolute rectangles behind the text, one per `getClientRects()` fragment.

```ts
type Run = { start:number; end:number; style:TextStyleRef; href?:string };
function extractRuns(block: Element) {
  let text = ''; const runs: Run[] = []; let pendingSpace = false;
  for (const tn of composedTextNodes(block)) {            // DOM order, skipping display:none subtrees
    const cs = getComputedStyle(tn.parentElement!);
    const ws = cs.whiteSpaceCollapse ?? cs.whiteSpace;      // 'collapse' | 'preserve' | 'preserve-breaks' ...
    const raw = tn.data;
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 1);
      const rect = r.getBoundingClientRect();
      const ch = raw[i];
      if (/\s/.test(ch) && ws.startsWith('collapse')) {      // browser decides collapsing; trust the rects
        if (rect.width > 0.01) pendingSpace = true;          // rendered (non-collapsed) space
        continue;
      }
      if (ch === '\n' && ws !== 'collapse') { out += '\n'; continue; }
      if (pendingSpace && (text.length + out.length) > 0) out += ' ';
      pendingSpace = false; out += ch;
    }
    if (!out) continue;
    const start = text.length; text += out;
    runs.push({ start, end: text.length, style: styleKey(cs), href: closestHref(tn) });
  }
  return { text, runs: mergeAdjacent(runs) };
}
```

Notes:

- Per-character Ranges cost O(n), which is acceptable for components. Batch by word for large text.
- **text-transform.** Keep the source characters and set `textCase`: `uppercase`→UPPER, `lowercase`→LOWER, `capitalize`→TITLE, `font-variant-caps: small-caps`→SMALL_CAPS. This keeps the text editable. CSS `capitalize` and Figma TITLE differ slightly. If exactness matters, bake the transform (web2ui `transformCapturedText`) and flag it.
- Use ` ` (LINE SEPARATOR) for `<br>` inside a paragraph, and `\n` for paragraph breaks (`paragraphSpacing` from margins between `<p>`s, when merging multiple blocks).
- **Per-range style fields:**
  - `fontName` (actual font, §3.3), `fontSize`
  - `letterSpacing` as PIXELS (computed `normal` → 0)
  - `lineHeight` as PIXELS (always explicit, §3.2)
  - fills: `color`, or the gradient of the nearest ancestor with `background-clip:text` sized to *that ancestor's box* (figit `inheritedProperties.textGradient`)
  - `textDecoration` (`text-decoration-line` **propagates from ancestors**; figit walks parents) plus `textDecorationStyle` (solid/wavy/dotted), `textDecorationColor`, thickness and offset
  - `setRangeHyperlink` for `<a href>`
  - `openTypeFeatures` from `font-feature-settings`/`font-variant-numeric`
  - `variationSettings` from `font-variation-settings` and `font-optical-sizing`
- **Mid-line wrapped text that continues a sibling's line** (an inline text node after an inline-block) can't be a single rectangle. Split it into per-line TEXT nodes (figit `splitMidLineWrappedText`), or keep the whole inline context as one node.

### 3.2 Line height and vertical metrics

- **`line-height: normal` resolves to the font's metrics.** It is `(hheaAscender − hheaDescender + hheaLineGap)/upm × size`, or the OS/2 typo metrics when `USE_TYPO_METRICS` is set; Chromium on Windows uses `winAscent/winDescent` (satori `font.ts` around L905). Never emit Figma "Auto". Instead:
  - Measure the line pitch from consecutive line rect tops when there are ≥2 lines.
  - For single-line text, use a probe: clone the styles into `<div style="line-height:normal">x</div>` and read `offsetHeight`.
  - figit's `fontSize*1.2` guess is wrong for Inter (≈1.21), Roboto (≈1.17) and many display fonts.
- **Baselines.** Figma places glyphs using its own ascent and descent within the line box. Chromium centers the content area in the line box (half-leading). The two match only if the font metrics agree, so verify the baseline position after building (§3.5).
- **`text-box-trim`/`text-box-edge: cap alphabetic`** → `leadingTrim:'CAP_HEIGHT'`.

### 3.3 Fonts: resolve the face that was actually used

Computed `font-family` is a *list*. Use CDP for each text-bearing element:

```ts
const cdp = await page.context().newCDPSession(page);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
// map capture ids → nodeIds via DOM.pushNodesByBackendIdsToFrontend or DOM.querySelector on a data-fx-id
const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
// fonts: [{ familyName, postScriptName, isCustomFont, glyphCount }]  — sorted desc by glyphCount
```

The CDP method covers the element's *child text nodes*, so query the text node's parent. Multiple entries mean fallback happened. Record every face plus its glyph count, and use the dominant one for the run; if mixed, split runs by script (Unicode script ranges).

`isCustomFont` = web font. Collect `document.fonts` entries (`family`, `weight`, `style`, `status`, the `src` URL taken from the stylesheets) so the plugin can report precisely: "`Acme Sans 600` is a web font loaded from …/acme-600.woff2 and is not available in Figma."

**Synthetic styles.** If computed `font-weight` is 700 but `postScriptName` ends in `-Regular`, the browser synthesized bold (`font-synthesis`). Report it, and in Figma pick the real Bold if it exists.

**Mapping to a Figma FontName:**

1. `figma.listAvailableFontsAsync()` → index by normalized family (`toLowerCase().replace(/[^a-z0-9]/g,'')`; BuilderIO and sergcen `getFont.ts` do this, but family only).
2. Pick the style by weight and italic with the CSS font-matching fallback order. The target is CSS weight `w`:
   - `w` in 400–500: try `w`, then 500, then descending, then ascending.
   - `w` < 400: descending first.
   - `w` > 500: ascending first.
3. Style name normalization table, compared without spaces or case:

```
100 Thin|Hairline   200 ExtraLight|UltraLight   300 Light   400 Regular|Normal|Book|Roman
500 Medium   600 SemiBold|DemiBold   700 Bold   800 ExtraBold|UltraBold   900 Black|Heavy
italic → "<Weight> Italic" | "Italic" (for 400) | "Oblique"
```

   Prefer deriving the style from `postScriptName` (`Inter-SemiBoldItalic` → "Semi Bold Italic") when the family matches.
4. **Variable fonts.** Use `FontNameInput { family, variationSettings: { wght: 550, opsz: 14 } }` without a style. Figma resolves the nearest named instance (`plugin-api.d.ts` around L4060). Use `figma.getFontFamilyVariationAxes` to drop unsupported axes.
5. **Missing font.** Fall back by metric similarity (same generic class and closest x-height/width, for example to Inter). Record a `fontSubstitution` warning, and set `fontMissing` in the IR so the plugin can show a report and the designer can re-map.
6. **Icon fonts.** Detect them by any of:
   - The family is a known icon font (Material Symbols, Font Awesome, …).
   - Codepoints are in the PUA (U+E000–F8FF).
   - Ligature icons: the rendered width ≠ the width of the same string in the fallback font (web2ui's canvas pixel-diff approach).

   Convert them to vectors: fetch the font file and extract glyph outlines with opentype.js/fontkit (honoring ligatures through GSUB, or use harfbuzzjs for shaping) → SVG path → `createNodeFromSvg`. Fill = `color`. Fallback: a clip screenshot.

### 3.4 Sizing, wrapping, truncation

- **Single-line versus multi-line.** Count distinct line tops of the text's client rects with ±1px tolerance (figit `isTextOnSingleLine`).
- **Single line + nowrap or hugging** → `textAutoResize:'WIDTH_AND_HEIGHT'`. This guarantees no spurious wrap.
- **Multi-line** → `'HEIGHT'` with a fixed width, or `layoutSizingHorizontal:'FILL'` when the block stretches.
- **Width buffer.** Figma remeasures glyph advances slightly differently (hinting, kerning or shaping differences). figit adds 0–5px slack by weight and size *only for line breaking*. In the Plugin API you cannot separate "wrap width" from "box width". So build the node, read back the line count, and if Figma wraps more than the browser did, widen by up to `maxBuffer` (or `minWidth`).
- **Two modes, chosen per project:**
  - **reflow** (editable): trust Figma's wrap, and accept ≤1 word of drift.
  - **locked lines**: insert ` ` at the browser's break points, which guarantees identical lines.
- **`text-overflow: ellipsis` + `nowrap` + `overflow:hidden`** → `textTruncation:'ENDING'`, `maxLines: 1`, fixed width. Capture the **full** text; the browser shows the ellipsis itself.
- **`-webkit-line-clamp: N`** → `textTruncation:'ENDING'`, `maxLines:N`.
- **`text-align`**: left, right, center and justify map to `textAlignHorizontal`. `start`/`end` must be resolved through `direction`. The text box's own alignment comes from geometry, not from `text-align` on the parent.
- **`text-indent`** → `paragraphIndent`. **`hanging-punctuation`** → `hangingPunctuation`.

### 3.5 Plugin-side verification for text

After building, read `node.height` and compute the line count as `height/lineHeightPx`. Compare it with the IR's `lineCount`. On mismatch, apply the policies above and log the delta to the report.

---

## 4. Layout inference

### 4.1 Recover CSS intent

Two sources, used together:

1. **`computedStyleMap()`** (Typed OM). It keeps keywords: `width` returns `CSSKeywordValue('auto')` rather than px, and `100%` returns a percent `CSSUnitValue`. figit `hasContentSizedKeyword` relies on this and uses the element's own realm for `instanceof`.
2. **CDP `CSS.getMatchedStylesForNode`** gives authored declarations including `fr`, `minmax()`, `calc()` and media-query branches. Use it for grid track intent and for `flex` shorthands (`flex: 1` versus `flex: 1 1 auto`).

### 4.2 Container classification

```
display flex|inline-flex           → HORIZONTAL|VERTICAL stack  (verify)
display grid|inline-grid           → GRID (Figma grid) → else wrap stack (uniform grids) → else nested stacks → else absolute
display block|flow-root|list-item  with only block-level, non-float in-flow children → VERTICAL stack (verify)
inline formatting context          → single TEXT (+ overlays)  | HORIZONTAL stack if exactly one line of atomic inlines
table                              → VERTICAL stack of HORIZONTAL rows with FIXED column widths (verify), else absolute
anything else / verification fails → frame, layoutMode NONE, children absolutely placed (always pixel-correct)
```

- **Anonymous flex items.** Direct non-empty text inside a flex container, as in `<button><svg/> Save</button>`, is an anonymous flex item. Emit a synthetic text child measured with a Range instead of bailing, as figit does.
- **Absolutely positioned and fixed children** → `layoutPositioning:'ABSOLUTE'` with constraints derived from which insets are non-auto (`left`+`right` → LEFT_RIGHT, `right` only → RIGHT, centered by transform → CENTER).

### 4.3 Flex → auto layout mapping table

| CSS | Figma | Condition / note |
|---|---|---|
| `flex-direction: row / column` | `layoutMode: HORIZONTAL / VERTICAL` | |
| `row-reverse`/`column-reverse` | children emitted reversed + `itemReverseZIndex:true`; justify MIN↔MAX swapped | CSS paints in DOM order (figit) |
| `flex-wrap: wrap` | `layoutWrap:'WRAP'`, `counterAxisSpacing = row-gap` | Only `row` + `wrap`. Simulate Figma's greedy packing and require exact row assignment (figit `inferWrapStack`). `wrap-reverse` and column wrap → fallback. |
| `gap` / margins | `itemSpacing` = measured uniform inter-child gap | Measured from rects, so collapsed margins are included. Negative values are allowed. |
| `justify-content: flex-start/start/normal` | `primaryAxisAlignItems: MIN` | |
| `center` / `flex-end` | `CENTER` / `MAX` | |
| `space-between` | `SPACE_BETWEEN` | |
| `space-around` / `space-evenly` | `CENTER` + measured spacing | figit found Figma renders SPACE_EVENLY as space-between. The equivalence is valid only for fixed sizes, so mark it non-responsive. |
| `align-items: flex-start / center / flex-end` | `counterAxisAlignItems: MIN / CENTER / MAX` | |
| `align-items: baseline` | `BASELINE` (horizontal only) | Verify; Figma's baseline is from its own metrics |
| `align-items: stretch/normal` | `MIN` + child `layoutAlign:'STRETCH'` (`layoutSizingVertical/Horizontal:'FILL'`) for children with `auto` cross size whose measured cross size equals the inner cross size | |
| per-child `align-self` ≠ container | Figma has no per-child MIN/CENTER/MAX (only STRETCH/INHERIT) | Wrap the child in a FILL-cross transparent frame with its own alignment, or fall back |
| `flex-grow > 0` | `layoutGrow:1` / sizing FILL | Only if all growers' measured sizes equal `(inner − fixed − gaps)/nGrowers` (Figma FILL is `flex:1 0 0`: equal shares, no basis). Otherwise FIXED at the measured size: same pixels, different resize behavior. Unequal grow ratios → FIXED. |
| `flex-shrink`, `flex-basis` | — | Baked into the measured size. Probing (§4.6) tells whether the item responds to width changes. |
| `min-width/max-width/min-height/max-height` (px) | `minWidth/maxWidth/minHeight/maxHeight` | Percent values → resolve to px and flag |
| `order` | reorder children (stable sort) | Consistent for paint as well |
| `padding + border` | `paddingX = padding + border` with INSIDE stroke and `strokesIncludedInLayout:false` (figit) | Or `padding` with `strokesIncludedInLayout:true`. The first is provably exact; the second is more "native" for editing. Choose per config and verify. |
| `margin: auto` (main axis) | split into two sub-stacks with `SPACE_BETWEEN`, or SPACE_BETWEEN if there are 2 children | |
| `margin: 0 auto` (block child) | counter CENTER (figit tries MIN/CENTER/MAX until verified) | Only when all children agree; otherwise use a wrapper |
| `box-sizing` | irrelevant | Always use measured border-box sizes |

**Margins (Figma has none), in order of preference:**

1. **Gap normalization.** All inter-child distances are equal → `itemSpacing`.
2. **Padding absorption.** The first child's leading margin and the last child's trailing margin fold into the container's padding (figit block path: `padTop = first.y`).
3. **Margin wrapper.** Wrap the odd child in a transparent HUG frame whose padding equals its excess margin, named `⟨name⟩ / margin`.
4. **Sub-stack split** at the irregular gap.
5. **Absolute fallback.**

Spacer frames work but are disliked by designers; offer them as an option only.

### 4.4 Sizing (HUG / FILL / FIXED)

Per node and axis:

```
FILL  if  parent is a stack and:
          main axis: flex-grow>0 and measured == Figma fill share (above)
          cross axis: resolved align-self stretch AND cross size keyword auto AND measured == inner cross
          block child in vertical stack: width keyword auto AND measured == parent inner width
          width:100% → FILL as well (same geometry), and record intent "percent"
HUG   if  size keyword ∈ {auto, fit-content, max-content, min-content} in a shrink-to-fit context
          (inline-flex, inline-block, float, abs-pos, flex main axis, height in normal flow)
          AND measured == Σchildren + gaps + padding  (and not SPACE_BETWEEN or grower: figit applySizingModes)
FIXED otherwise (explicit px, or verification failed)
```

Always set sizing modes explicitly. figit found that pasted stacks without them hug on the primary axis and shrink.

### 4.5 Grid

Figma now has native grids: `layoutMode:'GRID'`, `gridRowCount`/`gridColumnCount`, `gridRowGap`/`gridColumnGap`, `gridRowSizes[i]={type:'FIXED'|'FLEX'|'HUG', value}`, and per child `setGridChildPosition(r,c)`, `gridRowSpan`/`gridColumnSpan` and `gridChildHorizontalAlign`/`VerticalAlign`.

Mapping:

- **Tracks.** The computed `grid-template-columns` returns *resolved px per track*, which gives the count and sizes. Authored intent comes from matched styles:
  - `fr` → FLEX with value
  - px → FIXED
  - `auto`, `min-content`, `max-content`, `fit-content()` → HUG
  - `minmax(a, 1fr)` → FLEX + child `minWidth`
- **`repeat(auto-fill|auto-fit, …)`** resolves to a count fixed at the capture width. Flag it as non-responsive; probing can show that the count changes.
- **Child placement.** Compute from rects by snapping each child's left/top edges to track start lines (cumulative sizes plus gaps). Span = number of tracks covered. Computed `grid-row-start` is often `auto` under auto-placement.
- **`justify-items`/`align-items`/`justify-self`/`align-self`** → `gridChild*Align`; `stretch` → FILL sizing.
- **Not representable** (fall back to nested stacks or absolute): named areas with holes, `grid-auto-flow: dense`, overlapping items, subgrid, and `masonry`.
- **Verify cell positions** within tolerance. If the GRID API is unavailable, use figit's uniform-grid-as-wrap simulation.

### 4.6 Verification (capture-side simulation and plugin-side read-back)

Capture side: re-implement Figma's stack algorithm for the chosen spec and compare it with the measured child rects. This is figit `verifyGeometry`, tolerance 0.6px:

```ts
function verify(spec, parent, rects) {                 // rects relative to the parent border box
  const row = spec.mode === 'HORIZONTAL', P = (r) => row ? r.width : r.height, C = (r) => row ? r.height : r.width;
  const inner = (row ? parent.w : parent.h) - spec.padLead - spec.padTrail;
  const innerX = (row ? parent.h : parent.w) - spec.padCrossLead - spec.padCrossTrail;
  const total = rects.reduce((s, r) => s + P(r), 0), n = rects.length;
  let gap = spec.itemSpacing, cur = spec.padLead;
  if (spec.primary === 'CENTER') cur += (inner - total - gap*(n-1))/2;
  if (spec.primary === 'MAX')    cur += inner - total - gap*(n-1);
  if (spec.primary === 'SPACE_BETWEEN') gap = n > 1 ? (inner - total)/(n-1) : 0;
  return rects.every(r => {
    const cross = spec.padCrossLead + (spec.counter === 'CENTER' ? (innerX - C(r))/2 : spec.counter === 'MAX' ? innerX - C(r) : 0);
    const ok = Math.abs((row ? r.x : r.y) - cur) <= TOL && Math.abs((row ? r.y : r.x) - cross) <= TOL;
    cur += P(r) + gap; return ok;
  });
}
```

**Plugin side (authoritative).** After building each auto layout subtree, compare each child's `absoluteBoundingBox` against `ir.rect` (Figma lays out synchronously). If max Δ > tolerance:

1. First try relaxations: HUG→FIXED, FILL→FIXED, and text width buffer.
2. Then set `layoutMode:'NONE'` and restore absolute `x/y`.

Log each decision in the report.

### 4.7 Layout probing (responsiveness)

Re-measure the story at several container widths. Resize `#storybook-root`'s wrapper or the viewport; for example capture at W×{0.75, 1, 1.25} plus a narrow width (320). Match nodes by a stable `data-fx-id` assigned on the first pass. If the framework re-mounts on resize, fall back to a composed-tree path plus tag/class signature.

For each node axis, let `k = Δchild / ΔparentInner`:

- `k≈1` (or equal share among siblings) → FILL.
- `k≈0`, with size equal to content size → HUG; with size not equal to content → FIXED.
- A clamp at extremes → FILL plus `min/maxWidth` (taking the observed plateau values).
- Text that reflows → HEIGHT auto-resize with FILL.
- A changing wrap or grid track count → wrap or auto-fill confirmed.

Probing also catches `flex-basis` or `flex-shrink` behavior that a single snapshot cannot. Use a narrower probe only if the story has no media queries (check CDP matched styles for `@media`/`@container`); otherwise breakpoints change the structure. Record each breakpoint as a separate variant.

---

## 5. Visuals

### 5.1 Colors

Chromium returns modern computed colors in their own space (`oklch(…)`, `color(display-p3 …)`, and `color-mix()` results as `oklab`/`color(srgb …)`).

- Convert with colorjs.io *with gamut mapping* (`toGamut({space:'srgb', method:'css'})`). figit reads `.srgb` raw, which can go out of range. The 1×1 canvas readback (web2ui) is a fallback, but it clips.
- If `figma.root.documentColorProfile` is DISPLAY_P3, emit P3 values instead (the Plugin API supports P3 paints).
- Alpha → `paint.opacity` with the color's `a` = 1. Element `opacity` → node `opacity`.
- **Gradient stops with `transparent`.** CSS interpolates in premultiplied space. Replace transparent with the neighbor's RGB at alpha 0 to avoid grey fringes.
- **`in oklch` interpolation.** Pre-sample 8–16 intermediate stops.

### 5.2 Gradients → `gradientTransform`

Build every paint matrix in **pixel space** and convert it to Figma's normalized node space with `M_norm = M_px · diag(w, h)`. Figma reads the gradient position as `t = m00·x + m01·y + m02` with x, y in 0..1; verify that the identity matrix gives a left→right ramp.

```ts
type M = [[number,number,number],[number,number,number]];
// LINEAR: CSS angle θ (0deg = to top, clockwise). Line length L = |w sinθ| + |h cosθ|.
function linear(thetaDeg: number, w: number, h: number): M {
  const t = thetaDeg * Math.PI / 180, dx = Math.sin(t), dy = -Math.cos(t);
  const L = Math.abs(w*dx) + Math.abs(h*dy) || 1;
  const m00 = w*dx/L, m01 = h*dy/L;                       // t(x,y) = ((p−center)·dir)/L + .5
  return [[m00, m01, 0.5 - 0.5*(m00+m01)], [-m01, m00, 0.5 - 0.5*(m00-m01)]];  // 2nd row: keep invertible
}
// stop px offset s → s / L ; % stays as fraction. 'to top right' etc.: θ = atan2(w, h) variants (corner-to-corner perpendicular rule).
// RADIAL ellipse radii (rx, ry) at center (cx, cy) px. Figma unit circle r=.5 at (.5,.5):
function radial(cx: number, cy: number, rx: number, ry: number, w: number, h: number): M {
  return [[w/(2*rx), 0, 0.5 - cx/(2*rx)], [0, h/(2*ry), 0.5 - cy/(2*ry)]];
}
// farthest-corner ellipse: rx = √2·max(cx, w−cx), ry = √2·max(cy, h−cy); circle: r = dist to farthest corner.
// Default (center, farthest-corner) gives m00 = 1/√2, matching figit calculateRadialTransform. Stop px → s / rx.
// CONIC from φ at (cx, cy): Figma angular origin is 3 o'clock; CSS is 12 o'clock → rotate by ψ = 90° − φ.
function conic(phiDeg: number, cx: number, cy: number, w: number, h: number): M {
  const p = (90 - phiDeg) * Math.PI/180, c = Math.cos(p), s = Math.sin(p), k = 1/Math.max(w, h);
  // g = .5 + k·Rot(ψ)·(P − C), with P = (x·w, y·h)
  return [[k*c*w, -k*s*h, 0.5 - k*(c*cx - s*cy)], [k*s*w, k*c*h, 0.5 - k*(s*cx + c*cy)]];
}
// For φ=0 at center and w=h=1 this reduces (up to scale) to figit's {0,-1,1; 1,0,0}.
```

- **Repeating gradients.** Tile one period of stops across 0..1, capped at about 256 stops (figit `tileRepeatingStops`).
- **Hard stops.** Nudge coincident stops by 1e-5, because Figma reorders equal offsets (figit `separateCoincidentStops`).
- **Multiple backgrounds.** Reverse into the fills array.
- **`background-clip: text`.** Apply the gradient fill to the text ranges, sized to the clipping element's box.
- **`background-clip: padding-box/content-box`** → an inner absolute rectangle carrying the fill.

### 5.3 Borders, outline, radius

- **Uniform border** → `strokes` with `strokeAlign:'INSIDE'`. Use the individual weights `strokeTop/Right/Bottom/LeftWeight` for per-side widths with the same color and style.
- **Per-side colors or styles.** A Figma node has one stroke paint, so:
  - (a) Without radius: per-side absolute vectors forming mitered trapezoids (figit `border-decomposition.ts`).
  - (b) With radius: a rounded path decomposition (figit `rounded-dash-border.ts`).
  - (c) Cheap: use the dominant color and log it.
- **dashed** → `dashPattern:[2w, w]` (Chrome draws dashes at 2× width, then adjusts per side). **dotted** → `[0, 2w]` with `strokeCap:'ROUND'`. Figma phases the dash continuously around the box, so corners drift; decompose when exactness matters.
- **double, groove, ridge, inset, outset** → decomposition (figit `border-3d.ts`) or the solid approximation.
- **outline** → an OUTSIDE stroke if there is no border. Otherwise use an absolute sibling frame inflated by `outline-offset + outline-width`, with radius + offset.
- **border-radius.** Use the px per corner (`topLeftRadius` etc.). Computed values are *not* clamped. Apply the CSS overlap reduction `f = min(1, w/(tl+tr), w/(bl+br), h/(tl+bl), h/(tr+br))` and multiply every radius by f. Percent → resolve against w/h. Elliptical radii (`a / b`) are unsupported → use a vector path, or `min(a,b)` with a warning. Use `cornerSmoothing: 0`.

### 5.4 Shadows and effects

- **box-shadow** (comma-split at paren depth 0):
  - outer → DROP_SHADOW `{offset, radius: blur (1:1 with CSS), spread, color}`
  - `inset` → INNER_SHADOW
  - Order: CSS lists the first shadow on top. Reverse into Figma and verify.
- **Spread** is only honored on rect/ellipse, or on frames with a visible fill + `clipsContent` (typings L4369). For frames without a fill, move the shadow onto an absolute backing RECTANGLE (the first child, same radius, the element's background) or set `clipsContent` when it is safe.
- **Ring shadows** (`0 0 0 Npx`, Tailwind `ring-*`) render as nothing on fill-less frames. Promote the widest to an OUTSIDE stroke when there is no border (figit).
- **`showShadowBehindNode:false`.** Emulates CSS clipping the shadow under translucent boxes; verify per case.
- **text-shadow** → DROP_SHADOW on the TEXT node (spread 0).
- **filter** and **backdrop-filter**: see §2.5.

---

## 6. Tree simplification and naming

**Node type choice:**

- Element with children or auto layout → FRAME.
- Leaf with only fill, stroke and radius → RECTANGLE (or FRAME if it may need children or clipping later; FRAME is safer for spread shadows).
- Images → RECTANGLE or FRAME with an image fill.
- Pure grouping without visuals or layout (a transparent absolute wrapper) → GROUP. Avoid GROUP inside auto layout.
- SVG → the result of `createNodeFromSvg` (unwrap the single-child frame it creates).

**Collapse rules** (bottom-up, after layout inference):

1. A wrapper with no visuals, no clipping, no effects, no layout of its own, and a single child whose rect equals the wrapper's → replace it with the child, and transfer `layoutSizing` and naming.
2. Nested stacks in the same direction where the inner one is FILL, has zero padding and no visuals → merge, if spacing is compatible.
3. A text-only element (block with a single text run, no visuals) → the TEXT node itself takes the element's place and name. figit `isPlainTextElement` classifies this.
4. Adjacent text siblings with identical style in the same line context → merge.
5. Drop zero-size nodes unless they carry a visible stroke or effect.

**Naming** (first hit wins). Store the raw candidates in the IR and let the builder choose:

1. Explicit `data-figma-name` or `data-testid`.
2. Component display name from the React fiber. Find the key `__reactFiber$*` on the element, walk `.return` to the nearest function or class component, and use `type.displayName || type.name`. Use Vue's `__vueParentComponent.type.name`, the Svelte/Angular `ng-reflect` equivalents, or the custom element tag name.
3. Storybook context: the story title plus the component name for the root.
4. ARIA: `role`/`aria-label` (`Button / "Save"`).
5. Semantic tag map (figit `naming.ts`: nav→Navigation, …).
6. BEM or class heuristics: the first non-utility class (skip Tailwind, CSS-module hashes, emotion `css-xxxx`).
7. Text content for text nodes (truncated to 40 characters).

Component *boundaries* from fiber can also drive later `createComponent` grouping.

---

## 7. Known pitfalls and how existing tools fare

| Pitfall | Failure seen | Remedy |
|---|---|---|
| Flat absolute output | BuilderIO, sergcen: no auto layout | §4 with verification |
| `auto` size unknown from `getComputedStyle` | Everyone except figit | Typed OM, matched styles, probing |
| Fill is not CSS flex-grow | Naive mappers make everything FILL | Equal-share check, else FIXED |
| Text reflow wraps differently | BuilderIO shrinks fontSize (`plugin/code.ts` around L595) | Width buffer, read-back, locked-lines mode |
| `line-height: normal` = 1.2 guess | figit | Measure the pitch or probe |
| Font family list, not the used face | All except web2ui (document.fonts) | `CSS.getPlatformFontsForNode` |
| Weight ignored (Regular only) | BuilderIO, sergcen | Weight→style table, `variationSettings` |
| Pseudo-elements missed or mis-measured | BuilderIO misses them; the sergcen clone changes `:nth-child` | CDP pseudo box model |
| Shadow DOM missing | Figma Code to Canvas (reported), BuilderIO (open only, flattens slots incorrectly) | Composed walk + attachShadow hook |
| Transforms flattened to an AABB | BuilderIO; figit (non-leaf) | Quad-derived matrices |
| Per-side borders | BuilderIO: extra rects outside the box | Individual weights / decomposition |
| Only the first box-shadow | BuilderIO `getShadowEffects` | Full list parse |
| Spread or ring shadows invisible | Pasted kiwi (figit found this) | Stroke promotion / backing rect |
| `background-clip:text` → solid | Figma Code to Canvas | Gradient text fills |
| Blur half as soft | 1:1 mappers | ×2 |
| Gradient angle wrong on non-square boxes | Approximations that only agree vertically | Box-normalized matrix |
| `<use>` sprites in shadow roots | BuilderIO only queries `document` | Search all roots, fetch external sprites |
| `currentColor` in SVG | Raw outerHTML | Inline the resolved styles |
| CJK or emoji tofu | Code to Canvas | Per-script runs from platform fonts; map to Noto/Apple Color Emoji in Figma |
| Z-index escapes | Tree-ordered builders | Hoist + report |
| Viewport-only capture, lazy content | Code to Canvas | Element-scoped capture of the story root |
| Margin collapse | CSS-reading mappers | Measured gaps |

---

## 8. Intermediate representation (IR)

Requirements: JSON-serializable and framework-agnostic. It holds *both* raw measurements and inferred decisions, so the builder can override decisions and a re-inference can run offline. Assets are deduplicated by hash. It is versioned with semver plus feature flags.

```ts
interface FxDocument {
  irVersion: "1.0.0";                 // semver: major = breaking shape change
  generator: { name: string; version: string; chromium: string; playwright: string };
  capture: { url: string; storyId?: string; viewport: {w:number;h:number}; dpr: number;
             colorSpace: "srgb"|"display-p3"; timestamp: string; probes?: ProbeMeta[] };
  features: string[];                 // e.g. ["grid-layout","variable-fonts","locked-lines"]
  root: FxNode;
  styles: Record<string, FxTextStyle>; // deduped text styles referenced by runs
  assets: Record<string, FxAsset>;     // key = sha256
  fonts: FxFontUsage[];                // every face used + availability hints
  diagnostics: FxDiagnostic[];
}
type Mat2x3 = [[number,number,number],[number,number,number]];
interface FxNode {
  id: string;                          // stable across probes (data-fx-id)
  kind: "frame"|"text"|"image"|"vector"|"svg"|"raster"|"group";
  source: { tag: string; path: string; classes?: string[]; role?: string; ariaLabel?: string;
            component?: string; testId?: string; pseudo?: "before"|"after"|"marker"|"placeholder";
            shadowHost?: boolean; nativeControl?: string };
  name?: string;                       // builder may recompute from source
  // geometry: always present, in the parent's local (untransformed) space
  rect: { x:number; y:number; w:number; h:number };
  transform?: Mat2x3;                  // relative to parent; absent = translate(rect.x, rect.y)
  absRect: { x:number; y:number; w:number; h:number }; // page space AABB, for verification
  visible: boolean; opacity: number; blendMode?: string;
  clip?: { overflow: "visible"|"clip"; scroll?: {x:number;y:number};
           clipPath?: { type: "inset"|"path"; radius?: number[]; svgPath?: string } };
  mask?: { assetId?: string; type: "ALPHA"|"LUMINANCE"|"VECTOR" };
  fills: FxPaint[]; strokes?: FxStroke; radius?: [number,number,number,number] | { svgPath: string };
  effects: FxEffect[];
  // layout: raw CSS facts + inferred decision (+ verification result)
  css?: { display: string; position: string; boxSizing: string; zIndex: string|number;
          padding: [number,number,number,number]; border: [number,number,number,number];
          margin: [number,number,number,number]; gap?: {row:number;col:number};
          flex?: { direction:string; wrap:string; justify:string; alignItems:string; alignContent:string };
          item?: { grow:number; shrink:number; basis:string; alignSelf:string; order:number };
          grid?: { columns: string; rows: string; columnsPx: number[]; rowsPx: number[]; areas?: string };
          size: { width: string; height: string; minW?: string; maxW?: string; minH?: string; maxH?: string }; // Typed-OM / authored keywords
          insets?: { top:string; right:string; bottom:string; left:string } };
  layout?: FxLayout;                   // inferred; absent = absolute children
  child?: { positioning: "AUTO"|"ABSOLUTE"; sizingH: "FIXED"|"HUG"|"FILL"; sizingV: "FIXED"|"HUG"|"FILL";
            grow?: 0|1; stretch?: boolean; grid?: { row:number; col:number; rowSpan:number; colSpan:number;
            alignH?: "MIN"|"CENTER"|"MAX"|"AUTO"; alignV?: "MIN"|"CENTER"|"MAX"|"AUTO" };
            constraints?: { h: "MIN"|"MAX"|"CENTER"|"STRETCH"|"SCALE"; v: "MIN"|"MAX"|"CENTER"|"STRETCH"|"SCALE" };
            min?: {w?:number;h?:number}; max?: {w?:number;h?:number} };
  responsive?: { kW?: number; kH?: number; plateaus?: number[] }; // from probing
  text?: FxText; image?: { assetId: string; scaleMode: "FILL"|"FIT"|"CROP"|"TILE"; imageTransform?: Mat2x3; scalingFactor?: number };
  svg?: { assetId: string };           // serialized, styles inlined, <use> resolved
  children: FxNode[];                  // in final paint order (bottom → top)
}
interface FxLayout {
  mode: "HORIZONTAL"|"VERTICAL"|"GRID";
  padding: [number,number,number,number]; strokesIncludedInLayout: boolean;
  itemSpacing?: number; counterSpacing?: number; wrap?: boolean;
  primaryAlign?: "MIN"|"CENTER"|"MAX"|"SPACE_BETWEEN"; counterAlign?: "MIN"|"CENTER"|"MAX"|"BASELINE";
  alignContent?: "AUTO"|"SPACE_BETWEEN"; reverseZ?: boolean;
  sizingPrimary: "FIXED"|"AUTO"; sizingCounter: "FIXED"|"AUTO";
  grid?: { cols: {type:"FIXED"|"FLEX"|"HUG"; value?:number}[]; rows: {type:"FIXED"|"FLEX"|"HUG"; value?:number}[];
           colGap:number; rowGap:number };
  verified: { simulatedMaxDelta: number; tolerance: number };
  fallbackReason?: string;             // why a richer mode was rejected
}
interface FxText {
  characters: string;                  // source chars (pre text-transform) with   / \n
  runs: { start:number; end:number; styleId: string; href?: string; fills?: FxPaint[] }[];
  autoResize: "WIDTH_AND_HEIGHT"|"HEIGHT"|"NONE"; truncation?: { maxLines: number };
  alignH: "LEFT"|"CENTER"|"RIGHT"|"JUSTIFIED"; alignV: "TOP"|"CENTER"|"BOTTOM";
  lines: { top:number; baseline?:number; height:number; startChar:number; endChar:number; width:number }[]; // browser truth
  paragraphIndent?: number; paragraphSpacing?: number; leadingTrim?: "NONE"|"CAP_HEIGHT";
  decorationsOverlay?: FxNode[];       // inline backgrounds per fragment
}
interface FxTextStyle {
  cssFamily: string;                   // computed list
  used: { family: string; postScriptName: string; isCustom: boolean; synthetic?: ("bold"|"italic")[] };
  weight: number; italic: boolean; stretch: string; variation?: Record<string, number>; features?: Record<string, boolean>;
  size: number; lineHeightPx: number; letterSpacingPx: number;
  textCase: "ORIGINAL"|"UPPER"|"LOWER"|"TITLE"|"SMALL_CAPS";
  decoration?: { line: "UNDERLINE"|"STRIKETHROUGH"; style: "SOLID"|"WAVY"|"DOTTED"; color?: FxColor; thickness?: number; offset?: number };
  color?: FxColor;
}
interface FxFontUsage { family: string; postScriptName: string; weights: number[]; italic: boolean;
  isCustom: boolean; srcUrl?: string; glyphCount: number; iconFont?: boolean }
type FxColor = { r:number; g:number; b:number; a:number; space: "srgb"|"display-p3"; original?: string };
type FxPaint =
  | { type: "SOLID"; color: FxColor; opacity?: number }
  | { type: "GRADIENT_LINEAR"|"GRADIENT_RADIAL"|"GRADIENT_ANGULAR"; stops: {pos:number; color:FxColor}[]; transform: Mat2x3; css?: string }
  | { type: "IMAGE"; assetId: string; scaleMode: "FILL"|"FIT"|"CROP"|"TILE"; imageTransform?: Mat2x3; scalingFactor?: number };
interface FxStroke { paints: FxPaint[]; align: "INSIDE"|"OUTSIDE"|"CENTER"; weights: [number,number,number,number];
  dash?: number[]; cap?: "NONE"|"ROUND"; perSide?: { color: FxColor; style: string }[]; decomposed?: FxNode[] }
type FxEffect = { type: "DROP_SHADOW"|"INNER_SHADOW"; offset:{x:number;y:number}; radius:number; spread:number; color:FxColor; showBehind?: boolean }
              | { type: "LAYER_BLUR"|"BACKGROUND_BLUR"; radius:number };
interface FxAsset { mime: string; bytesB64?: string; url?: string; svgText?: string; natural?: {w:number;h:number} }
interface FxDiagnostic { nodeId?: string; code: string; severity: "info"|"warn"|"error"; message: string; data?: unknown }
// codes: FONT_MISSING, FONT_SYNTHETIC, LAYOUT_FALLBACK, ZINDEX_HOIST, UNSUPPORTED_FILTER, RASTERIZED, TEXT_LINE_MISMATCH, ...
```

**Versioning:**

- `irVersion` is semver. The builder rejects an unknown major version and ignores unknown fields on minor versions.
- `features[]` gates optional semantics such as `"grid-layout"`.
- Ship a JSON Schema per major version and a `migrate(v1→v2)` in the builder.
- Keep raw `css` facts so an inference upgrade can be re-run against old captures without re-rendering.

---

## 9. Implementation order and test harness

1. Absolute-only builder: frames, rects, text runs, fills, strokes, effects, images, SVG. It is pixel-correct by construction.
2. Font resolution through CDP, plus the report.
3. Flex and block inference with simulation and plugin read-back fallback.
4. Wrap and grid.
5. Probing.
6. Decompositions (borders, masks, pseudo-elements).

Test harness: adopt figit's **oracle/ratchet** idea (`internal/oracle-harness/README.md`).

- Keep a corpus of stories and per-feature fixtures.
- Tier 0: IR versus DOM rect diff.
- Tier 1: Figma read-back bbox diff, through a headless plugin run or the REST API `GET /v1/images` export.
- Tier 2: pixel diff of a Figma PNG export versus a Playwright screenshot.
- CI fails if any scene's max Δ or finding count regresses.

This harness is also how you settle the "verify" items above empirically: shadow order, the backdrop-blur factor, conic origin, and `strokesIncludedInLayout` semantics.

**Sources:**
- [BuilderIO/html-to-figma](https://github.com/BuilderIO/html-to-figma) (at commit 7fece25)
- [sergcen/html-to-figma](https://github.com/sergcen/html-to-figma)
- [figitdesign/web-to-figma](https://github.com/figitdesign/web-to-figma)
- [Lynavo/web2ui](https://github.com/Lynavo/web2ui)
- [niklasvh/html2canvas](https://github.com/niklasvh/html2canvas)
- [qq15725/modern-screenshot](https://github.com/qq15725/modern-screenshot)
- [vercel/satori](https://github.com/vercel/satori)
- [figma/plugin-typings](https://github.com/figma/plugin-typings)
- [Figma: Turn webpages into editable design layers](https://help.figma.com/hc/en-us/articles/40826832449303-Turn-webpages-into-editable-design-layers)
- [Codeminer42: Figma Code to Canvas, what the demo didn't show](https://blog.codeminer42.com/figma-code-to-canvas-what-the-demo-didnt-show-you/)
- [CDP PlatformFontUsage](https://www.selenium.dev/selenium/docs/api/dotnet/webdriver/OpenQA.Selenium.DevTools.V148.CSS.PlatformFontUsage.html)
- [DevTools PlatformFontsWidget.ts](https://chromium.googlesource.com/devtools/devtools-frontend.git/+/HEAD/front_end/panels/elements/PlatformFontsWidget.ts)
- [Penpot HTML TO DESIGN plugin](https://penpot.app/penpothub/plugins/html-to-design)
- [Penpot community: Import HTML + CSS into Penpot](https://community.penpot.app/t/import-html-css-into-penpot/8296)
- [Grida: Figma auto layout mapping](https://grida.co/docs/@designto-code/figma-autolayout)
