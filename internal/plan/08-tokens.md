# 08 · Tokens, variables & styles

> **Scope:** how CSS custom properties and theme switches in a Storybook become Figma **variables**, with collections, modes, aliases, scopes and code syntax. Also how node properties get **bound** to those variables, when **styles** are created, how we match variables that already exist (local or library), and how tokens interop with DTCG, Style Dictionary and Tokens Studio.
>
> **Binding decisions:** D-18 (provenance-only binding; matching before creation; no silent overwrite), D-08 (inference is CLI-side in `mapper`; the plugin only applies), D-19 (identity in shared plugin data).

Contents:
0. Loop slice subset
1. Principles
2. Pipeline overview
3. Discovery: which custom properties are tokens
4. Provenance: proving a value comes from a token
5. Alias chains
6. Collections, naming, types, scopes, code syntax
7. Modes from themes
8. Bindings: field map
9. Styles
10. Matching existing variables & styles
11. External token sources (DTCG / Style Dictionary / Tokens Studio)
12. Token sync & diff
13. Units & value normalization
14. Scene IR shapes
15. Config
16. Diagnostics
17. Edge cases & failure modes
18. Open questions / spikes

---

<a id="slice"></a>
## 0. Loop slice subset

The Loop slice ([14](14-roadmap.md#loop-slice)) ships a subset of this chapter. Everything else is hardening H-F ([14](14-roadmap.md#hardening)).

| In the slice | Hardening H-F |
|---|---|
| CSS custom properties → one local collection (`tokens.collectionName`) | tiered and grouped collections (§6.1) |
| default mode only | modes from themes (§7), `TOKEN_MODE_LIMIT` |
| alias chains (§5) | styles (§9) |
| bindings only when provable (D-18, `confidence: 'chain'`) on fills, strokes, padding, gap, radius, text fills | library matching (§10), value matching (§10.3) |
| untokenized edited values become DCR questions (`DCR_VALUE_UNTOKENIZED`, [15](15-change-requests.md)) | motion tokens; the Chakra and Carbon gates |

---

<a id="principles"></a>
## 1. Principles

1. **Provenance over coincidence (D-18).** A node property is bound to a variable only if capture can prove that the browser computed that value *from* a `var(--x)` reference. Two tokens with equal values (`--blue-500` and `--brand-primary` both `#2563eb`) are never disambiguated by guessing. Value-equality matching exists, but it is opt-in, marked `confidence: "value"`, and shown in the report.
2. **Reuse before create.** Before creating a variable, the plugin looks for one already in the file or in an enabled library. It matches by `codeSyntax.WEB`, then by name, then (only if opted in) by value ([§10](#matching)).
3. **Never silently overwrite.** If a variable exists and its value differs from code, the change goes into the Tokens diff and the user applies it explicitly ([§12](#sync)). Unchanged values cost zero writes.
4. **Modes, not variants, for themes.** Theme or brand switches become variable **modes** where the plan allows. A `Theme` variant axis is a fallback only ([§7](#modes)).
5. **Deterministic output.** The same Storybook build yields byte-identical `tokens.json` (sorted keys, canonical JSON from `ir`).

---

<a id="pipeline"></a>
## 2. Pipeline overview

```
capture (per variant, per mode)                     mapper (CLI, pure)                    plugin
───────────────────────────────                     ──────────────────                    ──────
A. Token discovery   ─► CaptureDoc.tokens[]  ─┐
   (root/theme scopes, custom props,           ├─► token graph build ─► TokensDoc ─► tokens.json ─► preflight: match
    per-mode values)                           │   (aliases, types,       (collections,              ─► diff (Tokens tab)
B. Provenance probes ─► CaptureNode.provenance ┘    scopes, naming)        modes, vars)               ─► import + create/update vars
   (CDP matched styles per                          binding resolution ─► SceneNode.bind ──────────► bind on apply
    node+property)                                  (per node field)
```

- **Discovery** (A) runs once per Storybook *and per mode*, not per variant. Results are cached under key `H(storybookFingerprint, modeGlobals)`.
- **Provenance** (B) runs per captured node, but only for properties the mapper can bind ([§8](#bindings)). This keeps the cost bounded ([§4.5](#prov-cost)).

---

<a id="discovery"></a>
## 3. Discovery: which custom properties are tokens

### 3.1 What counts as a token

A custom property `--x` is a **token candidate** when it is *declared* (not merely inherited) in a scope outside the component's own subtree. Allowed scopes:

| Scope | Example | Included by default |
|---|---|---|
| `:root` / `html` | `:root { --color-bg: #fff }` | ✅ |
| `body` | `body { --space-2: 8px }` | ✅ |
| Theme selectors on root/body/decorator wrapper | `[data-theme="dark"]`, `.theme-dark`, `.dark` | ✅ (these become modes, [§7](#modes)) |
| `@property` registrations | `@property --radius { syntax:'<length>'; initial-value: 4px }` | ✅ (typed, see [§6.3](#types)) |
| Ancestors added by decorators (`#storybook-root`, provider wrappers) | `<div class="ThemeProvider" style="--accent:…">` | ✅ if outside the captured component root ([03](03-storybook.md#root)) |
| Inside the component subtree | `.btn { --_btn-pad: 12px }` | ❌ component-private; never a token |
| Names matching `^--_` | `--_internal` | ❌ (story.to.design uses the same convention, research §5) |
| Names matching `config.tokens.ignore` (strings/regex) | `--tw-*`, `--radix-*`, `--chakra-ring-*` | ❌. The default ignore list ships with known framework internals |

The default ignore list (configurable, extendable) covers:

- Tailwind internals: `--tw-ring-*`, `--tw-shadow*`, `--tw-translate-*`, `--tw-*` *except* those referenced by the user's theme.
- Radix and Floating UI positioning vars: `--radix-*`, `--floating-*`, `--transform-origin`.
- Storybook's own `--sb-*`.

### 3.2 How discovery works (capture side, package `capture`)

1. **Collect declarations.** Walk `document.styleSheets` and every open (or hooked closed) shadow root's `adoptedStyleSheets` and `styleSheets` ([05](05-capture.md#tree-walk)). For each `CSSStyleRule` whose `style` contains `--*` properties, record:
   - `{name, selectorText, specifiedValue, sheetHref, mediaText, layerName}`.
   - Cross-origin sheets throw on `.cssRules`. For those, fall back to CDP `CSS.getStyleSheetText`, which works regardless of CORS because it is engine-level, then parse with a tolerant CSS parser (`css-tree`, run in Node).
2. **Resolve per scope.** For each candidate scope element (`documentElement`, `body`, theme wrapper, the captured root's parent chain *outside* the component):
   - Read `getComputedStyle(el).getPropertyValue('--x')`. This gives the *computed* value, with `var()` already substituted.
   - Read the *specified* value from CDP `CSS.getMatchedStylesForNode(nodeId)`. Its `matchedCSSRules[].rule.style.cssProperties` and `inherited[]` keep authored text such as `var(--blue-500)`.
3. **Classify.** Each token record is `literal` when its specified value has no `var(`, `alias` when it is exactly `var(--y)` (optionally with fallback), or `expression` otherwise (`calc()`, `color-mix()`, multiple `var()`s, keywords).
4. **Repeat per mode** ([§7](#modes)) after applying the mode's globals.

```ts
// packages/ir: Capture IR token record (see 06-ir.md#capture-tokens)
interface CapturedToken {
  name: string;                   // "--color-bg"
  scope: 'root' | 'body' | 'theme' | 'decorator' | 'property-rule';
  selector?: string;              // ':root', '[data-theme="dark"]'
  specified: string;              // authored text: "var(--gray-900)" | "#0f172a" | "calc(var(--space-1) * 2)"
  computed: string;               // getComputedStyle value at the scope element: "#0f172a"
  kind: 'literal' | 'alias' | 'expression';
  aliasOf?: string;               // "--gray-900" when kind === 'alias'
  fallback?: string;              // var(--y, <fallback>)
  registered?: { syntax: string; inherits: boolean; initialValue?: string }; // @property
  source: { sheetHref?: string; media?: string; layer?: string };
  modeId: string;                 // capture mode id (§7); "default" when there are no modes
}
```

### 3.3 Unused tokens

By default only tokens that are **referenced**, transitively, by at least one bound node property of an imported component are emitted. `tokens.include: 'all'` emits every discovered token, so that the Figma file mirrors the full token set even before components use it. Unreferenced tokens are counted in the report (`TOKEN_UNUSED`, info).

---

<a id="provenance"></a>
## 4. Provenance: proving a value comes from a token

### 4.1 Mechanism

For each captured node and each **bindable property** ([§8](#bindings)), the capture engine asks CDP which declaration won and what its authored text was:

```ts
// packages/capture/src/cdp/provenance.ts (runs Node-side over CDP)
const { matchedCSSRules, inlineStyle, inherited } =
  await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
// 1. Build the cascade for property P: inline > matched rules (already ordered by CDP: last wins,
//    respecting !important and @layer) > inherited (for inherited properties only: color, font-*, letter-spacing, line-height).
// 2. Take the winning declaration's `value` text (authored), e.g. "var(--color-bg)".
```

The winning declaration is selected by re-running cascade ordering on CDP's lists. CDP returns `matchedCSSRules` in ascending specificity/order. `cssProperties[].important`, `disabled` and `implicit` (longhands expanded from shorthands) are honoured. The algorithm lives in `capture/src/cdp/cascade.ts`, and fixture tests cover:

- `!important`;
- `@layer` ordering;
- `:where()` zero specificity;
- inline style;
- shorthand-to-longhand expansion.

### 4.2 Parsing the winning value

The authored value text is parsed into a tiny AST: `var(name, fallback?)`, functions, literals, separators. Examples:

| Winning declaration (authored) | Property bound | Result | Confidence |
|---|---|---|---|
| `background-color: var(--color-bg)` | fill color | bind → `--color-bg` | `chain` |
| `background: var(--color-bg)` | fill color (shorthand) | bind → `--color-bg` (the longhand `background-color` is implicit, inheriting the shorthand text) | `chain` |
| `border: 1px solid var(--color-border)` | stroke color → `--color-border`; stroke weight literal | partial: color bound, width unbound | `chain` (color) |
| `padding: var(--space-2) var(--space-4)` | `paddingTop/Bottom` → `--space-2`, `paddingLeft/Right` → `--space-4` | positional shorthand expansion (1–4 values) | `chain` |
| `gap: var(--space-2)` | `itemSpacing` (and `counterAxisSpacing` when wrap) | bind | `chain` |
| `color: var(--fg, #111)`, with `--fg` defined | text fill → `--fg` | bind | `chain` |
| `color: var(--fg, #111)`, with `--fg` *undefined* (the fallback was used) | — | no bind; literal `#111` | — (`TOKEN_FALLBACK_USED`, info) |
| `color: var(--fg, var(--fg-default))`, with `--fg` undefined | text fill → `--fg-default` | bind to the fallback var | `chain` |
| `padding: calc(var(--space-2) * 2)` | — | no bind (an expression has no variable equivalent) | — (`TOKEN_EXPRESSION_UNBOUND`, info) |
| `background: color-mix(in srgb, var(--brand) 80%, white)` | — | no bind | — (`TOKEN_EXPRESSION_UNBOUND`) |
| `border-radius: var(--radius)`, where `--radius: 9999px` and the box is 32px tall | corner radii | bind. The *effective* radius is clamped by the CSS overlap rule ([07](07-mapping.md#radius)). If clamping changed the value, the bound value differs from the rendered one, so we **don't bind** | — (`TOKEN_CLAMPED_UNBOUND`) |
| `box-shadow: var(--shadow-md)`, a full shadow list | effect | effect style (preferred, [§9.2](#effect-styles)) or per-field effect variables when the shadow parts are themselves vars | `chain` |
| `box-shadow: 0 1px 2px var(--shadow-color)` | effect color → `--shadow-color` | `setBoundVariableForEffect(color)` | `chain` |
| `font: var(--font-body)`, a shorthand token | — | `font` shorthands are expanded by the browser; the longhands carry the implicit shorthand text. Map to a text style if the token resolves to a typography group ([§9.1](#text-styles)) | `chain` |
| inherited `color` from an ancestor declared `color: var(--fg)` | text fill → `--fg` | bind (use CDP `inherited[]`) | `chain` |
| Tailwind `bg-blue-500` compiled to `background-color: rgb(59 130 246 / var(--tw-bg-opacity, 1))` | — | `--tw-*` is ignored and the expression has no variable | — (Tailwind v4 uses `var(--color-blue-500)` directly, which binds `chain`) |

**Confidence levels** are carried in the Scene IR (`VarRef.confidence`, [§14](#scene-ir)):

- `chain`: provenance proven by the cascade.
- `value`: opt-in value-equality match against the token table ([§10.3](#value-match)).
- none: unbound (no `VarRef`).

The plugin binds `chain` always, and binds `value` only when `tokens.bindByValue: true`.

### 4.3 Sanity check: computed equals token value

A binding is emitted only if the node's computed value equals the token's resolved value at that node, within tolerance:

- colors: ΔE2000 < 0.5 after sRGB conversion;
- lengths: |Δ| < 0.01px.

The token's resolved value is `getComputedStyle(node).getPropertyValue('--x')`, because a var can be *redeclared* on an intermediate ancestor. If the check fails, the binding is dropped with `TOKEN_PROVENANCE_MISMATCH` (warn). Typical cause: `opacity` or `filter` applied over the color, or a scoped redeclaration that points to a different token.

**Scoped redeclaration.** Suppose an ancestor *inside* the component redeclares `--color-bg: var(--gray-50)`. The binding then follows the redeclared alias to `--gray-50` and records `via: ['--color-bg@.card']`. Component-private redeclarations can't be variables themselves, so we bind to the first token in the chain that lives outside the component. If none exists, the property is unbound (`TOKEN_PRIVATE_CHAIN`, info).

### 4.4 Inherited and late-bound properties

- Inherited properties (`color`, `font-*`, `line-height`, `letter-spacing`) are resolved through `inherited[]`. The TEXT node's run gets the binding.
- `currentColor` in SVG `fill`/`stroke`, or in `border-color: currentColor`, follows the `color` property's provenance.

<a id="prov-cost"></a>
### 4.5 Cost control

`CSS.getMatchedStylesForNode` costs 7–9 ms per element on ds-react ([S-19 §4.5](../spikes/S-19.md); budget 10 ms), because every response repeats the ancestors' rules. To bound it:

1. Call it only for nodes that have at least one bindable, non-default property (a visible fill, stroke, padding, gap, radius, text, effect).
2. Cache by `(stylesheetFingerprint, element signature = tag + sorted classList + inline style hash + ancestor theme)`. Across the variants of one component, most nodes repeat.
3. Skip it entirely when `tokens.enabled: false`.

---

<a id="aliases"></a>
## 5. Alias chains

The token graph is a DAG: `--btn-bg → --color-primary → --blue-600 → #2563eb`. The mapper builds it from `CapturedToken.aliasOf` per mode.

- **Alias edges** become variable aliases: `variable.setValueForMode(modeId, figma.variables.createVariableAlias(target))`.
- **Per-mode aliasing.** Each mode may alias differently: `--color-bg` → `--white` (light) vs `--gray-950` (dark). The variable gets an alias value per mode.
- **Cycles.** CSS treats a cyclic var as invalid at computed-value time. Detect the cycle, keep the first member as a literal using its computed value, and emit `TOKEN_ALIAS_CYCLE` (warn).
- **Cross-collection aliases** are allowed by Figma (an alias may point to a variable in another collection), and the Semantic → Primitives split relies on them.
- **Type mismatch along the chain** (a STRING aliasing a COLOR): break the alias and emit a literal with `TOKEN_TYPE_CONFLICT`.
- **Fallback chains** (`var(--a, var(--b))`) produce no alias. They are resolved at provenance time ([§4.2](#provenance)).

---

<a id="collections"></a>
## 6. Collections, naming, types, scopes, code syntax

### 6.1 Collection strategy

| Strategy (`tokens.collections`) | Behaviour | Default |
|---|---|---|
| `"tiered"` | **Primitives**: tokens whose value is a literal in every mode and that are referenced only as alias targets or directly. **Semantic**: tokens that are aliases in at least one mode. Modes live only on Semantic; Primitives has a single mode `Value` | ✅ |
| `"single"` | One collection named `tokens.collectionName` (default `"Tokens"`) | |
| `{ groups: [{ name, match: RegExp \| string[] , modes?: boolean }] }` | Grouped by prefix/regex, first match wins, the rest go to `"Other"`. Example: `[{name:'Color', match:/^--color-/}, {name:'Space', match:/^--space-/}]` | |

Tiered is the default because it matches how most design systems (and Figma's own guidance) structure tokens. It also keeps Primitives mode-free, which minimizes plan-limited modes ([§7.4](#mode-limits)).

A token whose value is literal in one mode and an alias in another lands in Semantic. Its literal mode value is stored as a raw value.

### 6.2 Naming

The default transform is applied in order:

1. Strip the leading `--`.
2. Strip a configured prefix (`tokens.stripPrefix`, e.g. `ds-`).
3. Split into a group path:
   - `--` (double dash) **always** splits, so `--color--bg--hover` becomes `color/bg/hover` (story.to.design compatible, research §5);
   - additionally, with `tokens.naming: "dash-groups"` (default), the **first** single dash splits the group: `--color-bg-hover` → `color/bg-hover`;
   - `"flat"` keeps `color-bg-hover`;
   - `"all-dashes"` gives `color/bg/hover`.
4. A custom `tokens.rename: (cssName) => string` function in `holotype.config.ts` overrides everything.

Collisions after transformation, e.g. `--color-bg` (flat) vs `--color--bg`, get a numeric suffix and `TOKEN_NAME_COLLISION` (warn). The `codeSyntax.WEB` keeps the original name, so code ↔ design mapping stays exact.

### 6.3 Type inference <a id="types"></a>

| Evidence (first hit wins) | Figma `resolvedType` |
|---|---|
| `@property` `syntax: '<color>'` / `'<length>'` / `'<number>'` / `'<percentage>'` | COLOR / FLOAT (px) / FLOAT / FLOAT (with unit note) |
| Used in a bound color site (fill, stroke, text color, shadow color) | COLOR |
| Used in a bound length site (padding, gap, radius, size, stroke weight, font size, letter spacing, line height px) | FLOAT |
| Used for `opacity` | FLOAT (0–1, scope OPACITY) |
| Used for `font-family` | STRING (scope FONT_FAMILY) |
| Used for `font-weight` | FLOAT (scope FONT_WEIGHT); a named weight yields STRING with scope FONT_STYLE (verify, S-12) |
| Computed value parses as a color (`#…`, `rgb()`, `oklch()`…) | COLOR |
| Parses as `<number>px` / `<number>rem` / unitless number | FLOAT ([§13](#units)) |
| Anything else (`"Inter, sans-serif"`, `ease-in-out`, `none`) | STRING (and not bound unless it is a font family) |

Durations and easings (`--duration-fast: 150ms`, `--ease-out: cubic-bezier(…)`) map to the new `TIMING` / `EASING` variable types (typings 1.142.0) only when `tokens.motion: true`. They are never bound, because prototype interactions are out of scope in v1.

### 6.4 Scopes

Scopes are inferred from the union of *usage sites* across all imported components, so pickers stay clean in Figma.

| Usage site | Scope |
|---|---|
| frame/shape fill | `FRAME_FILL`, `SHAPE_FILL` |
| text fill | `TEXT_FILL` |
| stroke color | `STROKE_COLOR` |
| shadow color | `EFFECT_COLOR` |
| padding / gap | `GAP` |
| radius | `CORNER_RADIUS` |
| width/height/min/max | `WIDTH_HEIGHT` |
| stroke weight | `STROKE_FLOAT` |
| opacity | `OPACITY` |
| shadow radius/spread/offset | `EFFECT_FLOAT` |
| font size / line height / letter spacing / weight / family | `FONT_SIZE`, `LINE_HEIGHT`, `LETTER_SPACING`, `FONT_WEIGHT`, `FONT_FAMILY` |

Additional rules:

- **Primitives** referenced only via aliases get `scopes = []`. They are hidden from pickers, which is the recommended practice for primitives.
- A semantic token with no observed usage gets `ALL_SCOPES` for its type.
- `tokens.scopes: "all"` disables inference.

### 6.5 Code syntax and description

- `variable.setVariableCodeSyntax('WEB', 'var(--color-bg)')` is set always. This is the identity link back to code and the primary matching key ([§10](#matching)).
- `description`: from DTCG `$description` when a tokens file is provided ([§11](#external)), else from a `/* @desc … */` comment immediately preceding the declaration, when it can be extracted from the sheet text.
- `variable.hiddenFromPublishing = true` for Primitives when `tokens.hidePrimitives: true` (default false).

---

<a id="modes"></a>
## 7. Modes from themes

### 7.1 Where modes come from (first hit wins)

1. `holotype.config.ts` → `tokens.modes: [{ name: 'Light', globals: { theme: 'light' } }, { name: 'Dark', globals: { theme: 'dark' } }]`.
2. `parameters.holotype.modes` (project level) ([04](04-variant-model.md#config)).
3. `@storybook/addon-themes`: the `storybook/themes/REGISTER_THEMES` event payload `{themes, defaultTheme}`, or `globalTypes.theme.toolbar.items` ([03](03-storybook.md#themes)).
4. `parameters.chromatic.modes`, restricted to entries that differ only in a theme-like global (`theme`, `mode`, `scheme`, `colorScheme`, `brand`).
5. `prefers-color-scheme` only: if a sheet contains `@media (prefers-color-scheme: dark)` rules that declare tokens, synthesize modes Light/Dark via `page.emulateMedia({ colorScheme })`.

### 7.2 Capture per mode

For each mode:

1. Apply its globals (`updateGlobals`), or `emulateMedia` for the scheme case.
2. Wait for `globalsUpdated` + `storyRendered` ([03](03-storybook.md#render-loop)).
3. Re-run token discovery ([§3.2](#discovery)).

Variant geometry is captured **once**, in the default mode. Per-mode re-capture of variants is needed only to detect **non-token theme differences**: properties whose computed value differs between modes but that have no `chain` provenance. A sample of `tokens.modeProbeVariants` (default: the default variant of every component) is re-captured in each mode and diffed node by node via `nk`.

- If every differing property is token-bound, modes are sufficient.
- Otherwise emit `TOKEN_MODE_UNTOKENIZED_DIFF` (warn) listing the node and property, and apply `tokens.themeFallback`. The default `"variant-axis"` adds a `Theme` VARIANT axis for *that component only* (matches 04 §7.1 and 07 §16, `PLAN_THEME_AS_AXIS`). `"report"` only reports.

### 7.3 Applying modes

- The **Semantic** (or each mode-bearing) collection gets one mode per capture mode:
  - `collection.renameMode(collection.modes[0].modeId, 'Light')`;
  - `collection.addMode('Dark')`.
- The default mode is the one matching Storybook's `initialGlobals` or `defaultTheme`.
- Component sets inherit the page's mode. The documentation frame ([09](09-plugin.md#doc-frame)) shows a *mode preview row*: an instance of the default variant per mode inside frames with `frame.setExplicitVariableModeForCollection(collection, modeId)`.
- Explicit modes are never set on main components themselves. That would pin consumers.

<a id="mode-limits"></a>
### 7.4 Plan limits

The mode count per collection is plan-limited: Starter 1 (verify), Professional up to 10 modes per collection, Organization and Enterprise 20 (verify at write time). Enterprise also has **extended collections** (`VariableCollection.extend(name)` → `ExtendedVariableCollection`), the preferred answer for a brand dimension.

- The plugin does not know the plan. It tries `addMode` and catches the error.
- On failure, apply `tokens.modeOverflow` and emit `TOKEN_MODE_LIMIT` (warn), with guidance to upgrade or reduce modes:
  1. `"variant-axis"` (default): drop the extra modes and add a `Theme` axis on affected components.
  2. `"extend"` (Enterprise): put the overflow brand values in an extended collection of the mode-bearing collection.
  3. `"split"`: create additional collections `Semantic (2)`, …, each holding the overflow modes with duplicated variables. These collections' modes do not compose: a binding points to one collection, so it cannot switch between them.
  4. `"first-only"`: import the default mode only.

---

<a id="bindings"></a>
## 8. Bindings: field map

This is the complete set the applier ([09](09-plugin.md#apply-order)) knows how to bind. All names are verified in `@figma/plugin-typings@1.142.0`.

| Scene field | CSS source | Plugin API call | Variable type |
|---|---|---|---|
| `fills[i]` (SOLID color) | `background-color`, `color` on shapes, SVG fill | `node.fills = [figma.variables.setBoundVariableForPaint(paint, 'color', v)]` (returns a **new** paint) | COLOR |
| `strokes[i]` color | `border-*-color`, `outline-color` | same, on `strokes` | COLOR |
| gradient stop color | `linear-gradient(var(--a), var(--b))` | `setBoundVariableForPaint` accepts SolidPaint only. For gradients, build new `ColorStop` objects with `boundVariables: { color: { type: 'VARIABLE_ALIAS', id } }` (`VariableBindableColorStopField = 'color'`) and reassign the paint. S-12 keeps only the render check | COLOR |
| text range fill | `color` | `text.setRangeFills(s, e, [setBoundVariableForPaint(…)])` | COLOR |
| `paddingTop/Right/Bottom/Left` | `padding-*` (+ border, [07](07-mapping.md#border-padding)) | `node.setBoundVariable('paddingLeft', v)`. **Only when the Scene padding equals the token value**: with D-16, padding = CSS padding + border width, so a 1px border breaks equality. Then **don't bind**, and emit `TOKEN_PADDING_BORDER_OFFSET` (info). See [§17](#edge) | FLOAT |
| `itemSpacing` / `counterAxisSpacing` | `gap`, `column-gap`, `row-gap` | `setBoundVariable('itemSpacing' \| 'counterAxisSpacing', v)` | FLOAT |
| `gridRowGap` / `gridColumnGap` | grid gaps | `setBoundVariable('gridRowGap' \| 'gridColumnGap', v)` | FLOAT |
| corner radii | `border-*-radius` | `setBoundVariable('topLeftRadius', v)` × 4 (prefer the per-corner fields even when uniform) | FLOAT |
| `width` / `height` | `width`/`height` when FIXED | `setBoundVariable('width', v)`, only when sizing is FIXED on that axis | FLOAT |
| `minWidth` / `maxWidth` / `minHeight` / `maxHeight` | `min-*`/`max-*` | `setBoundVariable('minWidth', v)` … | FLOAT |
| `strokeWeight` / per side | `border-*-width` | `setBoundVariable('strokeTopWeight', v)` … | FLOAT |
| `opacity` | `opacity` | `setBoundVariable('opacity', v)` (0–1) | FLOAT |
| `visible` | — | not bound from CSS (BOOLEAN component properties handle visibility, [04](04-variant-model.md#classification)) | — |
| `characters` | — | not bound from CSS (TEXT properties) | — |
| text `fontSize` | `font-size` | `text.setRangeBoundVariable(s, e, 'fontSize', v)` | FLOAT |
| text `lineHeight` | `line-height` (px) | `setRangeBoundVariable(s, e, 'lineHeight', v)`. Unitless line-height tokens are converted ([§13](#units)) | FLOAT |
| text `letterSpacing` | `letter-spacing` | `setRangeBoundVariable(s, e, 'letterSpacing', v)` | FLOAT |
| text `fontFamily` | `font-family` | `setRangeBoundVariable(s, e, 'fontFamily', v)`. Bind only if the token's *first* family equals the resolved used face family ([05](05-capture.md#fonts)) | STRING |
| text `fontWeight` | `font-weight` | `setRangeBoundVariable(s, e, 'fontWeight', v)` (verify, S-12) | FLOAT |
| text `paragraphSpacing` / `paragraphIndent` | margins between paragraphs / `text-indent` | `setRangeBoundVariable(…)` | FLOAT |
| effect color/radius/spread/offset | `box-shadow` parts | `node.effects = [figma.variables.setBoundVariableForEffect(effect, 'color' \| 'radius' \| 'spread' \| 'offsetX' \| 'offsetY', v)]` | COLOR / FLOAT |

Ordering constraints, owned by the applier and detailed in [09](09-plugin.md#apply-order):

1. **Binding values.** Binding to a FLOAT changes the node's value to the variable's value *in the resolved mode*. Bind *after* the literal is set, so the read-back check compares like with like.
2. **Text.** Fonts must be loaded before `setRangeBoundVariable` on font fields. Binding `fontFamily`/`fontWeight` can switch to an unloaded style: load the font for *every mode value* first.
3. **Immutable paints and effects.** Arrays are immutable. Clone, bind, then reassign the whole array.

---

<a id="styles"></a>
## 9. Styles

Variables are the primary output. Styles are created only where variables can't express the concept, or where the user asks for them.

<a id="text-styles"></a>
### 9.1 Text styles (opt-in: `tokens.textStyles`)

| Mode | Source of styles |
|---|---|
| `"tokens"` | Typography token groups: `--font-body`, `--text-sm-*`, or DTCG `typography` composite tokens ([§11](#external)). Each group yields `figma.createTextStyle()` with fontName/size/lineHeight/letterSpacing. Fields are bound to variables when those are tokens (text styles support `setBoundVariable` on typography fields) (verify, S-12) |
| `"classes"` | Text runs whose styles came from a *class* matching `tokens.textStyleClass` (e.g. `/^text-(xs\|sm\|base\|lg)/`, or `.typography-*`). Provenance comes from matched rules |
| `"dedupe"` | Every distinct `(family, style, size, lineHeight, letterSpacing, case, decoration)` combo used at least `minUses` (default 3) times becomes a style named `Text/<size>/<weight>`. Noisy, so off unless explicitly chosen |
| `false` (default) | No text styles; ranges carry literal or variable-bound values |

Apply with `text.setRangeTextStyleIdAsync(s, e, style.id)`. When a style is applied, per-range literal fields that equal the style are not also set, to avoid overrides.

<a id="effect-styles"></a>
### 9.2 Effect styles (default on when shadow tokens exist)

When a node's full `box-shadow` comes from one token (`box-shadow: var(--shadow-md)`):

1. Create or update `figma.createEffectStyle()` named from the token (`shadow/md`), whose effects are the parsed shadow list.
2. Apply it with `node.setEffectStyleIdAsync(style.id)`.
3. Mode-dependent shadows (dark-mode shadows): effect *styles* have no modes. If the parts are tokens, bind per-field effect variables on the style's effects instead. Otherwise keep the default-mode shadow and emit `TOKEN_EFFECT_MODE_DIFF` (info).

### 9.3 Paint styles (legacy option: `tokens.paintStyles: true`)

For teams still on styles, also mirror COLOR variables as paint styles named identically. Their paints are variable-bound via `setBoundVariableForPaint`, so styles and variables don't drift. Off by default.

### 9.4 Grid and layout styles

Not generated.

---

<a id="matching"></a>
## 10. Matching existing variables & styles

Matching runs in plugin **preflight** ([09](09-plugin.md#preflight)), before any write, and is read-only. Importing the chosen library matches is a write; it runs in the `tokens` stage after the user confirms Apply (§10.1).

### 10.1 Candidate sets

1. **Local**:
   - `await figma.variables.getLocalVariableCollectionsAsync()`;
   - `await figma.variables.getLocalVariablesAsync()`;
   - `figma.getLocalTextStylesAsync()`, `getLocalEffectStylesAsync()`, `getLocalPaintStylesAsync()`.
2. **Libraries** (requires `permissions: ["teamlibrary"]`):
   - `await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()` lists the collections in libraries enabled for the file;
   - for each collection, `figma.teamLibrary.getVariablesInLibraryCollectionAsync(collection.key)` returns `{ key, name, resolvedType }`.
   - Preflight matches by name and key from `getVariablesInLibraryCollectionAsync` only (read-only).
   - `importVariableByKeyAsync` / `importComponentByKeyAsync` add library references to the document, so they are writes. They run in the `tokens` stage **after** the user confirms Apply, for the chosen matches only. Only then are library `codeSyntax` and `valuesByMode` read, so value drift (`TOKEN_LIBRARY_VALUE_DRIFT`) is reported during Apply, not in preflight. 09 mirrors this.
   - To bound the cost, import at most `tokens.libraryProbeLimit` matches (default 500) (verify, S-12).

### 10.2 Match order (per token)

| Order | Rule | Result |
|---|---|---|
| 1 | Previously linked: the variable's shared plugin data `holotype/tok = "--color-bg"` ([10](10-sync.md#keys)) | reuse |
| 2 | `codeSyntax.WEB` equals `var(--color-bg)` (normalized whitespace), or equals `--color-bg`. Local variables only; library `codeSyntax` is readable only after import (§10.1) | reuse (`match: 'codeSyntax'`) |
| 3 | Transformed name equals the variable name (case-insensitive, `/` and `-`/`.` normalized), and types agree | reuse (`match: 'name'`). Surface in preflight for confirmation if the *value* also differs |
| 4 | Value equality (per default mode) and type agree; only with `tokens.matchByValue: true` | propose (`match: 'value'`); always requires user confirmation |
| — | none | create a local variable |

**Library variables always win over creating local duplicates.** A matched library variable is *bound* but never *modified*: the plugin cannot edit remote variables. If its value differs from code, emit `TOKEN_LIBRARY_VALUE_DRIFT` (warn) and show it in the Tokens tab as "library differs from code: update the library file".

Styles match the same way: name, then a `holotype/tok` pluginData link, then (for text styles) the field tuple. Matched library styles are imported with `figma.importStyleByKeyAsync(key)`.

<a id="value-match"></a>
### 10.3 Value-equality binding (opt-in)

With `tokens.bindByValue: true`, the mapper also marks unbound node properties whose value equals exactly one token's value in the default mode (and in *every* mode, when modes exist) as `confidence: 'value'`. Each value-equality match emits `TOKEN_VALUE_MATCHED` (info). Ambiguity, where several tokens share the value, yields no bind, with `TOKEN_VALUE_AMBIGUOUS` (info, lists the candidates). This rescues CSS-in-JS libraries that inline literal theme values (emotion/styled-components theme objects) at the cost of possible false positives.

---

<a id="external"></a>
## 11. External token sources (DTCG / Style Dictionary / Tokens Studio)

### 11.1 Import an authoritative tokens file

`tokens.source: "./tokens/**/*.json"` accepts:

| Format | Detection | Notes |
|---|---|---|
| **DTCG** (W3C Design Tokens Community Group format, `$value`/`$type`/`$description`, `{group.token}` aliases) | any `$value` key | First-class. `$type` → resolvedType (`color` → COLOR; `dimension`/`number` → FLOAT; `fontFamily` → STRING; `typography` → text style; `shadow` → effect style). Aliases map to variable aliases |
| **Style Dictionary** (`value`/`type`, `{a.b}` refs) | `value` without `$` | Converted to DTCG internally |
| **Tokens Studio** (single file or multi-file with `$themes.json`, `$metadata.json`) | `$themes` | Token sets map to collections; `$themes` map to modes. Tokens Studio's shared plugin data namespace `tokens` is **read-only** to us; we never write it |

When a tokens file is present:

- It becomes the **source of truth** for names, types, descriptions, collections and modes.
- CSS discovery is used only to (a) **link** CSS custom properties to tokens, via a `tokens.cssName` mapping (default: DTCG path `color.bg.default` → `--color-bg-default`, which is Style Dictionary's default `css/variables` transform), and (b) **verify**: a token value that differs from the CSS computed value yields `TOKEN_SOURCE_CSS_MISMATCH` (warn).
- Provenance binding ([§4](#provenance)) still decides *which node binds to which token*. The file decides *what the variable is*.

### 11.2 Export

`holotype export --tokens dtcg` writes the discovered token graph (from CSS) as DTCG JSON. Teams can bootstrap a tokens pipeline from an existing CSS-only design system. This export is the same `tokens.json` the bundle carries, serialized as DTCG (see [§14](#scene-ir)).

---

<a id="sync"></a>
## 12. Token sync & diff

Token changes are shown in a dedicated **Tokens** tab of the diff preview ([10](10-sync.md#apply-plan), [11](11-ux.md)).

```ts
type TokenChange =
  | { op: 'create-collection'; name: string; modes: string[] }
  | { op: 'add-mode'; collection: string; mode: string }
  | { op: 'create-variable'; token: string; name: string; collection: string; type: VariableResolvedDataType }
  | { op: 'update-value'; token: string; variableId: string; mode: string; from: TokenValue; to: TokenValue }   // literal or alias
  | { op: 'update-meta'; token: string; variableId: string; field: 'scopes' | 'description' | 'codeSyntax' | 'name'; from: unknown; to: unknown }
  | { op: 'library-drift'; token: string; libraryVariableKey: string; libValue: TokenValue; codeValue: TokenValue } // informational only
  | { op: 'orphan'; variableId: string; token: string }   // linked variable no longer in code → never auto-deleted
```

Policies:

| Situation | Default |
|---|---|
| New token | create (auto-checked) |
| Value changed in code, Figma variable unchanged since our last write (`ah` matches, [10](10-sync.md#designer-edits)) | update (auto-checked) |
| Value changed in code **and** the designer changed it in Figma (`ah` mismatch) | conflict, unchecked; the user picks code or Figma |
| Renamed in Figma by the designer | keep the designer's name; identity is via `holotype/tok` and `codeSyntax` |
| Token removed from code | `orphan`: the variable keeps its name (renaming would break consumers' references and mental model); its `description` gets the prefix `[deprecated] `, it is listed in the report, and it is never deleted automatically |
| Library variable drift | informational row |

Every write is recorded in the variable's shared plugin data: `holotype/tok`, `holotype/ah` (hash of the values we wrote per mode, plus scopes and codeSyntax).

---

<a id="units"></a>
## 13. Units & value normalization

| CSS value | Figma value |
|---|---|
| `px` | number |
| `rem` | `n × rootFontSize`, where `rootFontSize` = computed `font-size` of `documentElement` at capture (usually 16). The *variable* stores px. `codeSyntax` keeps `var(--x)`, so code is unaffected |
| `em` in a token | evaluated per usage, so not a stable variable. Bind only if the token's computed px is identical at every usage site; else unbound with `TOKEN_RELATIVE_UNIT` (info) |
| `%` (lengths) | not bindable (context-dependent); unbound |
| unitless `line-height` token (`--leading-tight: 1.25`) | FLOAT variables can't be "percent" (verify, S-12). Options (`tokens.lineHeight`): `"px-per-usage"` (default) binds only when a single font size uses it (value = size × factor); `"percent-string"` creates no variable and uses literal PERCENT line height |
| `letter-spacing` in `em` | px at the usage font size; same per-usage rule as `em` |
| colors (`oklch()`, `color(display-p3 …)`, `color-mix` results) | converted to sRGB with gamut mapping (colorjs.io `toGamut`), or P3 when `figma.root.documentColorProfile === 'DISPLAY_P3'` ([07](07-mapping.md#color)). A `LEGACY` profile is treated as sRGB. When the CSS original is present, the applier prefers Figma's own conversion (`figma.util.rgb`/`solidPaint` on the original string, 07 §9); the mapper's numbers are the fallback. The original string is kept in the variable description when `tokens.keepOriginalColor: true` |
| alpha colors | COLOR variable with `a < 1` |
| `font-weight: 600` | FLOAT 600 |
| `font-family: "Inter", sans-serif` | STRING `Inter` (first family only) |

---

<a id="scene-ir"></a>
## 14. Scene IR shapes

Canonical shapes: `TokensDoc` (the bundle's `tokens.json`) and `SceneBindings`/`VarRef` (on Scene nodes) in [06 §4.3](06-ir.md#tokens). This chapter defines semantics only: which token a field binds to (§4, §8), with which `confidence` (`'chain' | 'value'`, §4.2), and how collections, modes and names are derived (§6, §7).

---

<a id="config"></a>
## 15. Config

Schema and defaults: [16 §tokens](16-config.md#tokens). Semantics below. §7 is the single owner of theme → mode semantics; there is no top-level `themes` key, and 04's per-component `modes` only overrides `tokens.modes` for that component.

```ts
tokens: {
  enabled: true,
  include: 'referenced',                    // | 'all'
  includePatterns: undefined,               // string[]: globs on CSS names, added to 'referenced'
  ignore: [/^--tw-/, /^--radix-/],          // merged with defaults
  stripPrefix: undefined,
  naming: 'dash-groups',                    // | 'flat' | 'all-dashes'
  rename: undefined,                        // (css: string) => string
  collections: 'tiered',                    // | 'single' | { groups: [...] }
  collectionName: 'Tokens',
  modes: undefined,                         // explicit [{ name, globals }]
  modeOverflow: 'variant-axis',             // | 'extend' | 'split' | 'first-only'
  themeFallback: 'variant-axis',            // | 'report'
  modeProbeVariants: 'default-variant',     // | 'all' | number
  bindByValue: false,
  matchByValue: false,
  libraryProbeLimit: 500,
  textStyles: false,                        // | 'tokens' | 'classes' | 'dedupe'
  effectStyles: true,
  paintStyles: false,
  hidePrimitives: false,
  scopes: 'infer',                          // | 'all'
  lineHeight: 'px-per-usage',
  motion: false,
  source: undefined,                        // DTCG/SD/Tokens Studio path(s)
  cssName: undefined,                       // (dtcgPath: string[]) => string
}
```

---

<a id="diagnostics"></a>
## 16. Diagnostics

| Code | Severity | Meaning |
|---|---|---|
| `TOKEN_UNUSED` | info | discovered token not referenced by any imported component (only counted) |
| `TOKEN_FALLBACK_USED` | info | `var(--x, fb)` resolved to the fallback; literal emitted |
| `TOKEN_EXPRESSION_UNBOUND` | info | value from `calc()`/`color-mix()`/multi-var expression; no binding |
| `TOKEN_CLAMPED_UNBOUND` | info | radius or size clamped by layout; the bound value would differ from the render |
| `TOKEN_PROVENANCE_MISMATCH` | warn | the cascade says `var(--x)`, but the computed value ≠ the token value (opacity/filter/redeclaration) |
| `TOKEN_PRIVATE_CHAIN` | info | the chain resolves only through component-private vars |
| `TOKEN_ALIAS_CYCLE` | warn | cyclic alias broken |
| `TOKEN_TYPE_CONFLICT` | warn | the same token is used as incompatible types, or an alias type mismatch |
| `TOKEN_NAME_COLLISION` | warn | two CSS names transform to the same Figma name |
| `TOKEN_MODE_UNTOKENIZED_DIFF` | warn | a property changes across modes without a token, so modes can't express the theme |
| `TOKEN_MODE_LIMIT` | warn | the plan's mode limit was hit; the overflow policy was applied |
| `TOKEN_EFFECT_MODE_DIFF` | info | the shadow differs per mode but effect styles have no modes |
| `TOKEN_PADDING_BORDER_OFFSET` | info | padding is not bound because Scene padding includes the border width (D-16) |
| `TOKEN_RELATIVE_UNIT` | info | an `em`/`%` token is not bindable as a stable variable |
| `TOKEN_LIBRARY_VALUE_DRIFT` | warn | a matched library variable's value differs from code |
| `TOKEN_VALUE_MATCHED` | info | a binding was made by value equality only (opt-in, `confidence: 'value'`) |
| `TOKEN_VALUE_AMBIGUOUS` | info | value-equality match has several candidates; not bound |
| `TOKEN_SOURCE_CSS_MISMATCH` | warn | the tokens file value ≠ the CSS computed value |
| `TOKEN_BIND_FAILED` | warn | the Plugin API refused a binding (field unsupported on the node type, scope mismatch) |
| `TOKEN_ORPHANED` | info | a linked variable no longer exists in code |

---

<a id="edge"></a>
## 17. Edge cases & failure modes

- **Padding + border (D-16).** D-16 folds the border width into padding, so `padding: var(--space-3)` with a 1px border yields Scene padding 13, which is not bindable. Mitigation, a switch to test in S-05 and S-12: when a node's padding is token-bound *and* it has a uniform border, prefer `strokesIncludedInLayout: true` + padding = CSS padding for that node. That is geometrically exact for INSIDE strokes when the border is uniform (verify, S-05). If verified, the mapper uses this per node and keeps the binding. Otherwise it reports `TOKEN_PADDING_BORDER_OFFSET`.
- **Hover-state tokens.** A forced `:hover` render is captured as its own variant. Provenance is recomputed for that state, because the matched rules differ, so `State=Hover` binds to `--color-bg-hover` naturally.
- **Shadow DOM / adopted sheets.** Discovery must include `adoptedStyleSheets` (Lit, Stencil). `:host { --x: … }` declarations are component-private unless the host is outside the captured component ([§3.1](#discovery)).
- **CSS-in-JS runtime injection.** Rules are inserted after first paint. Discovery runs *after* `storyRendered` + settle ([03 §5.5](03-storybook.md#settle-protocol)), and CDP `CSS.getStyleSheetText` sees `insertRule` content.
- **Tokens defined only via JS** (`element.style.setProperty('--x', …)` on root by a provider). These are inline custom properties on root or wrapper, captured as scope `decorator`.
- **`@media`-conditioned tokens** (responsive tokens that differ by viewport). Capture at the configured viewport only. If token values differ between the viewport variants of a component, emit `TOKEN_MODE_UNTOKENIZED_DIFF` with `reason: 'viewport'`. Viewport modes are a possible later feature.
- **Binding rejected.** Example: scope mismatch on a library variable, where a variable scoped to `TEXT_FILL` can't be bound to a frame fill. Catch, keep the literal, and emit `TOKEN_BIND_FAILED`.
- **Mode values for unloaded fonts.** Binding `fontFamily` to a variable whose Dark value is a font missing in Figma breaks text editing in that mode. Preflight loads fonts for all mode values. Missing ones go through font mapping ([09](09-plugin.md#preflight)).
- **Large token sets** (5,000+). This is the per-collection variable cap (research brief §7). Fall back to `groups` splitting automatically and emit `TOKEN_MODE_LIMIT` with `reason: 'variable-cap'`.

---

## 18. Open questions / spikes

All are tracked in [14](14-roadmap.md#phase-0) under **S-12**.

1. The mode limit per plan at write time (§7.4), and the error shape on `addMode` overflow.
2. Gradient stops bound via `ColorStop.boundVariables` render with the variable's value in every mode (render check only; the construction is known, §8).
3. `setRangeBoundVariable` support for `fontWeight` and `fontStyle`, and their scopes.
4. Text style fields bindable to variables, and how they interact with range overrides.
5. The per-node cost of `CSS.getMatchedStylesForNode` on large components (bounds §4.5).
6. Library variable import cost: is `importVariableByKeyAsync` cheap enough to probe hundreds of candidates?
7. `strokesIncludedInLayout:true` exactness with INSIDE strokes, which decides the §17 padding-binding rule (shared with S-05).
