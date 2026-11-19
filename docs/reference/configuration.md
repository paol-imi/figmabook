# Configuration

::: warning Planned
This is the planned configuration schema. It is not released and may change before the first release. Many keys only take effect in later stages of the [roadmap](/roadmap).
:::

Holotype reads its configuration from `holotype.config.ts` at the root of your project. It also accepts `holotype.config.{mts,js,mjs,json}`, a `.holotyperc` file, or a `holotype` key in `package.json`. `holotype init` writes a starting file.

```ts
// holotype.config.ts
import { defineConfig } from '@holotype/cli/config';

export default defineConfig({
  storybook: {
    source: './storybook-static', // a static build, or a URL
    dev: {
      url: 'http://localhost:6006',
      command: 'storybook dev -p 6006 --no-open',
    },
  },
  include: ['components/**'],
  tokens: { includePatterns: ['--color-*', '--space-*'] },
  dcr: { targets: { components: { package: '@acme/ui' } } },
});
```

Only `storybook.source` is required. Every other key is optional and has the default listed below.

## How settings combine

From lowest to highest precedence:

1. built-in defaults;
2. `defaults` in the config file;
3. `parameters.holotype` in the Storybook preview (project-wide);
4. `parameters.holotype` on a component's stories file (meta);
5. `parameters.holotype` on a single story;
6. `components[<id>]` in the config file;
7. CLI flags.

Project-wide namespaces (`capture`, `mapper`, `layout`, `tokens`, `figma`, `sync`, `dcr`, `verify` and the rest) have only three levels: built-in defaults, the config file, then CLI flags.

When values are merged, objects merge deeply, arrays replace, and `null` removes a key. The story tags `figma` and `!figma` opt a story in or out; opting out wins.

## Rules

- **No secrets in the file.** Credentials come only from environment variables (`HOLOTYPE_SB_TOKEN`, `HOLOTYPE_SB_HEADERS`, `HOLOTYPE_SB_BASIC`, `HOLOTYPE_REGISTRY_TOKEN`) or from `holotype login`. The file may name an environment variable, never hold its value. A literal that looks like a token or password stops the run with [`SEC_SECRET_IN_CONFIG`](./diagnostics/SEC_SECRET_IN_CONFIG).
- **JSON configs.** Regular expressions are written as `"/pattern/flags"` strings. Keys that take a function (`tokens.rename`, `tokens.cssName`) only work in `.ts` and `.js` configs.
- **Patterns.** Where the type says `Pattern`, you can pass a string or a regular expression.

## Validation

The merged configuration is checked before any capture starts.

| Problem | Diagnostic | Result |
|---|---|---|
| Unknown key | [`PLAN_CONFIG_UNKNOWN_KEY`](./diagnostics/PLAN_CONFIG_UNKNOWN_KEY) (warning) | The key is ignored. The message suggests a close match, or names the replacement of a renamed key. |
| Wrong type or value | [`PLAN_CONFIG_INVALID`](./diagnostics/PLAN_CONFIG_INVALID) (error) | The run stops with exit code 2. |
| Missing `storybook.source` | [`PLAN_CONFIG_INVALID`](./diagnostics/PLAN_CONFIG_INVALID) (error) | The run stops; run `holotype init`. |
| Unknown `parameters.holotype` key in a story | [`PLAN_PARAM_UNKNOWN_KEY`](./diagnostics/PLAN_PARAM_UNKNOWN_KEY) (warning) | The key is ignored. |
| Secret-like literal | [`SEC_SECRET_IN_CONFIG`](./diagnostics/SEC_SECRET_IN_CONFIG) (error) | The run stops. |
| Local `dcr` settings differ from the branch file's | [`DCR_CONFIG_DRIFT`](./diagnostics/DCR_CONFIG_DRIFT) (warning) | Run `holotype branch refresh` to update the branch file. |

`holotype doctor` prints the resolved configuration and where each value came from: a default, the file or a flag.

## Reference

### `storybook`

Where your Storybook is, and how to reach it.

