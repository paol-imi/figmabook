# `@holotype/capture`

The capture engine (plan [05](../../internal/plan/05-capture.md)): Playwright orchestration in Node, and
the in-page serializer, shipped as one IIFE string. It turns a rendered story into **Capture IR**
(`CaptureDoc`, [06 §2](../../internal/plan/06-ir.md)): browser facts only, never a Figma decision.

This version (BUILD B-11) is the skeleton: the worker pool, the deterministic environment and the
first collectors. Geometry through CDP, the full computed subset, paints, fonts, replaced content and
authored styles come with B-41 to B-45.

## Usage

```ts
import { createCapturer } from '@holotype/capture';
import { connectStorybook } from '@holotype/storybook';
import { unwrap } from '@holotype/shared';

const storybook = unwrap(await connectStorybook({ source: 'storybook-static' }));
const capturer = createCapturer({ storybook, config: { workers: 'auto' } });
const outcome = await capturer.capture({ storyId: 'micro-flex--row' });
if (outcome.ok) {
  // outcome.doc: a valid CaptureDoc; outcome.canonical: its canonical JSON; outcome.hash: captureHash
  // outcome.assets: sha256 → bytes (the root screenshot @2x)
} else {
  // outcome.diagnostic: SB_* from the render, or CAP_SERIALIZE_FAILED
}
await capturer.close();
await storybook.close();
```

## Public API

