# @holotype/cli

The `holotype` command (alias `holo`) and its programmatic API ([11 §3](../../internal/plan/11-ux.md)).
This version (BUILD B-13) has one command: `capture`.

## `holotype capture`

```sh
holotype capture --storybook storybook-static \
  --story micro-flex--row --story components-badge--default \
  --out smoke.holotype.zip
```

| Flag                             | Meaning                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--storybook <dir\|url>`         | static build directory or Storybook URL; overrides `storybook.source`                                                     |
| `--story <id>`                   | story to capture; repeat it or give a comma list. One story per component in this version                                 |
| `--out <dir\|file.holotype.zip>` | a `.holotype.zip` file, or a directory for the bundle tree. Default `<output.dir>/<runId>.holotype.zip` (`.holotype/out`) |
| `-c, --config <path>`            | config file; default the nearest `holotype.config.{ts,mts,js,mjs,json}` upward                                            |
| `--cwd <dir>`                    | working directory                                                                                                         |
| `--json`                         | one `RunReport` JSON document on stdout; progress stays on stderr                                                         |

Environment: `HOLOTYPE_CHROMIUM_PATH` picks a Chromium binary; `SOURCE_DATE_EPOCH` fixes the
bundle's `createdAt` and run id, so the same input gives a byte-identical zip.

Each story is planned as a one-variant component (`planSingleStory`), captured
(`@holotype/capture`), mapped (`@holotype/mapper`) and written by the bundle writer. A story
that fails is reported and left out; the other components are still written.

**Exit codes** (11 §3.2): `0` ok (warnings allowed); `1` errors in some components (the bundle
holds the rest; nothing is written when no component was built); `2` usage or config error
(`PLAN_CONFIG_INVALID`, unknown flags); `3` Storybook unreachable (`SB_INDEX_UNREACHABLE`, …);
`4` browser failure; `130` interrupted.

**Human output** (stdout): a header, one line per component, the bundle path and size, warnings
grouped by code, each error with its fix and help page (`docs/diagnostics/<CODE>.md`), and the
next step. Progress goes to stderr.

**Config** (v0 of 02 §8 / 16): the file is deep-merged with the flags (flags win) and validated
against `HolotypeConfig`. Unknown keys warn (`PLAN_CONFIG_UNKNOWN_KEY`) and are dropped;
invalid values stop the run (`PLAN_CONFIG_INVALID`, exit 2). Applied: `storybook.source`,
`storybook.requireTag`, `include`, `exclude`, `capture`, `output.dir`, `mapper`, `layout`,
`naming`, `figma.grid`, `tokens.bindByValue`, `defaults.textMode`. Other keys are validated but
have no effect yet; `.holotyperc`, the `package.json` key, env overlays and per-component
overrides come later.

## Bundle writer

`src/bundle/` ([02 §5.1](../../internal/plan/02-architecture.md), [06 §4](../../internal/plan/06-ir.md)):
canonical JSON files, `manifest.json` first in the zip and the rest sorted, `integrity` over every
other file, only the assets a scene refers to, fixed zip timestamps and attributes, `STORE` for
PNG/JPEG/GIF and `DEFLATE` (level 9) for JSON and SVG. A static build's ephemeral loopback port
is kept out of the bundle (`source.origin` is `static:<folder>`, and the capture engine records
`target.storybookUrl` as `static:<folder>/iframe.html`), so equal input gives equal bytes.

## Public API

| Export                                                                                                                                        | What it does                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `main(argv, io, deps?)`, `run({ command, args })`                                                                                             | the CLI in-process; returns the exit code                                                               |
| `runCapture(options, deps?)`                                                                                                                  | the capture command without flag parsing: `{ exitCode, report, bundle? }`                               |
| `captureMain`, `captureArgs`, `captureCommand`, `rootCommand`                                                                                 | the citty command definitions                                                                           |
| `createBundle(input)`, `zipBundle(files)`, `unzipBundle(zip)`, `writeBundle(bundle, out, cwd?)`, `outputKind(out)`                            | the bundle writer                                                                                       |
| `buildBundleReport(components)`, `sortDiagnostics`, `autoLayoutCoverage`                                                                      | `report.json` (`BundleReport`)                                                                          |
| `countNodes`, `assetRefs`, `fontUses`, `featuresOf`, `entryMethod`                                                                            | facts the manifest records                                                                              |
| `loadConfig`, `resolveConfig`, `findConfigFile`, `readConfigFile`, `mergeConfig`, `withoutPointer`, `CONFIG_FILES`                            | config loading                                                                                          |
| `defineConfig` (also `@holotype/cli/config`)                                                                                                  | types a `holotype.config.ts`                                                                            |
| `ExitCode`, `exitCodeFor(diagnostics, failOn?)`                                                                                               | 11 §3.2 exit codes                                                                                      |
| `RunReport`, `RunComponent`, `countByCode`                                                                                                    | the `--json` document (12 §7.1, plus `run.command`, `run.exitCode`, `output`, `failure`, `diagnostics`) |
| `formatCaptureSummary`, `formatDiagnostic`, `helpLink`, `displayPath`, `formatBytes`                                                          | human output                                                                                            |
| `resolveMapperSettings`, `resolveSource`, `redactSource`, `storybookLinks`, `mapWork`, `metaInput`, `checkStories`, `makeRunId`, `configHash` | pipeline steps                                                                                          |
| `serve`, `exportBundle`                                                                                                                       | not built yet (`NotImplementedError`)                                                                   |

## Scripts

| Script     | Does                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test`     | unit tests, with fake Storybook and capturer over the capture goldens                                                                                                |
| `test:e2e` | builds the CLI (Turborepo), then runs the `holotype` binary against the fixture Storybook in headless Chromium. `HOLOTYPE_STORYBOOK_STATIC` reuses a built Storybook |
