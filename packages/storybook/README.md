# `@holotype/storybook`

The Storybook adapter (plan [03](../../docs/plan/03-storybook.md)). It is the only package that knows
Storybook internals: everything downstream sees the model and the render driver below.

This version (BUILD B-10) covers discovery and the URL render path on Storybook 10. The channel render
loop, metadata (`describe()`), decorator unwrapping and portals come with B-40.

## Usage

```ts
import { connectStorybook } from '@holotype/storybook';
import { unwrap } from '@holotype/shared';

const storybook = unwrap(await connectStorybook({ source: 'storybook-static', filter: { requireTag: false } }));
const stories = await storybook.listStories();

const driver = await storybook.openDriver(page); // a Playwright Page that has not navigated yet
const result = await driver.render({ storyId: 'components-button--primary', args: { label: 'Save' } });
if (result.ok) {
  // result.rootHandles: what the story rendered inside #storybook-root
} else {
  // result.diagnostic: SB_STORY_ERROR, SB_RENDER_TIMEOUT, …
}
await storybook.close();
```

## Public API

| Export                                                                           | What it does                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectStorybook({ source, filter?, requestTimeoutMs? })`                       | Serves a static build with `sirv` on `127.0.0.1:<ephemeral>`, or normalizes a URL. Reads `index.json` (v4/v5; a v3 `stories.json` only to name skipped stories), `project.json` (optional) and checks `iframe.html`. Returns `Result<ConnectedStorybook, Diagnostic[]>`                                                                                                 |
| `ConnectedStorybook`                                                             | `baseUrl`, `caps`, `model`, `diagnostics`, `listStories()`, `openDriver(page, { renderTimeoutMs? })`, `close()`                                                                                                                                                                                                                                                         |
| `StorybookModel`                                                                 | `baseUrl`, `caps`, filtered `stories`, `excluded` (with a reason), `indexHash`, `defaultStoryId` (from a `?path=/story/<id>` deep link)                                                                                                                                                                                                                                 |
| `SbCapabilities`                                                                 | 03 §3.2 flags from `project.json` (`version: null` and conservative flags when it is missing)                                                                                                                                                                                                                                                                           |
| `RenderDriver.render(request)`                                                   | One navigation to `iframe.html?id=&viewMode=story&args=&globals=`, then the done event (`storyFinished` when `caps.storyFinishedEvent`, else `storyRendered`), the fullscreen layout override (unless `keepLayout`), `document.fonts.ready` and two animation frames. Returns `RenderResult` (`container`, `rootHandles`, `phase`, `renderMs`, `warnings`) or `SbError` |
| `RenderDriver.reload()` / `dispose()`                                            | Hard reset to `about:blank`; stop using the page (the page stays open)                                                                                                                                                                                                                                                                                                  |
| `filterStories(entries, filter)`                                                 | Tag filter (README §7) plus `include` / `exclude` globs (16 §5)                                                                                                                                                                                                                                                                                                         |
| `parseStoryIndex(json)`, `parseStoriesJsonV3(json)`                              | Index parsing into `IndexStory` entries                                                                                                                                                                                                                                                                                                                                 |
| `parseProjectJson`, `detectCapabilities`, `checkStorybookVersion`, `parseSemver` | Version detection and the D-11 gate                                                                                                                                                                                                                                                                                                                                     |
| `encodeUrlParam(values)`, `buildIframeUrl(...)`                                  | The `args=` / `globals=` encoding of Storybook's `buildArgsParam`, with its safe-list                                                                                                                                                                                                                                                                                   |
| `parseSource(input)`, `normalizeStorybookUrl(url)`                               | `--storybook <dir\|url>` handling                                                                                                                                                                                                                                                                                                                                       |
| `startStaticServer(dir)`                                                         | The loopback static server on its own                                                                                                                                                                                                                                                                                                                                   |
| `componentIdFromStoryId(id)`, `isStoryId(id)`                                    | `sid` from a story id                                                                                                                                                                                                                                                                                                                                                   |

### Story filter

In order: `subtype: 'test'` entries are never captured; a `!figma` tag opts out; with
`requireTag`, stories without `figma` are dropped. Storybook applies `!tag` entries while it builds
the index, so an opted-out story usually only _lacks_ `figma`: when any story of the index carries
`figma` (the project opts in by tag), a story without it counts as opted out. Then `exclude` globs,
which win over `include` (default `['**']`). Globs match the title path and the story id.

### Diagnostics

Discovery (fatal, `data.fatal: true`): `SB_INDEX_UNREACHABLE`, `SB_VERSION_UNSUPPORTED`,
`SB_IFRAME_UNREACHABLE`, `SB_HOST_NOT_ALLOWED`, `SB_AUTH_FAILED`, `SB_AUTH_REDIRECT`; warning:
`SB_VERSION_UNTESTED` (a major newer than 10).

Render (`SbError.code`): `SB_STORY_ERROR`, `SB_PLAY_ERROR`, `SB_STORY_MISSING`, `SB_STORY_LOAD_FAILED`
(the CSF file failed to load), `SB_RENDER_TIMEOUT`, `SB_PREVIEW_INIT_TIMEOUT`, `SB_IFRAME_UNREACHABLE`,
`SB_ROOT_NOT_FOUND`, `SB_URL_ARG_UNENCODABLE`. Warning: `SB_CONSOLE_ERROR`.

## Scripts

| Script     | Does                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test`     | unit tests on recorded `index.json` / `project.json` fixtures (`test/fixtures/`)                                                                  |
| `test:e2e` | builds `fixtures/ds-react` to a temp dir and renders stories in headless Chromium. Set `HOLOTYPE_CHROMIUM_PATH` to use a specific Chromium binary |

`test/fixtures/sb10-ds-react/` holds `index.json` and `project.json` recorded from a
`fixtures/ds-react` Storybook 10.6.7 build. Re-record them after the fixture's story list changes.