| Export                                                                                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createCapturer(options) → Capturer`                                                         | One Chromium (Playwright `chromium` channel, new headless; `chromiumPath` overrides it) and N workers. Each worker is a browser context with one long-lived page and its render driver, opened on first use. Variants of one component (`sid`) run on one worker, in order; components spread across workers                                                                                                                                                                     |
| `Capturer.capture(request) → CaptureOutcome`                                                 | Render (`@holotype/storybook` driver, fullscreen layout), finish animations, serialize in the page, screenshot the root at the context DPR, then assemble, canonicalize, validate (`validateCaptureDoc`) and hash. A page crash is retried once on a fresh page (`CAP_PAGE_CRASHED` in `warnings`)                                                                                                                                                                               |
| `Capturer.close()`                                                                           | Waits for queued captures, closes the contexts and the browser. Idempotent                                                                                                                                                                                                                                                                                                                                                                                                       |
| `CapturerOptions`                                                                            | `storybook` (its `origin` names it in `target.storybookUrl`, so a static build hashes the same on any port), `config` (the `capture` namespace, 16 §7), `workers` (`--concurrency`), `chromiumPath`, `launch`, `renderTimeoutMs`, `renderMode` (`channel` by default: one warm `iframe.html` page per worker driven through the Storybook channel, with the URL path as fallback; `url` navigates per variant), `recycleAfter` (default 500), `preparePage(page)` (routes, auth) |
| `CaptureRequest`                                                                             | `storyId`, `sid?`, `vk?`, `args?`, `globals?`, `viewport?`, `rootSelector?`, `keepLayout?`, `unwrap?` (decorator wrappers, 03 §6.2; `target.rootSelector` gets one `:nth-child` step per level), `exclude?` (CSS selectors), `screenshot?`                                                                                                                                                                                                                                       |
| `canonicalCapture(doc)`, `captureHash(doc)`, `stableCapture(doc)`, `VOLATILE_CAPTURE_FIELDS` | Canonical JSON with the Capture IR number kinds (06 §5); `h16` of it without the volatile `timing` (05 §10.1); the document with `timing` zeroed                                                                                                                                                                                                                                                                                                                                 |
| `resolveEnvironment(config)`, `DEFAULT_ENVIRONMENT`, `contextOptions`, `captureUserAgent`    | The D-24 environment: 1280×800, DPR 2, `en-US`, UTC, light, `reducedMotion: 'reduce'`, service workers blocked, `Date` frozen at `2026-01-01T00:00:00Z` with `clock.setFixedTime` (timers stay real), `Math.random` seeded, user agent `… StorybookTestRunner holotype/<version>`                                                                                                                                                                                                |
| `CHROMIUM_ARGS`                                                                              | `--font-render-hinting=none`, `--disable-lcd-text`, `--force-color-profile=srgb`, `--hide-scrollbars`, `--disable-features=PaintHolding` (05 §1.3)                                                                                                                                                                                                                                                                                                                               |
| `seededRandomScript(seed?)`, `RANDOM_SEED`                                                   | The init script that replaces `Math.random` with a seeded mulberry32 (seed `0xF16B00C`)                                                                                                                                                                                                                                                                                                                                                                                          |
| `resolveWorkerCount(workers, host?)`, `currentHost()`                                        | `auto` = `min(8, max(1, availableParallelism − 1))` locally, `min(4, cpus)` in CI (05 §1.1)                                                                                                                                                                                                                                                                                                                                                                                      |
| `serializerSource`, `PAGE_GLOBAL`, `PageSerializer`, `SERIALIZER_PROTOCOL`                   | The built page bundle (installs `globalThis.__holotype` with `serialize(root, options)`), for `addInitScript` and the storybook addon                                                                                                                                                                                                                                                                                                                                            |
| `ENGINE_VERSION`, `PLAYWRIGHT_VERSION`                                                       | Versions recorded in `CaptureDoc.engine`                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Collectors

`src/page/collectors/index.ts` is the registry (hot file, BUILD §2.3: one import line and one entry
per collector, append only). Collectors run in order for every element and text block:

| Collector     | Writes                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `geometry`    | `borderBox` (`getBoundingClientRect`, page space)                                                             |
| `box`         | `display`, `position`, `boxSizing`, `visibility`, `zIndex`, blend, isolation, overflow, padding, margin, size |
| `background`  | `background.color` (layers stay empty), `background.clip`, `color`                                            |
| `border`      | per-side width, style and color; `outline`                                                                    |
| `radius`      | `[h, v]` per corner, percentages resolved                                                                     |
| `opacity`     | `opacity`                                                                                                     |
| `effects`     | raw `filter`, `backdropFilter`, `clipPath`, `maskImage`; `boxShadow: []`                                      |
| `paint-order` | `paint` (stacking context, z-index, Appendix E layer, walk-order `domIndex`)                                  |
| `text`        | text nodes: characters as rendered, styled runs (family, size, weight, line height, color), line boxes        |
| `unsupported` | `CAP_CSS_UNSUPPORTED` for CSS not captured yet; `CAP_PSEUDO_UNMEASURED` for `::before`/`::after` with content |

The walk (`src/page/walk.ts`) covers light DOM and open shadow roots, flattens slots and
`display: contents`, skips `display: none`, `[data-holotype-ignore]`, `exclude` selectors and
visually-hidden content (`CAP_SR_ONLY_SKIPPED`), and groups inline content into text blocks
(flex and grid items are blockified). Replaced elements (`img`, `svg`, controls, …) keep their box
and get `CAP_CSS_UNSUPPORTED` (`property: 'replaced-content'`) until B-44 and B-103. Colors outside
the sRGB syntaxes are read back through a canvas (`PAINT_COLOR_READBACK`) until B-42.

Not filled yet: `fonts`, `customProperties`, `assets` beyond the screenshot, `authored`, `portals`,
text decorations and `CTextStyle.used`.

## Scripts

| Script     | Does                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test`     | unit tests: colors, whitespace collapse, line boxes, collectors, environment, pool, document assembly, the IIFE budget (≤150 kB)                                                                                                                                                                                   |
| `test:e2e` | builds `fixtures/ds-react` and captures stories in headless Chromium: the determinism gate (3 captures, one hash), golden captures in `test/e2e/__golden__/`, the environment, the pool and crash recovery. `HOLOTYPE_CHROMIUM_PATH` picks a Chromium binary; `HOLOTYPE_STORYBOOK_STATIC` reuses a built Storybook |

Golden captures change when the serializer, the fixture or the pinned Chromium changes: review the
diff, then run `pnpm -F @holotype/capture test:e2e -u`.