| Key | Type | Default |
|---|---|---|
| `storybook.source` | `string`: a URL or a static build folder. **Required.** | — |
| `storybook.dev.url` | `string` | `source` if it is a URL, else `'http://localhost:6006'` |
| `storybook.dev.command` | `string`: started when the dev server is not running | none |
| `storybook.dev.autoStart` | `boolean` | `true` |
| `storybook.auth.storageState` | `string` (path) | `'.holotype/auth/storageState.json'` |
| `storybook.auth.headersFromEnv` | `Record<header, envVarName>` | `{}` |
| `storybook.refs` | `string[]` | `[]` |
| `storybook.requireTag` | `boolean`: only stories tagged `figma` | `false` |

### `include` and `exclude`

Which components to import, as globs on the story title path or component id.

| Key | Type | Default |
|---|---|---|
| `include` | `string[]` | `['**']` |
| `exclude` | `string[]` | `[]` |

`exclude` removes components. It is not the same as `defaults.exclude`, which removes elements from a capture by CSS selector.

### `defaults` and `components`

How stories and args become variants and component properties. `defaults` applies to every component. `components` overrides it per component id (or glob), and entries apply in file order. The same options can be set in Storybook with `parameters.holotype`.

| Key | Type | Default |
|---|---|---|
| `defaults.strategy` | `'auto' \| 'stories' \| 'args' \| 'curated'` | `'auto'` |
| `defaults.args.<name>` | `{ as, name, values, labels, order, target }`: how one arg maps to Figma | detected automatically |
| `defaults.fixed` | `Record<arg, value>` | `{}` |
| `defaults.variants` | a curated list of combinations | none |
| `defaults.excludeCombos` | `Array<Record<axis, label>>` | `[]` |
| `defaults.states` | `false \| { include, foldBooleans, labels, mode, target, includePortals }` | `include: ['default', 'hover', 'focus-visible', 'active']` for interactive roots; `foldBooleans: ['disabled', 'loading', 'invalid']`; `mode: 'force'` |
| `defaults.modes` | `{ globals, values, as, capture }` | follows `tokens.modes` |
| `defaults.viewports` | `{ sizes: Record<name, width \| { width, height }>, as }` | `{ sizes: {} }`, `as: 'axis'` |
| `defaults.viewport` | `{ width, height? }` | `{ width: 1280, height: 800 }` |
| `defaults.rootSelector` | `string` | `'#storybook-root'` |
| `defaults.unwrap` | `boolean \| number` | `true` |
| `defaults.portal` | `boolean \| 'auto' \| string \| {…}` | `'auto'` |
| `defaults.exclude` | `string[]` (CSS selectors) | `[]` |
| `defaults.grid` | `{ columns?: string[], rows?: string[] }` | first axis on columns, the rest on rows |
| `defaults.budget` | `{ max, warn, hardLimit, maxProbes }` | `{ max: 256, warn: 128, hardLimit: 1024, maxProbes: 120 }` |
| `defaults.stories` | `{ fillMatrix, maxStoryAxisValues }` | `maxStoryAxisValues: 8` |
| `defaults.keepLayout` | `boolean` | `false` |
| `defaults.textMode` | `'reflow' \| 'locked-lines'` | `layout.textWrap` |
| `defaults.implements` | `string[]`: change request item ids a story implements | none |
| `defaults.replacedBy` | `string`: the component id that replaces a deprecated one | none |
| `defaults.split` | `boolean`: one component per value instead of one set | `false` |
| `components[<id>].conflicts` | `'keep' \| 'overwrite' \| 'fork'` | `sync.conflicts` |

### `capture`

How stories are rendered. The defaults make captures repeatable.

| Key | Type | Default |
|---|---|---|
| `capture.dpr` | `1 \| 2 \| 3` | `2` |
| `capture.locale` | `string` (BCP 47) | `'en-US'` |
| `capture.timezone` | `string` (IANA) | `'UTC'` |
| `capture.clock` | `string` (ISO date) or `false` | `'2026-01-01T00:00:00Z'` |
| `capture.animations` | `'finish' \| 'pause-only'` | `'finish'` |
| `capture.determinism.random` | `boolean` | `true` |
| `capture.svg.rasterizeFilters` | `boolean` | `true` |
| `capture.rasterize` | `string[]` (selectors to import as images) | `[]` |
| `capture.workers` | `number \| 'auto'` | `'auto'` |
| `capture.devSourcemap` | `'force' \| 'keep'` | `'force'` |

