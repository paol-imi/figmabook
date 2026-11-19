# `@holotype/fixture-ds-react`

A small React + Vite design system on Storybook 10.6 (`@storybook/react-vite`, D-11, D-26). Capture,
mapper and DCR tests and the loop demo run against it (BUILD B-03, B-04). Private: never published.

## Scripts

Run from the repo root with `pnpm -F @holotype/fixture-ds-react <script>`.

| Script            | Does                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `build-storybook` | static build into `storybook-static/` (gitignored); also `pnpm build-storybook` (turbo)  |
| `test`            | unit tests, plus a `storybook build` to a temp dir checked against `test/story-ids.json` |
| `test:smoke`      | Playwright smoke test of every story (below); also `pnpm test:smoke`; `test:e2e` alias   |
| `dev`             | dev server on `127.0.0.1:6006` with CSS source maps (branch mode, S-19)                  |
| `fonts:lock`      | rewrites `fixtures/fonts.lock` from `src/styles/fonts.css` (`--check` only verifies)     |

`test` is part of the default `pnpm test`: the Storybook build takes a few seconds.
`test:smoke` builds `storybook-static/`, serves it on `127.0.0.1` and opens every story in headless
Chromium. A story passes with no Storybook error, no console error, no request outside `127.0.0.1`, one
root element and `document.fonts.check('600 14px Inter')` true. It also checks the dark theme and that
the shipped font files equal `fixtures/fonts.lock`. Turbo never caches it.

The default `pnpm build` does not build Storybook: the package has no `build` script.
The smoke test uses the `playwright` version pinned in `package.json`. Set `HOLOTYPE_CHROMIUM_PATH` to
use a specific Chromium binary; turbo passes it and `PLAYWRIGHT_BROWSERS_PATH` through.

## Contents

- `src/tokens/tokens.css`: primitives (`--color-<hue>-<step>`, `--space-1..8`, `--radius-*`, `--font-size-*`,
  `--line-height-*`, `--shadow-*`), semantic aliases (`--color-bg`, `--color-primary`, `--button-bg`, …), a
  dark theme under `[data-theme="dark"]`, one `calc()` token (`--control-height-md`) and one `color-mix()`
  token (`--color-primary-subtle`).
- `src/components/*`: `Button`, `Badge`, `Input`, `Card`, `Stack`, `Icon`. Each has a CSS module that uses
  token values only (checked by `test/unit/tokens.test.ts`).
- `src/micro/*`: plain-markup micro-fixtures, one CSS feature per story (flex, borders, backgrounds, text).
- `src/holotype-params.ts`: the `parameters.holotype` authoring type (04 §9 plus `implements`, `replacedBy`).
  Swap for the `@holotype/ir` export once B-01 lands.
- `.storybook/preview.tsx`: the `theme` global (light/dark), applied as `data-theme` on `<html>` (03 §8).
  Every story is tagged `figma`; `components-icon--gallery` opts out with `!figma`.
- Inter 400/500/600/700 (Latin) is self-hosted from `@fontsource/inter`; icons come from `lucide` (ISC).
  The card image `src/assets/landscape.png` is generated for this repo.

## Story ids are API

Tests address stories by id (BUILD §2.3). `test/story-ids.json` lists every id; it may only grow.
Add stories in new files and never rename an export or a title. `parameters.holotype` usages:

| Where                        | Usage                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| Button meta                  | `args` hints for variant/size/label/showIcon, `states`, `layout` |
| Badge meta                   | `args` hints with Figma names `Tone`, `Dot`                      |
| `components-stack--wrap`     | `keepLayout`, `width: { probe: [240, 480] }`                     |
| `components-card--long-text` | `textMode: 'locked-lines'`                                       |
| Card meta                    | `slots.actions` → `[data-slot=actions]`                          |
