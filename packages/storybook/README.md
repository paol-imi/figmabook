# `@holotype/storybook`

The Storybook adapter (plan [03](../../internal/plan/03-storybook.md)). It is the only package that knows
Storybook internals: everything downstream sees the model, the story metadata and the render driver below.

This version (BUILD B-10, B-40) covers discovery, story metadata (`describe()`) and the render loop on
Storybook 10: the channel loop on one long-lived page, with the URL path as fallback. Its behaviour follows
the S-07 spike ([`internal/spikes/S-07.md`](../../internal/spikes/S-07.md)), whose measurements win where
they differ from 03. Portals (03 §6.3) and viewport growth (03 §6.4) come later.

## Usage

```ts
import { connectStorybook } from '@holotype/storybook';
import { unwrap } from '@holotype/shared';

const storybook = unwrap(await connectStorybook({ source: 'storybook-static', filter: { requireTag: false } }));
const stories = await storybook.listStories();

const { stories: metas } = await storybook.describe(
  page,
  stories.map((story) => story.id),
);

const driver = await storybook.openDriver(page); // a Playwright Page that has not navigated yet
const result = await driver.render({ storyId: 'components-button--primary', args: { label: 'Save' } });
if (result.ok) {
  // result.rootHandles: what the story rendered inside #storybook-root, decorators unwrapped
} else {
  // result.diagnostic: SB_STORY_ERROR, SB_RENDER_TIMEOUT, …
}
await driver.dispose();
await storybook.close();
```

## Public API