### `mapper`

How the rendered page becomes Figma layers.

| Key | Type | Default |
|---|---|---|
| `mapper.keepInvisible` | `boolean` | `true` |
| `mapper.borderModel` | `'padding-plus-border' \| 'native'` | `'padding-plus-border'` |
| `mapper.allowSpacers` | `boolean` | `false` |
| `mapper.exactBorders` | `boolean` | `false` |
| `mapper.exactRadii` | `boolean` | `false` |
| `mapper.preferFrames` | `boolean` | `false` |
| `mapper.alignment.maxPlaceholdersRatio` | `number` (0–1) | `0.5` |
| `mapper.colorProfile` | `'auto' \| 'srgb' \| 'display-p3'` | `'auto'` |
| `mapper.nativeControls` | `'synthesize' \| 'raster'` | `'synthesize'` |

### `layout`

Auto layout and text wrapping.

| Key | Type | Default |
|---|---|---|
| `layout.autoLayout` | `'verified' \| 'off'` | `'verified'` |
| `layout.tolerancePx` | `number` | `0.6` |
| `layout.margins` | `'normalize'` | `'normalize'` |
| `layout.textWrap` | `'reflow' \| 'locked-lines'` | `'reflow'` |
| `layout.probing` | `{ enabled, widths }` | `{ enabled: false, widths: [0.75, 1, 1.25] }` |

With `'verified'`, a container becomes auto layout only when Holotype's layout model reproduces the browser's positions within the tolerance. Otherwise it keeps absolute positions.

### `naming`

How layers are named.

| Key | Type | Default |
|---|---|---|
| `naming.layers` | `string[]` (sources, in order) | `['data-holotype-name', 'data-figma-name', 'data-testid', 'component', 'aria', 'semantic', 'class']` |
| `naming.stripClassPatterns` | `Pattern[]` | `[/^css-[a-z0-9]+$/, /^sc-/, /^[a-z]+:[\w-]+$/]` |
| `naming.iconSlug` | `'role' \| 'boundary'` | `'role'` |

### `tokens`

How CSS custom properties become Figma variables and styles.

| Key | Type | Default |
|---|---|---|
| `tokens.enabled` | `boolean` | `true` |
| `tokens.include` | `'referenced' \| 'all'` | `'referenced'` |
| `tokens.includePatterns` | `string[]` (globs on CSS names) | none |
| `tokens.ignore` | `Pattern[]` (merged with the defaults) | `[/^--tw-/, /^--radix-/]` |
| `tokens.stripPrefix` | `string` | none |
| `tokens.naming` | `'dash-groups' \| 'flat' \| 'all-dashes'` | `'dash-groups'` |
| `tokens.rename` | `(css: string) => string` | none |
| `tokens.collections` | `'tiered' \| 'single' \| { groups }` | `'tiered'` |
| `tokens.collectionName` | `string` | `'Tokens'` |
| `tokens.modes` | `Array<{ name, globals }>` | theme globals, detected |
| `tokens.modeOverflow` | `'variant-axis' \| 'extend' \| 'split' \| 'first-only'` | `'variant-axis'` |
| `tokens.themeFallback` | `'variant-axis' \| 'report'` | `'variant-axis'` |
| `tokens.modeProbeVariants` | `'default-variant' \| 'all' \| number` | `'default-variant'` |
| `tokens.bindByValue` | `boolean` | `false` |
| `tokens.matchByValue` | `boolean` | `false` |
| `tokens.libraryProbeLimit` | `number` | `500` |
| `tokens.textStyles` | `false \| 'tokens' \| 'classes' \| 'dedupe'` | `false` |
| `tokens.effectStyles` | `boolean` | `true` |
| `tokens.paintStyles` | `boolean` | `false` |
| `tokens.hidePrimitives` | `boolean` | `false` |
| `tokens.scopes` | `'infer' \| 'all'` | `'infer'` |
| `tokens.lineHeight` | `'px-per-usage'` | `'px-per-usage'` |
| `tokens.motion` | `boolean` | `false` |
| `tokens.source` | `string \| string[]` (DTCG, Style Dictionary or Tokens Studio files) | none |
| `tokens.cssName` | `(dtcgPath: string[]) => string` | none |

