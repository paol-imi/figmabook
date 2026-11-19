# 16 · Configuration (holotype.config.ts)

> **Governing decisions:** D-51 (one schema owner), D-50 (shared `dcr` config), D-12 (variant source priority), D-18 (tokens), D-19 (identity), D-23 (telemetry), D-57 (default DCR scope).

This chapter owns the schema (D-51). Semantics stay in the owning chapter named in each row. The schema is `HolotypeConfig`, a TypeBox schema in `@holotype/ir` (`ir/config.ts`), emitted as `/schema/config/v1.json`. Other chapters link here and never restate a schema or a default. If a chapter and this file disagree on a key name, type or default, this file wins and the chapter must be fixed.

---

## 1. Loading and precedence <a id="loading"></a>

- **Loading** follows [02 §8](02-architecture.md): `c12` finds `holotype.config.{ts,mts,js,mjs,json}`, `.holotyperc` or the `holotype` key in `package.json`; TypeScript runs through `jiti`. `defineConfig()` comes from `@holotype/cli/config` and is typed by `HolotypeConfig`.
- **Precedence** is README §7 (built-in defaults → `defaults` → project, meta and story `parameters.holotype` → `components[<sid>]` → CLI flags). The project namespaces (`capture`, `mapper`, `layout`, `tokens`, `figma`, `sync`, `dcr`, `verify`, …) have only three levels: built-in defaults → this file → CLI flags.
- **Merge:** objects deep-merge, arrays replace, `null` unsets a key.
- **`components`** accepts a `sid` or a glob on the `sid` or title. Entries apply in file order; later entries win.
- **Secrets are never in the file.** Values come only from env (`HOLOTYPE_SB_TOKEN`, `HOLOTYPE_SB_HEADERS`, `HOLOTYPE_SB_BASIC`, `HOLOTYPE_REGISTRY_TOKEN`) or `.holotype/auth/*` ([13 §3](13-security-legal.md#secrets)). The file may name an env variable (`storybook.auth.headersFromEnv`), never hold its value. A token- or password-like literal stops the run with `SEC_SECRET_IN_CONFIG`.
- **JSON configs.** RegExp-valued keys are written as `"/pattern/flags"` strings. Function-valued keys (`tokens.rename`, `tokens.cssName`) exist only in `.ts`/`.js` configs.
- Only `storybook.source` is required. Every other key is optional and has the default listed in [§3](#reference).

## 2. Top-level schema <a id="schema"></a>

```ts
import { Type as T, Static } from '@sinclair/typebox';
import { HolotypeParams } from './params';            // 04 §9

const Strict = { additionalProperties: false } as const;
export const Enum = (...v: string[]) => T.Union(v.map(s => T.Literal(s)));
export const Pattern = T.Union([T.String(), T.RegExp(/.*/)]);

// components[sid] = HolotypeParams plus the one project-only key (10 §9.2)
export const ComponentConfig = T.Composite([HolotypeParams,
  T.Object({ conflicts: T.Optional(Enum('keep', 'overwrite', 'fork')) })], Strict);

export const HolotypeConfig = T.Object({
  storybook:  StorybookConfig,                                  // §4, required
  include:    T.Optional(T.Array(T.String())),                  // §5
  exclude:    T.Optional(T.Array(T.String())),                  // §5
  defaults:   T.Optional(HolotypeParams),                       // §6
  components: T.Optional(T.Record(T.String(), ComponentConfig)),// §6
  capture:    T.Optional(CaptureConfig),                        // §7
  mapper:     T.Optional(MapperConfig),                         // §8
  layout:     T.Optional(LayoutConfig),                         // §9
  naming:     T.Optional(NamingConfig),                         // §10
  tokens:     T.Optional(TokensConfig),                         // §11
  fonts:      T.Optional(FontsConfig),                          // §12
  figma:      T.Optional(FigmaConfig),                          // §13
  sync:       T.Optional(SyncConfig),                           // §14
  dcr:        T.Optional(DcrConfig),                            // §15
  verify:     T.Optional(VerifyConfig),                         // §16
  output:     T.Optional(OutputConfig),                         // §17.1
  cache:      T.Optional(CacheConfig),                          // §17.2
  telemetry:  T.Optional(T.Boolean()),                          // §17.3
  redaction:  T.Optional(RedactionConfig),                      // §17.4
  compat:     T.Optional(CompatConfig),                         // §17.5
}, Strict);
export type HolotypeConfig = Static<typeof HolotypeConfig>;
```

Every nested `T.Object` in this chapter is declared with `Strict` (`additionalProperties: false`). The snippets below omit `T.Optional` and `Strict` for brevity: every key is optional unless marked *required*.

## 3. Reference <a id="reference"></a>

This is the single list of keys. Chapters reference it; the per-namespace sections below give the sub-schemas.

| Key | Type | Default | Semantics in |
|---|---|---|---|
| `storybook.source` | `string` (URL or static dir), *required* | — | [03 §2.1](03-storybook.md) |
| `storybook.dev.url` | `string` | `source` if it is a URL, else `'http://localhost:6006'` | [03 §9.2](03-storybook.md#dev-server) |
| `storybook.dev.command` | `string` | none | [03 §9.2](03-storybook.md#dev-server) |
| `storybook.dev.autoStart` | `boolean` | `true` | [03 §9.2](03-storybook.md#dev-server) |
| `storybook.auth.storageState` | `string` (path) | `'.holotype/auth/storageState.json'` | [03 §9.4](03-storybook.md), [13 §3](13-security-legal.md#secrets) |
| `storybook.auth.headersFromEnv` | `Record<header, envVarName>` | `{}` | [13 §3](13-security-legal.md#secrets) |
| `storybook.refs` | `string[]` | `[]` | [03](03-storybook.md) |
| `storybook.requireTag` | `boolean` | `false` | [03 §2.2](03-storybook.md) |
| `include` | `string[]` (globs on title path / `sid`) | `['**']` | [03 §2.2](03-storybook.md) |
| `exclude` | `string[]` (globs) | `[]` | [03 §2.2](03-storybook.md). Not the same as `defaults.exclude` (CSS selectors removed from capture, 04) |
| `defaults` | `HolotypeParams` | built-in defaults (rows below) | [04 §9](04-variant-model.md#schema) |
| `components` | `Record<sid \| glob, HolotypeParams & { conflicts? }>` | `{}` | [04 §9](04-variant-model.md#schema) |
| `defaults.strategy` | `'auto' \| 'stories' \| 'args' \| 'curated'` | `'auto'` | [04](04-variant-model.md) (D-12) |
| `defaults.args.<name>.as / name / values / labels / order / target` | see 04 | classification by render-and-diff (D-13) | [04 §4](04-variant-model.md#classification) |
| `defaults.fixed` | `Record<arg, value>` | `{}` | [04](04-variant-model.md) |
| `defaults.variants` | curated combos | none | [04](04-variant-model.md) |
| `defaults.excludeCombos` | `Array<Record<axis, label>>` | `[]` | [04](04-variant-model.md) |
| `defaults.states` | `false \| { include, foldBooleans, labels, mode, target, includePortals }` | `include: ['default','hover','focus-visible','active']` for interactive roots; `foldBooleans: ['disabled','loading','invalid']`; `mode: 'force'` | [04 §6](04-variant-model.md#states) (D-14, D-30) |
| `defaults.modes` | `{ globals, values, as, capture }` | follows `tokens.modes` | [04 §7](04-variant-model.md#themes) |
| `defaults.viewports` | `{ sizes: Record<name, width \| {width,height}>, as }` | `{ sizes: {} }`; `as: 'axis'` | [04 §7](04-variant-model.md#themes). Named breakpoints live here (no top-level `viewports`) |
| `defaults.viewport` | `{ width, height? }` | `{ width: 1280, height: 800 }` | [04](04-variant-model.md) (D-24) |
| `defaults.rootSelector` / `unwrap` / `portal` | `string` / `boolean \| number` / `boolean \| 'auto' \| string \| {…}` | `'#storybook-root'` / `true` / `'auto'` | [03 §6](03-storybook.md#root), [04](04-variant-model.md) |
| `defaults.exclude` | `string[]` (CSS selectors) | `[]` | [04](04-variant-model.md) |
| `defaults.grid` | `{ columns?: string[], rows?: string[] }` | first axis on columns, the rest on rows | [04](04-variant-model.md). Not `layout` (§9) |
| `defaults.budget` | `{ max, warn, hardLimit, maxProbes }` | `{ max: 256, warn: 128, hardLimit: 1024, maxProbes: 120 }` | [04 §5.2](04-variant-model.md#budgets) (D-28) |
| `defaults.stories` | `{ fillMatrix, maxStoryAxisValues }` | `maxStoryAxisValues: 8` | [04](04-variant-model.md) |
| `defaults.keepLayout` | `boolean` | `false` | [05](05-capture.md) (D-24) |
| `defaults.textMode` | `'reflow' \| 'locked-lines'` | `layout.textWrap` | [07](07-mapping.md) (D-17) |
| `defaults.implements` | `string[]` (DCR item ids) | none | [15 §8](15-change-requests.md#agent-contract) (D-37) |
| `defaults.replacedBy` | `string` (`sid`) | none | [15 §4.13](15-change-requests.md#instance-versions) |
| `defaults.channelCapture` | see 04 | see 04 | [04](04-variant-model.md) |
| `defaults.split` | `boolean` | `false` (icon splits are automatic, `PLAN_ICON_SPLIT`) | [04](04-variant-model.md) |
| `components[sid].conflicts` | `'keep' \| 'overwrite' \| 'fork'` | `sync.conflicts` | [10](10-sync.md) |
| `capture.dpr` | `1 \| 2 \| 3` | `2` | [05](05-capture.md) (D-24) |
| `capture.locale` | `string` (BCP 47) | `'en-US'` | [05](05-capture.md) |
| `capture.timezone` | `string` (IANA) | `'UTC'` | [05](05-capture.md) |
| `capture.clock` | `string` (ISO date) `\| false` | `'2026-01-01T00:00:00Z'` | [05](05-capture.md) (D-24) |
| `capture.animations` | `'finish' \| 'pause-only'` | `'finish'` | [05](05-capture.md) (D-24) |
| `capture.determinism.random` | `boolean` | `true` | [05 §1](05-capture.md#orchestration) |
| `capture.svg.rasterizeFilters` | `boolean` | `true` | [05 §5](05-capture.md), [07 §10.7](07-mapping.md#icons) |
| `capture.rasterize` | `string[]` (selectors) | `[]` | [07](07-mapping.md) |
| `capture.workers` | `number \| 'auto'` | `'auto'` | [05 §1](05-capture.md#orchestration) |
| `capture.devSourcemap` | `'force' \| 'keep'` | `'force'` | [05](05-capture.md), [15 §5](15-change-requests.md) (D-36) |
| `mapper.keepInvisible` | `boolean` | `true` | [07](07-mapping.md) |
| `mapper.borderModel` | `'padding-plus-border' \| 'native'` | `'padding-plus-border'` | [07 §4.1](07-mapping.md#border-padding) (D-16) |
| `mapper.allowSpacers` | `boolean` | `false` | [07](07-mapping.md) |
| `mapper.exactBorders` | `boolean` | `false` | [07 §10.3](07-mapping.md#radius) |
| `mapper.exactRadii` | `boolean` | `false` | [07 §10.3](07-mapping.md#radius) |
| `mapper.preferFrames` | `boolean` | `false` | [07](07-mapping.md) |
| `mapper.alignment.maxPlaceholdersRatio` | `number` (0–1) | `0.5` | [07 §13](07-mapping.md#alignment) |
| `mapper.colorProfile` | `'auto' \| 'srgb' \| 'display-p3'` | `'auto'` | [07 §9](07-mapping.md#color) |
| `mapper.nativeControls` | `'synthesize' \| 'raster'` | `'synthesize'` | [05 §5.3](05-capture.md) |
| `layout.autoLayout` | `'verified' \| 'off'` | `'verified'` | [07 §6](07-mapping.md#verification) (D-15) |
| `layout.tolerancePx` | `number` | `0.6` | [07 §6](07-mapping.md#verification) (D-15) |
| `layout.margins` | `'normalize'` | `'normalize'` | [07](07-mapping.md) |
| `layout.textWrap` | `'reflow' \| 'locked-lines'` | `'reflow'` | [07](07-mapping.md) (D-17) |
| `layout.probing` | `{ enabled, widths }` | `{ enabled: false, widths: [0.75, 1, 1.25] }` | [05 §11](05-capture.md#probing) |
| `naming.layers` | `string[]` (ordered sources) | `['data-holotype-name','data-figma-name','data-testid','component','aria','semantic','class']` | [07 §12](07-mapping.md) |
| `naming.stripClassPatterns` | `Pattern[]` | `[/^css-[a-z0-9]+$/, /^sc-/, /^[a-z]+:[\w-]+$/]` | [07 §12](07-mapping.md) |
| `naming.iconSlug` | `'role' \| 'boundary'` | `'role'` | [07](07-mapping.md) |
| `tokens.enabled` | `boolean` | `true` | [08](08-tokens.md) |
| `tokens.include` | `'referenced' \| 'all'` | `'referenced'` | [08](08-tokens.md#discovery) |
| `tokens.includePatterns` | `string[]` (globs on CSS names) | none | [08](08-tokens.md#discovery) |
| `tokens.ignore` | `Pattern[]` | `[/^--tw-/, /^--radix-/]` (merged) | [08](08-tokens.md#discovery) |
| `tokens.stripPrefix` | `string` | none | [08](08-tokens.md) |
| `tokens.naming` | `'dash-groups' \| 'flat' \| 'all-dashes'` | `'dash-groups'` | [08](08-tokens.md) |
| `tokens.rename` | `(css: string) => string` | none | [08](08-tokens.md) |
| `tokens.collections` | `'tiered' \| 'single' \| { groups }` | `'tiered'` | [08](08-tokens.md#collections) |
| `tokens.collectionName` | `string` | `'Tokens'` | [08](08-tokens.md#collections) |
| `tokens.modes` | `Array<{ name, globals }>` | auto-detected theme globals | [08 §7](08-tokens.md#modes) |
| `tokens.modeOverflow` | `'variant-axis' \| 'extend' \| 'split' \| 'first-only'` | `'variant-axis'` | [08](08-tokens.md#mode-limits) |
| `tokens.themeFallback` | `'variant-axis' \| 'report'` | `'variant-axis'` | [08 §7](08-tokens.md#modes), [04 §7.1](04-variant-model.md#themes) |
| `tokens.modeProbeVariants` | `'default-variant' \| 'all' \| number` | `'default-variant'` | [08](08-tokens.md#modes) |
| `tokens.bindByValue` | `boolean` | `false` | [08](08-tokens.md#value-match) (D-18) |
| `tokens.matchByValue` | `boolean` | `false` | [08](08-tokens.md#matching) (D-18) |
| `tokens.libraryProbeLimit` | `number` | `500` | [08](08-tokens.md#matching) |
| `tokens.textStyles` | `false \| 'tokens' \| 'classes' \| 'dedupe'` | `false` | [08](08-tokens.md#text-styles) |
| `tokens.effectStyles` | `boolean` | `true` | [08](08-tokens.md#effect-styles) |
| `tokens.paintStyles` | `boolean` | `false` | [08](08-tokens.md#styles) |
| `tokens.hidePrimitives` | `boolean` | `false` | [08](08-tokens.md#collections) |
| `tokens.scopes` | `'infer' \| 'all'` | `'infer'` | [08](08-tokens.md) |
| `tokens.lineHeight` | `'px-per-usage'` | `'px-per-usage'` | [08](08-tokens.md#units) |
| `tokens.motion` | `boolean` | `false` | [08](08-tokens.md) |
| `tokens.source` | `string \| string[]` (DTCG / Style Dictionary / Tokens Studio paths) | none | [08](08-tokens.md#external) |
| `tokens.cssName` | `(dtcgPath: string[]) => string` | none | [08](08-tokens.md#external) |
| `fonts.map` | `Record<face, string \| { family, style? }>` | `{}` | [09 §5.1](09-plugin.md#fonts) |
| `fonts.fallback` | `string` | `'Inter'` | [09 §5.1](09-plugin.md#fonts) |
| `figma.page` | `string` | `'Components'` | [09](09-plugin.md#pages) (D-22) |
| `figma.sections` | `'by-root-title' \| 'none'` | `'by-root-title'` | [09](09-plugin.md#pages) |
| `figma.docFrames` | `boolean` | `true` | [09](09-plugin.md#doc-frame) |
| `figma.docSections` | `string[]` | `['description','properties','diagnostics']` | [09](09-plugin.md#doc-frame) |
| `figma.iconsPage` | `string` | `'Icons'` | [09](09-plugin.md#icons) |
| `figma.deprecatedPage` | `string` | `'Deprecated'` | [10](10-sync.md#deprecation) (D-20) |
| `figma.prototypeStates` | `boolean` | `false` | [09](09-plugin.md) |
| `figma.grid` | `{ maxColumns, gap, padding }` | `{ maxColumns: 8, gap: 24, padding: 32 }` | [07](07-mapping.md), [09](09-plugin.md#grid) |
| `figma.files` | `Array<{ name, include: string[] }>` | none (one file) | [10 §13](10-sync.md) |
| `sync.conflicts` | `'keep' \| 'overwrite' \| 'fork'` | `'keep'` everywhere (D-29); the plugin's conflict screen pre-selects it and the user can change it per node | [10 §9](10-sync.md) (D-29) |
| `sync.orphans` | `'remove' \| 'hide'` | `'remove'` | [10](10-sync.md#reconcile) |
| `sync.pruneAfterDays` | `number` | `30` (manual prune only) | [10](10-sync.md#deprecation) (D-20) |
| `sync.undo` | `'per-component' \| 'single'` | `'per-component'` | [09](09-plugin.md) |
| `dcr.scope` | `'changed' \| 'ready' \| 'page:<name>' \| 'all'` | `'changed'` | [15](15-change-requests.md#scope) (D-57) |
| `dcr.requireApproval` | `boolean` | `false` | [15 §7.4](15-change-requests.md#review) (D-44) |
| `dcr.targets` | `{ components: { package? }, screens?: { repo, path } }` | components in this repo; no `screens` | [15 §5.5](15-change-requests.md) (D-43) |
| `dcr.screens` | `{ separator, groupBySection, breakpoints, states, base, expectStates }` | see [§15](#dcr) | [15 §4.10](15-change-requests.md) (D-41) |
| `dcr.content` | `{ placeholders: Pattern[], i18n: 'auto' \| 'none' \| 'keys' }` | `{ placeholders: [], i18n: 'auto' }` | [15 §4.12](15-change-requests.md#content) |
| `dcr.a11y.categories` | `string[]` | `['Accessibility', 'A11y']` | [15 §4.12](15-change-requests.md#content) |
| `dcr.deprecations` | `Record<sid, sid>` | `{}` | [15 §4.13](15-change-requests.md#instance-versions) |
| `verify.visual` | `'advisory' \| 'gate'` | `'advisory'` | [15 §9](15-change-requests.md#verify) (D-55) |
| `verify.tolerance` | `{ px, color }` | `{ px: 0.5, color: 1e-3 }` | [15 §9](15-change-requests.md#verify) |
| `verify.screens` | `boolean` | `false` | [15 §9](15-change-requests.md#verify) |
| `verify.regressions` | `boolean` | `true` | [15 §9](15-change-requests.md#verify) (D-55) |
| `output.dir` | `string` | `'.holotype/out'` | [11](11-ux.md) |
| `output.report` | `Array<'json' \| 'html'>` | `['json', 'html']` | [11](11-ux.md), [12](12-quality.md) |
| `cache.dir` | `string` | `'.holotype/cache'` | [02](02-architecture.md), [05 §10](05-capture.md#determinism) |
| `telemetry` | `boolean` | `false` | [13](13-security-legal.md) (D-23) |
| `redaction.inputs` | `'password' \| 'all'` | `'password'` | [13 §3](13-security-legal.md#secrets) |
| `redaction.text` | `'off' \| 'mask'` | `'off'` | [13 §3](13-security-legal.md#secrets) |
| `compat.s2d` | `boolean` | `true` | [04 §10](04-variant-model.md#compatibility-readers) |

---

## 4. `storybook` <a id="storybook"></a>

```ts
const StorybookConfig = T.Object({
  source: T.String(),                                  // required: URL or static build dir
  dev: T.Object({
    url: T.String(),                                   // default: source if it is a URL, else 'http://localhost:6006'
    command: T.String(),                               // e.g. 'storybook dev -p 6006 --no-open'
    autoStart: T.Boolean(),                            // default true
  }),
  auth: T.Object({
    storageState: T.String(),                          // default '.holotype/auth/storageState.json'
    headersFromEnv: T.Record(T.String(), T.String()),  // header name → env var name; never a value
  }),
  refs: T.Array(T.String()),                           // composed refs to include; default []
  requireTag: T.Boolean(),                             // only stories tagged 'figma'; default false
});
```

- Capture (`holotype capture`, `export`, `serve` for a library) reads `source`. Branch mode (`holotype branch start|refresh`) and `holotype verify` read `dev`, because provenance needs the Vite dev server (D-36).
- When `dev.url` is unreachable and `dev.command` is set and `autoStart` is true, `serve`, `branch start` and `verify` start the command, wait for `index.json`, and prefix its logs with `[storybook]`. They stop it on exit. Without `command`, an unreachable URL stops the run with `SB_INDEX_UNREACHABLE`.
- Basic auth and bearer tokens come only from `HOLOTYPE_SB_BASIC` and `HOLOTYPE_SB_TOKEN` ([13 §3](13-security-legal.md#secrets)).

## 5. `include` and `exclude` <a id="include"></a>

```ts
include: T.Array(T.String()),   // default ['**']
exclude: T.Array(T.String()),   // default []
```

Globs match the story `title` path and the story id ([03 §2.2](03-storybook.md)). `exclude` wins over `include`; the `!figma` tag wins over both (README §7). These are story filters, unlike `defaults.exclude`, which lists CSS selectors removed from capture.

## 6. `defaults` and `components` <a id="defaults"></a><a id="components"></a>

`defaults` is one `HolotypeParams` object. `components` maps a `sid` or a glob to `HolotypeParams` plus `conflicts`. The `HolotypeParams` TypeBox block is defined once, in [04 §9](04-variant-model.md#schema); it is not copied here. The reference table ([§3](#reference)) lists the keys used most and their built-in defaults.

- The same schema validates `parameters.holotype` at project, meta and story level. Unknown keys there produce `PLAN_PARAM_UNKNOWN_KEY` (04).
- `components[sid].conflicts` is the only key that is valid in config but not in `parameters.holotype`: sync policy belongs to the library file, not to the story ([10 §9](10-sync.md)).
- `capture.dpr` is project-wide; there is no per-component DPR.

## 7. `capture` <a id="capture"></a>

```ts
const CaptureConfig = T.Object({
  dpr: T.Union([T.Literal(1), T.Literal(2), T.Literal(3)]),      // default 2
  locale: T.String(),                                             // default 'en-US'
  timezone: T.String(),                                           // default 'UTC'
  clock: T.Union([T.String(), T.Literal(false)]),                 // default '2026-01-01T00:00:00Z'
  animations: Enum('finish', 'pause-only'),                       // default 'finish'
  determinism: T.Object({ random: T.Boolean() }),                 // default { random: true }
  svg: T.Object({ rasterizeFilters: T.Boolean() }),               // default { rasterizeFilters: true }
  rasterize: T.Array(T.String()),                                 // selectors; default []
  workers: T.Union([T.Integer({ minimum: 1 }), T.Literal('auto')]),// default 'auto'
  devSourcemap: Enum('force', 'keep'),                            // default 'force'
});
```

- `clock` freezes `Date` with `page.clock.setFixedTime`; timers and `requestAnimationFrame` stay real. `false` leaves the real clock.
- `animations: 'finish'` finishes finite Web Animations after the Storybook test-runner user agent has paused CSS animations and transitions; `'pause-only'` skips that step (D-24).
- `determinism.random: false` keeps the page's own `Math.random`.
- `workers: 'auto'` is `min(8, max(1, availableParallelism − 1))` locally and `min(4, cpus)` in CI; `--concurrency` overrides it ([05 §1](05-capture.md#orchestration)).
- `devSourcemap: 'force'` makes branch mode inject `css.devSourcemap: true` through `viteFinal`; `'keep'` uses the project's Vite setting and may produce `DCR_PROVENANCE_NO_SOURCEMAP`.
- Every `capture` key except `workers` is part of the capture cache key ([02](02-architecture.md#capture-key)).

## 8. `mapper` <a id="mapper"></a>

```ts
const MapperConfig = T.Object({
  keepInvisible: T.Boolean(),                                     // default true
  borderModel: Enum('padding-plus-border', 'native'),             // default 'padding-plus-border' (D-16)
  allowSpacers: T.Boolean(),                                      // default false
  exactBorders: T.Boolean(),                                      // default false
  exactRadii: T.Boolean(),                                        // default false
  preferFrames: T.Boolean(),                                      // default false
  alignment: T.Object({ maxPlaceholdersRatio: T.Number({ minimum: 0, maximum: 1 }) }), // default 0.5
  colorProfile: Enum('auto', 'srgb', 'display-p3'),               // default 'auto'
  nativeControls: Enum('synthesize', 'raster'),                   // default 'synthesize': native form controls rebuilt as frames
});
```

`colorProfile: 'auto'` follows the target file's profile; LEGACY documents are treated as sRGB. Diagnostics remedies in [12](12-quality.md#diagnostics) use the namespaced names (`mapper.exactBorders: true`).

## 9. `layout` <a id="layout"></a>

```ts
const LayoutConfig = T.Object({
  autoLayout: Enum('verified', 'off'),                            // default 'verified' (D-15)
  tolerancePx: T.Number({ minimum: 0 }),                          // default 0.6 (TOL_SIM)
  margins: Enum('normalize'),                                     // default 'normalize'
  textWrap: Enum('reflow', 'locked-lines'),                       // default 'reflow' (D-17)
  probing: T.Object({ enabled: T.Boolean(), widths: T.Array(T.Number()) }), // default { enabled: false, widths: [0.75, 1, 1.25] }
});
```

`layout` is the auto-layout policy only. `defaults.textMode` (04) overrides `textWrap` per component. The per-component variant-grid placement is `defaults.grid` (04), and the set grid spacing is `figma.grid` (§13).

## 10. `naming` <a id="naming"></a>

```ts
const NamingConfig = T.Object({
  layers: T.Array(T.String()),        // default ['data-holotype-name','data-figma-name','data-testid','component','aria','semantic','class']
  stripClassPatterns: T.Array(Pattern),// default [/^css-[a-z0-9]+$/, /^sc-/, /^[a-z]+:[\w-]+$/]
  iconSlug: Enum('role', 'boundary'), // default 'role'
});
```

`data-holotype-name` and `data-holotype-key` are the primary attributes; `data-figma-name` and `data-figma-key` are accepted aliases.

## 11. `tokens` <a id="tokens"></a>

```ts
const TokensConfig = T.Object({
  enabled: T.Boolean(),                                           // default true
  include: Enum('referenced', 'all'),                             // default 'referenced'
  includePatterns: T.Array(T.String()),                           // globs on CSS names, e.g. ['--color-*']
  ignore: T.Array(Pattern),                                       // merged with [/^--tw-/, /^--radix-/]
  stripPrefix: T.String(),
  naming: Enum('dash-groups', 'flat', 'all-dashes'),              // default 'dash-groups'
  rename: T.Function([T.String()], T.String()),
  collections: T.Union([Enum('tiered', 'single'), T.Object({ groups: T.Array(T.Unknown()) })]), // default 'tiered'
  collectionName: T.String(),                                     // default 'Tokens'
  modes: T.Array(T.Object({ name: T.String(), globals: T.Record(T.String(), T.Unknown()) })),
  modeOverflow: Enum('variant-axis', 'extend', 'split', 'first-only'), // default 'variant-axis'
  themeFallback: Enum('variant-axis', 'report'),                  // default 'variant-axis'
  modeProbeVariants: T.Union([Enum('default-variant', 'all'), T.Integer({ minimum: 1 })]), // default 'default-variant'
  bindByValue: T.Boolean(),                                       // default false (D-18)
  matchByValue: T.Boolean(),                                      // default false (D-18)
  libraryProbeLimit: T.Integer({ minimum: 0 }),                   // default 500
  textStyles: T.Union([T.Literal(false), Enum('tokens', 'classes', 'dedupe')]), // default false
  effectStyles: T.Boolean(),                                      // default true
  paintStyles: T.Boolean(),                                       // default false
  hidePrimitives: T.Boolean(),                                    // default false
  scopes: Enum('infer', 'all'),                                   // default 'infer'
  lineHeight: Enum('px-per-usage'),                               // default 'px-per-usage'
  motion: T.Boolean(),                                            // default false
  source: T.Union([T.String(), T.Array(T.String())]),             // DTCG / Style Dictionary / Tokens Studio
  cssName: T.Function([T.Array(T.String())], T.String()),
});
```

- **Themes → modes** are configured only here (`tokens.modes`); there is no top-level `themes`. `defaults.modes` / `components[sid].modes` (04) override it per component.
- **`modeOverflow`** applies when the plan's mode limit is hit (`TOKEN_MODE_LIMIT`). `'variant-axis'` turns the overflowing dimension into a variant axis. `'extend'` uses Enterprise extended collections and is preferred for a brand dimension. `'split'` duplicates collections; their modes do not compose, so bindings cannot switch between them. `'first-only'` keeps the first modes and reports the rest.
- **`themeFallback`**: a theme that tokens cannot explain becomes a `Theme` variant axis (`PLAN_THEME_AS_AXIS`), matching 04 §7.1 and 07; `'report'` only reports.
- Library matching (`codeSyntax.WEB`, then name) is always attempted (D-18); there is no switch.
- **Loop slice (L2)** honours only `enabled`, `include`, `includePatterns`, `ignore`, `naming` and `collectionName`: one collection, default mode, exact `var()` bindings (D-46). The other keys validate but have no effect until hardening.

## 12. `fonts` <a id="fonts"></a>

```ts
const FontsConfig = T.Object({
  map: T.Record(T.String(), T.Union([T.String(), T.Object({ family: T.String(), style: T.Optional(T.String()) })])), // default {}
  fallback: T.String(),                                           // default 'Inter'
});
```

Keys are browser-used faces (`'Acme Sans'`). Mappings chosen in the plugin preflight persist per document and can be copied here ([09 §5.1](09-plugin.md#fonts)).

## 13. `figma` <a id="figma"></a>

```ts
const FigmaConfig = T.Object({
  page: T.String(),                                               // default 'Components'
  sections: Enum('by-root-title', 'none'),                        // default 'by-root-title'
  docFrames: T.Boolean(),                                         // default true
  docSections: T.Array(Enum('description', 'properties', 'diagnostics')), // default all three
  iconsPage: T.String(),                                          // default 'Icons'
  deprecatedPage: T.String(),                                     // default 'Deprecated'
  prototypeStates: T.Boolean(),                                   // default false
  grid: T.Object({ maxColumns: T.Integer({ minimum: 1 }), gap: T.Number(), padding: T.Number() }), // default { maxColumns: 8, gap: 24, padding: 32 }
  files: T.Array(T.Object({ name: T.String(), include: T.Array(T.String()) })), // default: one managing file
});
```

`figma.grid` is read by the mapper when it emits `SceneSetLayout`; the plugin only converts it to x/y. `figma.files` scopes bundles per managing file ([10 §13](10-sync.md)).

## 14. `sync` <a id="sync"></a>

```ts
const SyncConfig = T.Object({
  conflicts: Enum('keep', 'overwrite', 'fork'),            // default 'keep' (D-29); per-node choice in the plugin
  orphans: Enum('remove', 'hide'),                                // default 'remove'
  pruneAfterDays: T.Integer({ minimum: 0 }),                      // default 30; used only by manual prune
  undo: Enum('per-component', 'single'),                          // default 'per-component'
});
```

- `orphans` decides what happens to a managed **layer** that no longer exists in code ([10](10-sync.md#reconcile)). A removed **story** is always deprecated (D-20); that is not configurable.
- There is no `identityStorage`: identity is always in shared plugin data (D-19).
- **Loop slice (Phase 4a)** uses `keep` without a conflicts UI; the other policies arrive with Phase 4b (D-46).

## 15. `dcr` <a id="dcr"></a>

```ts
const DcrConfig = T.Object({
  scope: T.Union([Enum('changed', 'ready', 'all'), T.TemplateLiteral('page:${string}')]), // default 'changed' (D-57)
  requireApproval: T.Boolean(),                                   // default false
  targets: T.Object({
    components: T.Object({ package: T.String() }),                // default: the components' nearest package.json name
    screens: T.Object({ repo: T.String(), path: T.String() }),    // default: absent (screens live in this repo)
  }),
  screens: T.Object({
    separator: T.String(),                                        // default ' / '
    groupBySection: T.Boolean(),                                  // default true
    breakpoints: T.Record(T.String(), T.Number()),                // default { Mobile: 0, Tablet: 768, Desktop: 1280 }
    states: T.Record(T.String(), T.Array(T.String())),            // default below
    base: Enum('widest', 'narrowest'),                            // default 'widest'
    expectStates: T.Array(T.String()),                            // default []
  }),
  content: T.Object({
    placeholders: T.Array(Pattern),                               // added to the built-in rules; default []
    i18n: Enum('auto', 'none', 'keys'),                           // default 'auto'
  }),
  a11y: T.Object({ categories: T.Array(T.String()) }),            // default ['Accessibility', 'A11y']
  deprecations: T.Record(T.String(), T.String()),                 // old sid → replacement sid; default {}
});
```

- Default `screens.states`: `{ default: ['Default', 'Filled'], empty: ['Empty'], loading: ['Loading', 'Skeleton'], error: ['Error'], success: ['Success'] }`; the key order is the render order.
- `scope` string form parses to `DcrScope` ([15](15-change-requests.md#scope)). `selection:<ids>` is plugin-only and recorded in `branch:meta.lastDcr.scope`, so `holotype dcr --pull` reproduces it.
- `content.i18n: 'auto'` detects an i18n library (for example `react-intl`) and tells the agent to use keys; `'keys'` forces that, `'none'` asks for literal text.
- **Shared with the plugin (D-50).** Every `dcr` key is resolved by the CLI, written to `BundleManifest.branch.dcrConfig` ([06](06-ir.md#branch-block)) and copied by the plugin to `branch:meta.dcrConfig`. Plugin and CLI hash the same resolved object into `extractor.configHash`. When the local config differs from `branch:meta.dcrConfig`, the CLI warns `DCR_CONFIG_DRIFT` ("This branch file uses older request settings. Run `holotype branch refresh`.").
- **Loop slice (L4):** `scope`, `targets` and `screens.separator`/`groupBySection` are honoured; `requireApproval`, `a11y`, `expectStates` and `deprecations` arrive with hardening H-E (D-46).

## 16. `verify` <a id="verify"></a>

```ts
const VerifyConfig = T.Object({
  visual: Enum('advisory', 'gate'),                               // default 'advisory' (D-55)
  tolerance: T.Object({ px: T.Number(), color: T.Number() }),     // default { px: 0.5, color: 1e-3 } (linear)
  screens: T.Boolean(),                                           // default false; same as --screens
  regressions: T.Boolean(),                                       // default true
});
```

- Verify decides in Scene space; visual similarity against the designer's export is advisory unless `visual: 'gate'` (D-55).
- `regressions: true` checks that non-target variants of each touched component keep their baseline values (`DCR_VERIFY_REGRESSED`, status `regressed`).
- Verify reads `storybook.dev` and starts it when `autoStart` allows (§4).

## 17. `output`, `cache`, `telemetry`, `redaction`, `compat` <a id="output"></a>

### 17.1 `output`

```ts
const OutputConfig = T.Object({
  dir: T.String(),                                                // default '.holotype/out'
  report: T.Array(Enum('json', 'html')),                          // default ['json', 'html']
});
```

### 17.2 `cache` <a id="cache"></a>

```ts
const CacheConfig = T.Object({ dir: T.String() });                // default '.holotype/cache'
```

### 17.3 `telemetry` <a id="telemetry"></a>

`telemetry: boolean`, default `false` (D-23). CI detection and `DO_NOT_TRACK=1` always force it off.

### 17.4 `redaction` <a id="redaction"></a>

```ts
const RedactionConfig = T.Object({
  inputs: Enum('password', 'all'),                                // default 'password'
  text: Enum('off', 'mask'),                                      // default 'off'
});
```

`inputs: 'all'` blanks every form value (`SEC_SECRET_REDACTED`); `text: 'mask'` replaces text with width-preserving glyphs ([13 §3](13-security-legal.md#secrets)).

### 17.5 `compat` <a id="compat"></a>

```ts
const CompatConfig = T.Object({ s2d: T.Boolean() });              // default true
```

`s2d` reads story.to.design parameters when `parameters.holotype` is absent ([04 §10](04-variant-model.md#compatibility-readers)).

---

## 18. Validation and diagnostics <a id="validation"></a>

The resolved config (after merge, before the run) is validated against `HolotypeConfig`.

| Case | Code | Severity | Behaviour |
|---|---|---|---|
| Unknown key at any level | `PLAN_CONFIG_UNKNOWN_KEY` | warn | the key is ignored; the message offers "did you mean `<key>`?" when a known key at the same level is within Levenshtein distance ≤2 |
| Removed or renamed key ([§19](#removed)) | `PLAN_CONFIG_UNKNOWN_KEY` | warn | the message names the replacement, e.g. "`defaults.variantSource` was renamed to `defaults.strategy`" |
| Wrong type or enum value | `PLAN_CONFIG_INVALID` | error | the run aborts before capture; exit code per [11 §3.2](11-ux.md#exit-codes) |
| Missing `storybook.source` | `PLAN_CONFIG_INVALID` | error | as above; the remedy suggests `holotype init` |
| Unknown `parameters.holotype` key | `PLAN_PARAM_UNKNOWN_KEY` | warn | see [04 §9](04-variant-model.md#schema) |
| Secret-like literal | `SEC_SECRET_IN_CONFIG` | error | the run stops ([13 §3](13-security-legal.md#secrets)) |
| Local `dcr` differs from the branch file | `DCR_CONFIG_DRIFT` | warn | see [§15](#dcr) |

`holotype doctor` prints the resolved config with the source of each value (default, file, flag).

## 19. Removed and renamed keys <a id="removed"></a>

Spellings used in earlier chapter drafts, and their replacements. Each old spelling produces `PLAN_CONFIG_UNKNOWN_KEY` with this hint.

| Old spelling | Replacement |
|---|---|
| `defaults.variantSource` | `defaults.strategy` |
| `budget.maxVariantsPerSet`, `budget.warnAt` | `budget.max`, `budget.warn` |
| `defaults.states: string[]` | `defaults.states.include` |
| `defaults.stateStrategy` | `defaults.states.mode` |
| `defaults.root { selector, unwrapDecorators, portals }` | `defaults.rootSelector`, `defaults.unwrap`, `defaults.portal` |
| `defaults.dpr` | `capture.dpr` |
| `defaults.properties.textArgs / booleanArgs / slots` | removed: classification is automatic (D-13); per arg use `args.<name>.as` |
| `components[sid].axes` | `args.<name>.as: 'variant'` plus `args.<name>.order` |
| `components[sid].properties` | `args.<name>.as` |
| `parameters.holotype.axes[arg].name / order` | `args[arg].name` / `args[arg].order` |
| `components[sid].exclude` (combinations) | `excludeCombos` (`exclude` stays the selector list) |
| `parameters.holotype.layout { columns, rows }` | `grid { columns, rows }` |
| `themes.global`, `themes.modes` | `tokens.modes` |
| `themes.fallbackToVariants` | `tokens.themeFallback` |
| top-level `viewports` | `defaults.viewports.sizes` |
| `tokens.include: string[]` (globs) | `tokens.includePatterns` |
| `tokens.collections: 'auto'` | `tokens.collections: 'tiered'` |
| `tokens.valueMatching` | `tokens.bindByValue` |
| `tokens.nameTransform` | `tokens.naming` |
| `tokens.matchLibrary` | removed: library matching is always attempted (D-18) |
| `pages.components` | `figma.page` |
| `docs.enabled`, `docs.sections` | `figma.docFrames`, `figma.docSections` |
| `layout.columns`, `layout.maxColumns` (set grid) | `defaults.grid.columns`, `figma.grid.maxColumns` |
| `config.keepInvisible`, `config.borderModel`, `config.allowSpacers`, `config.exactBorders`, `config.exactRadii`, `config.preferFrames`, `config.alignment.*`, `config.colorProfile` | `mapper.*` |
| `config.rasterize` | `capture.rasterize` |
| `determinism.random` | `capture.determinism.random` |
| `svg.rasterizeFilters` | `capture.svg.rasterizeFilters` |
| `config.naming.iconSlug` | `naming.iconSlug` (unchanged) |
| `config.requireTag` | `storybook.requireTag` |
| `storybook.auth.basic`, `storybook.auth.headers` (literal values) | env `HOLOTYPE_SB_BASIC`, `HOLOTYPE_SB_HEADERS`, or `storybook.auth.headersFromEnv` |
| `sync.identityStorage` | removed (D-19) |
| `undo` | `sync.undo` |
| `maxStoryAxisValues` | `stories.maxStoryAxisValues` |

## 20. Annotated example <a id="example"></a>

Every key is optional except `storybook.source`. Values shown are the defaults unless the comment says otherwise.

```ts
// holotype.config.ts
import { defineConfig } from '@holotype/cli/config';

export default defineConfig({
  storybook: {
    source: './storybook-static',                // library sync: static build (or a URL)
    dev: {                                       // branch mode and verify (D-36)
      url: 'http://localhost:6006',
      command: 'storybook dev -p 6006 --no-open',// started when the URL is unreachable
      autoStart: true,
    },
    auth: {
      storageState: '.holotype/auth/storageState.json', // written by `holotype login --storybook <url>`
      headersFromEnv: { 'CF-Access-Client-Id': 'CF_ID' }, // header → env var name, never a value
    },
    refs: [],
  },

  include: ['components/**', 'patterns/**'],     // example; default ['**']
  exclude: ['**/internal/**', '**/*--playground'],

  defaults: {                                    // HolotypeParams (04 §9)
    strategy: 'auto',                            // D-12
    budget: { max: 256, warn: 128, hardLimit: 1024, maxProbes: 120 }, // D-28
    states: { include: ['default', 'hover', 'focus-visible', 'active'], mode: 'force' }, // D-14
    viewport: { width: 1280, height: 800 },      // D-24
    viewports: { sizes: { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } } },
    rootSelector: '#storybook-root',
    unwrap: true,
    portal: 'auto',
  },

  components: {                                  // precedence level 6 (README §7)
    'components-button': {
      name: 'Button',
      args: {
        variant: { as: 'variant', order: 'options' },
        size: { as: 'variant' },
        label: { as: 'text' },
        iconLeading: { as: 'instance-swap' },
        loading: { as: 'variant' },
      },
      fixed: { children: 'Button' },
      excludeCombos: [{ Variant: 'link', Size: 'lg' }],
      grid: { columns: ['State'], rows: ['Variant', 'Size'] },
      conflicts: 'keep',                         // project-only key (10 §9.2)
    },
    'components-icon': { split: true },          // one component per value
  },

  capture: { dpr: 2, locale: 'en-US', timezone: 'UTC', clock: '2026-01-01T00:00:00Z', devSourcemap: 'force' },
  mapper: { borderModel: 'padding-plus-border', exactBorders: false, exactRadii: false },
  layout: { autoLayout: 'verified', tolerancePx: 0.6, textWrap: 'reflow' },

  naming: {
    layers: ['data-holotype-name', 'data-figma-name', 'data-testid', 'component', 'aria', 'semantic', 'class'],
    stripClassPatterns: [/^css-[a-z0-9]+$/, /^sc-/, /^[a-z]+:[\w-]+$/], // emotion, styled, tailwind variants
  },

  tokens: {
    enabled: true,
    include: 'referenced',
    includePatterns: ['--color-*', '--space-*', '--radius-*', '--font-*', '--shadow-*'], // example
    ignore: [/^--_/],                            // merged with the built-in ignores
    naming: 'dash-groups',                       // --color-bg-default → color/bg-default
    collections: 'tiered',
    modes: [{ name: 'Light', globals: { theme: 'light' } }, { name: 'Dark', globals: { theme: 'dark' } }], // example
    modeOverflow: 'variant-axis',
    themeFallback: 'variant-axis',
    bindByValue: false,                          // D-18: opt-in, low confidence
  },

  fonts: { map: { 'Acme Sans': 'Inter', 'Acme Mono': { family: 'JetBrains Mono' } }, fallback: 'Inter' },

  figma: {
    page: 'Components',                          // D-22
    sections: 'by-root-title',
    docFrames: true,
    docSections: ['description', 'properties', 'diagnostics'],
    iconsPage: 'Icons',
    deprecatedPage: 'Deprecated',
    grid: { maxColumns: 8, gap: 24, padding: 32 },
  },

  sync: { orphans: 'remove', undo: 'per-component' },

  dcr: {                                         // hashed into extractor.configHash and copied to the branch file (D-50)
    scope: 'changed',                            // D-57
    requireApproval: false,
    targets: { components: { package: '@acme/ui' } }, // example
    screens: {
      separator: ' / ',
      groupBySection: true,
      breakpoints: { Mobile: 0, Tablet: 768, Desktop: 1280 },
      base: 'widest',
      expectStates: [],                          // e.g. ['empty', 'loading', 'error']
    },
    content: { placeholders: [/^XX+$/, /^\[.*\]$/], i18n: 'auto' }, // placeholders: example
    deprecations: { 'components-legacyalert': 'components-banner' }, // example
  },

  verify: { visual: 'advisory', tolerance: { px: 0.5, color: 1e-3 }, regressions: true },

  output: { dir: '.holotype/out', report: ['json', 'html'] },
  cache: { dir: '.holotype/cache' },
  telemetry: false,                              // D-23
  redaction: { inputs: 'password', text: 'off' },
});
```

Story-level equivalent (precedence 5); authoring stays in Storybook:

```ts
export const Primary = {
  args: { variant: 'primary', label: 'Save' },
  parameters: { holotype: { args: { label: { as: 'text' } }, grid: { columns: ['State'] } } },
  tags: ['figma'],
};
```