| Export                                                                                                   | What it does                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectStorybook({ source, filter?, requestTimeoutMs? })`                                               | Serves a static build with `sirv` on `127.0.0.1:<ephemeral>`, or normalizes a URL. Reads `index.json` (v4/v5; a v3 `stories.json` only to name skipped stories), `project.json` (optional) and checks `iframe.html`. Returns `Result<ConnectedStorybook, Diagnostic[]>`                                  |
| `ConnectedStorybook`                                                                                     | `baseUrl`, `origin` (what documents record: the server origin, or `static:<folder>` for a static build, never its ephemeral port), `caps`, `model`, `diagnostics`, `listStories()`, `openDriver(page, options?)`, `describe(page, ids, options?)`, `close()`                                             |
| `RenderDriver`                                                                                           | `mode` (`channel`, or `url` when asked or fallen back to), `render(request)`, `reload()`, `dispose()`. See [Render loop](#render-loop)                                                                                                                                                                   |
| `DriverOptions`                                                                                          | `renderTimeoutMs` (`T.render`, default 15 000), `mode` (`url` is `--no-channel`), `stability` (`first-per-component` default, `always`, `never`), `disposeTimeoutMs` (default 5 000)                                                                                                                     |
| `RenderRequest`                                                                                          | `storyId`, `args` (over `initialArgs`; `undefined` unsets; `{ $fromStory, arg }` and `{ $mapKey }` markers on the channel), `globals` (over `initialGlobals`), `remount`, `viewport`, `rootSelector`, `keepLayout`, `unwrap`, `checkStability`                                                           |
| `RenderResult` / `SbError`                                                                               | `container`, `rootHandles`, `portalHandles` (empty), `phase`, `renderMs`, `via` (`channel` \| `boot` \| `url`), `attempts`, `warnings` / `code`, `diagnostic`, `warnings`, `via`, `attempts`                                                                                                             |
| `describe(page, ids, options?)` → `DescribeResult`                                                       | Per-id `loadStory` metadata (03 §4) in batches of 50: `StoryMeta` (`args`, `initialArgs`, normalized `argTypes` with `options` and `origin`, `tags`, `parameters`, `holotype`, `storyGlobals`, `code: CodeRef`, `hasPlay`, `usesMount`, `diagnostics`) or an `SbError` per id. See [Metadata](#metadata) |
| `normalizeArgType(s)`, `inferControl`, `CONTROL_TYPES`                                                   | argType normalization and Storybook's control inference (03 §4.4)                                                                                                                                                                                                                                        |
| `resolveParams`, `checkParams`, `mergeParams`, `allowedKeys`, `suggestKey`                               | `parameters.holotype` precedence (README §7) and validation (`validateHolotypeParams`)                                                                                                                                                                                                                   |
| `parseComponentsManifest`, `loadComponentsManifest`, `packageFromImports`, `packageOf`, `codeRefOf`      | The SB 10 components manifest (03 §2.3) and `CodeRef` (15 §5.3)                                                                                                                                                                                                                                          |
| `readStoryMetas`, `SAFE_LIMITS`, `toStoryMeta`, `portableUrls`                                           | The in-page metadata reader with the 03 §4.1 marker serializer, and the Node-side assembly                                                                                                                                                                                                               |
| `disposeBounded(page, inFlight, ms)`                                                                     | The bounded dispose behind `RenderDriver.dispose()`                                                                                                                                                                                                                                                      |
| `filterStories(entries, filter)`                                                                         | Tag filter (README §7) plus `include` / `exclude` globs (16 §5)                                                                                                                                                                                                                                          |
| `parseStoryIndex(json)`, `parseStoriesJsonV3(json)`                                                      | Index parsing into `IndexStory` entries                                                                                                                                                                                                                                                                  |
| `parseProjectJson`, `detectCapabilities`, `checkStorybookVersion`, `parseSemver`, `TESTED_MAJOR`         | Version detection and the D-11 gate                                                                                                                                                                                                                                                                      |
| `encodeUrlParam(values)`, `buildIframeUrl(...)`                                                          | The `args=` / `globals=` encoding of Storybook's `buildArgsParam`, with its safe-list                                                                                                                                                                                                                    |
| `DEFAULT_ROOT_SELECTORS`, `unwrapDepth`, `MAX_UNWRAP_DEPTH`                                              | Root container lookup and decorator unwrapping (03 §6.1–6.2)                                                                                                                                                                                                                                             |
| `RETRIED_CODES`, `MAX_FAILED_RELOADS`, `DEFAULT_RENDER_TIMEOUT_MS`, `DEFAULT_DISPOSE_TIMEOUT_MS`         | The retry policy constants                                                                                                                                                                                                                                                                               |
| `watchConsole(page, baseUrl)`, `isBrowserFaviconError(...)`                                              | The render console watch behind `SB_CONSOLE_ERROR`; it leaves out the 404 of the browser's own `/favicon.ico` request                                                                                                                                                                                    |
| `parseSource(input)`, `normalizeStorybookUrl(url)`, `documentOrigin(source)`, `documentUrl(url, origin)` | `--storybook <dir\|url>` handling; the portable origin and page URL that documents record                                                                                                                                                                                                                |
| `startStaticServer(dir)`                                                                                 | The loopback static server on its own                                                                                                                                                                                                                                                                    |
| `componentIdFromStoryId(id)`, `isStoryId(id)`                                                            | `sid` from a story id                                                                                                                                                                                                                                                                                    |

### Render loop

`openDriver(page)` gives the channel driver (03 §5.3 with the S-07 corrections):

- **Boot.** One navigation to `iframe.html?viewMode=story`, no story id (nothing renders, nothing is
  logged: S-07 Q13). An init script records the channel events of each document by wrapping `emit` (Q9);
  each document has its own id. The fullscreen layout style is injected once and toggled for `keepLayout`.
- **Per render, one `page.evaluate`.** `loadStory` for `initialArgs` (and `{ $fromStory }` sources); the
  full arg set `{...initialArgs, ...args}` with `undefined` for extra keys (Q2), sent only when it differs
  from the story's store args (Q1: Storybook keeps args per story across switches; Q3), and preset before
  `setCurrentStory` so a switch is one render (Q8); globals over `initialGlobals`; `forceRemount` when asked
  or when a render error left the story blank (Q5). Errors win over the done event, whose status says
  "success" even for a throw or a failed play function (Q4). Then `document.fonts.ready` and two frames.
- **Stability check** (first render of each component by default): every element's rect under the root and
  the root markup, sampled 100 ms apart, three tries; else `CAP_UNSTABLE_RENDER` (the 03 §5.5 heuristic
  missed 2/2 unstable roots, Q17).
- **Timeouts and reloads.** After `SB_RENDER_TIMEOUT` the next render boots a fresh document (Q6). When
  Storybook reloads the preview itself (a teardown during `loading`, a dev-server reload), the driver adopts
  the new document once its own render is done, never navigates over it, retries the render and warns
  `SB_HMR_DURING_CAPTURE`; so does an HMR event inside a render window (Q10).
- **Retries (02 §1.3).** `SB_RENDER_TIMEOUT` and `SB_STORY_ERROR` get a second attempt on a fresh
  document. A story whose renders failed on three fresh documents in a row is `SB_STORY_UNRENDERABLE`
  from then on (03 §5.3).
- **URL fallback.** A preview without the channel API (no `storyStoreValue`) switches the driver to the
  URL path for good (`mode` becomes `url`); `mode: 'url'` asks for it.
- **Test-runner user agent (D-24).** Without `StorybookTestRunner` Storybook waits ≈ 100 ms for
  animations on every render (Q7); for a context without it the driver adds the marker to
  `navigator.userAgent` in its page.
- **Roots.** The container's displayed children, then down through transparent decorator wrappers (03 §6.2:
  `display: contents`, or one child with the same box, no paint, no clip, no own text; `[data-theme]`,
  `#root-inner` and `.docs-story` even with a box, `SB_DECORATOR_PAINTS` when they paint a background).
- **Dispose** is bounded: it waits for a render in flight and checks the page answers, each within
  `disposeTimeoutMs`; a page that does not answer is closed (its context if need be), and the report says
  why, so the owner's own `page.close()` cannot hang.