### `fonts`

| Key | Type | Default |
|---|---|---|
| `fonts.map` | `Record<face, string \| { family, style? }>` | `{}` |
| `fonts.fallback` | `string` | `'Inter'` |

### `figma`

Where things go in the Figma file.

| Key | Type | Default |
|---|---|---|
| `figma.page` | `string` | `'Components'` |
| `figma.sections` | `'by-root-title' \| 'none'` | `'by-root-title'` |
| `figma.docFrames` | `boolean` | `true` |
| `figma.docSections` | `string[]` | `['description', 'properties', 'diagnostics']` |
| `figma.iconsPage` | `string` | `'Icons'` |
| `figma.deprecatedPage` | `string` | `'Deprecated'` |
| `figma.prototypeStates` | `boolean` | `false` |
| `figma.grid` | `{ maxColumns, gap, padding }` | `{ maxColumns: 8, gap: 24, padding: 32 }` |
| `figma.files` | `Array<{ name, include: string[] }>` | none (one file) |

### `sync`

What happens on re-import.

| Key | Type | Default |
|---|---|---|
| `sync.conflicts` | `'keep' \| 'overwrite' \| 'fork'` | `'keep'`. The plugin pre-selects it, and you can change it per layer. |
| `sync.orphans` | `'remove' \| 'hide'` | `'remove'` |
| `sync.pruneAfterDays` | `number` | `30` (pruning is always manual) |
| `sync.undo` | `'per-component' \| 'single'` | `'per-component'` |

### `dcr`

Design change requests. These settings are copied into the branch file when it is created, so the plugin and the CLI extract the same request.

| Key | Type | Default |
|---|---|---|
| `dcr.scope` | `'changed' \| 'ready' \| 'page:<name>' \| 'all'` | `'changed'` |
| `dcr.requireApproval` | `boolean` | `false` |
| `dcr.targets` | `{ components: { package? }, screens?: { repo, path } }` | components: the nearest `package.json` name; screens: this repository |
| `dcr.screens` | `{ separator, groupBySection, breakpoints, states, base, expectStates }` | see below |
| `dcr.content` | `{ placeholders: Pattern[], i18n: 'auto' \| 'none' \| 'keys' }` | `{ placeholders: [], i18n: 'auto' }` |
| `dcr.a11y.categories` | `string[]` (annotation categories) | `['Accessibility', 'A11y']` |
| `dcr.deprecations` | `Record<id, id>` (old component to replacement) | `{}` |

`dcr.screens` groups frames of the same screen at other widths or states into one item. Its defaults are `separator: ' / '`, `groupBySection: true`, `breakpoints: { Mobile: 0, Tablet: 768, Desktop: 1280 }`, `base: 'widest'` and `expectStates: []`. The default `states` maps state names to frame name suffixes: `{ default: ['Default', 'Filled'], empty: ['Empty'], loading: ['Loading', 'Skeleton'], error: ['Error'], success: ['Success'] }`.

In the first release, `scope`, `targets`, `screens.separator` and `screens.groupBySection` are used. `requireApproval`, `a11y`, `screens.expectStates` and `deprecations` come later.

### `verify`

How `holotype verify` decides.

| Key | Type | Default |
|---|---|---|
| `verify.visual` | `'advisory' \| 'gate'` | `'advisory'` |
| `verify.tolerance` | `{ px, color }` | `{ px: 0.5, color: 1e-3 }` |
| `verify.screens` | `boolean` | `false` |
| `verify.regressions` | `boolean` | `true` |

### `output`, `cache`, `telemetry`, `redaction`, `compat`

| Key | Type | Default |
|---|---|---|
| `output.dir` | `string` | `'.holotype/out'` |
| `output.report` | `Array<'json' \| 'html'>` | `['json', 'html']` |
| `cache.dir` | `string` | `'.holotype/cache'` |
| `telemetry` | `boolean` | `false` |
| `redaction.inputs` | `'password' \| 'all'`: which input values are masked in captures | `'password'` |
| `redaction.text` | `'off' \| 'mask'` | `'off'` |
| `compat.s2d` | `boolean`: read existing `parameters.s2d` story parameters | `true` |