Measured by `test:e2e` on this container (one page, fixture `ds-react`): 50 different stories in ≈ 3.7 s
with the stability check on each component's first render (p50 50 ms); 100 variants without it at
≈ 21 variants/s (p50 48 ms, p95 55 ms). Set `HOLOTYPE_E2E_METRICS=<file>` to append the numbers.

### Metadata

`describe(page, ids, { defaults?, components?, batchSize?, batchTimeoutMs? })` boots the preview without a
story and calls `loadStory` per id (never `extract()`): 50 ids per `evaluate`, 30 s per batch, one retry on
a fresh page, then `SB_METADATA_TIMEOUT`. Unknown ids are `SB_STORY_MISSING`, a CSF file that fails to load
is `SB_STORY_LOAD_FAILED`. Non-JSON values carry 03 §4.1 markers (`$fn`, `$node`, `$obj`, `$cycle`,
`$date`, `$undef`, `$sym`, `$truncated`, plus `$regexp`, `$num`, `$bigint`); URLs on the served origin are
rewritten to `origin`, so metadata is the same on every port.

- `holotype`: config `defaults` < the Storybook layers (project < meta < story, merged by Storybook) <
  config `components[sid | glob]` in order (README §7). The Storybook layers are validated with
  `validateHolotypeParams`: unknown keys give `PLAN_PARAM_UNKNOWN_KEY` with a `suggestion`, invalid values
  `PLAN_CONFIG_INVALID`; both are dropped.
- `argTypes[k].origin`: `story` (written in the project, meta or story annotations), `docgen-inline`
  (a docgen prop), else `inferred-from-args`. Missing controls are inferred like `inferControls.ts`.
- `code: CodeRef`: `storiesPath` is the index `importPath`, `importPath` the index `componentPath`;
  `exportName` and `package` come from `manifests/components.json` when the build has it (SB 10 with
  `features.componentsManifest`), else the export name from inline docgen. A manifest of unknown shape is
  `SB_MANIFEST_UNPARSEABLE` (info).

### Story filter

In order: `subtype: 'test'` entries are never captured; a `!figma` tag opts out; with
`requireTag`, stories without `figma` are dropped. Storybook applies `!tag` entries while it builds
the index, so an opted-out story usually only _lacks_ `figma`: when any story of the index carries
`figma` (the project opts in by tag), a story without it counts as opted out. Then `exclude` globs,
which win over `include` (default `['**']`). Globs match the title path and the story id.

### Diagnostics

Discovery (fatal, `data.fatal: true`): `SB_INDEX_UNREACHABLE`, `SB_VERSION_UNSUPPORTED`,
`SB_IFRAME_UNREACHABLE`, `SB_HOST_NOT_ALLOWED`, `SB_AUTH_FAILED`, `SB_AUTH_REDIRECT`; warning:
`SB_VERSION_UNTESTED` (any major but 10: 8 and 9 are best-effort, 11+ untested); info:
`SB_MANIFEST_UNPARSEABLE`.

Render (`SbError.code`): `SB_STORY_ERROR`, `SB_PLAY_ERROR`, `SB_STORY_MISSING`, `SB_STORY_LOAD_FAILED`,
`SB_RENDER_TIMEOUT`, `SB_STORY_UNRENDERABLE`, `SB_PREVIEW_INIT_TIMEOUT`, `SB_IFRAME_UNREACHABLE`,
`SB_ROOT_NOT_FOUND`, `SB_URL_ARG_UNENCODABLE` (URL path only). Warnings: `SB_CONSOLE_ERROR` (console and
page errors of the render, minus Chromium's own `/favicon.ico` 404), `SB_HMR_DURING_CAPTURE`,
`CAP_UNSTABLE_RENDER`, `SB_DECORATOR_PAINTS`. Metadata: `SB_METADATA_TIMEOUT`, `PLAN_PARAM_UNKNOWN_KEY`,
`PLAN_CONFIG_INVALID`.

## Scripts

| Script     | Does                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test`     | unit tests on recorded `index.json` / `project.json` / `manifests/components.json` fixtures (`test/fixtures/`)                                                                                                                                                                                                                                    |
| `test:e2e` | builds `fixtures/ds-react` (also with the components manifest on) and the `react-vite@10.6` + `faults` sandbox (`tools/sandboxes`) into temp dirs, and renders in headless Chromium: URL path, channel loop, every S-07 fault kind, a dev-server HMR edit, `describe()` snapshots. Set `HOLOTYPE_CHROMIUM_PATH` to use a specific Chromium binary |

`test/fixtures/sb10-ds-react/` holds `index.json` and `project.json` recorded from a
`fixtures/ds-react` Storybook 10.6.7 build, and `sb10-manifest/` its components manifest (trimmed to the
fields the adapter reads). Re-record them after the fixture's story list changes.
