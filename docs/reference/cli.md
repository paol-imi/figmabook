# CLI commands

::: warning Planned
The CLI is not released. This is the planned command set. Commands marked **later** are not part of the first release (the Loop slice); they come with the hardening stages of the [roadmap](/roadmap).
:::

The CLI is the npm package `@holotype/cli`. Its binary is `holotype`, with the short alias `holo`. Exit codes are listed in [Exit codes](./exit-codes).

## Global flags

These flags work on every command.

| Flag | Meaning |
|---|---|
| `-c, --config <path>` | Config file. By default Holotype searches upward for `holotype.config.{ts,mts,js,mjs,json}`. |
| `--storybook <url\|dir>` | Use this Storybook instead of `storybook.source` from the config. |
| `--json` | Print one JSON document on stdout at exit. Human-readable logs go to stderr. |
| `--ndjson` | Stream events as JSON lines on stdout, for CI and agents. |
| `--log-level <level>` | `silent`, `error`, `warn`, `info` (default), `debug` or `trace`. |
| `--no-color`, `--no-progress` | Turned off automatically when `CI=true` or the output is not a terminal. |
| `--cwd <dir>` | Working directory. |
| `-y, --yes` | Accept defaults and never prompt. Implied when the input is not a terminal. |

Holotype never prompts when stdin is not a terminal, or when `--yes` or `CI` is set. If required input is missing, it exits with code 2 and a diagnostic.

## Setup and health

| Command | What it does | Key flags |
|---|---|---|
| `init` | Inspects the project, writes `holotype.config.ts`, installs the pinned Chromium, adds `@holotype/cli` and a `holotype` script, and adds the three `.gitignore` lines for `.holotype/`. | `--framework`, `--source <url\|dir>`, `--with-addon`, `--force` |
| `doctor` | Checks the environment and the Storybook: Node.js version, Chromium, config validity, Storybook reachability and version, a sample render, fonts, ports, cache. | `--fix` (safe fixes only), `--json` |
| `install-browser` | Downloads the pinned Chromium. `init` runs it for you. | `--force` |
| `login` | Stores credentials: a login for a private Storybook (through a browser window), the registry, or a read-only Figma token for change requests (kept in the OS keychain). | `--storybook <url>`, `--figma`, `--registry`, `--logout` |
| `telemetry` | Shows or changes telemetry. Telemetry is off by default. | `status`, `enable`, `disable` |

## Library sync

| Command | What it does | Key flags |
|---|---|---|
| `list` | Lists components and stories, with the planned variant axes and properties. | `--include/--exclude <glob>`, `--plan`, `--only <id>`, `--tree` |
| `capture` | Renders, captures and maps components. Writes a bundle (`.holotype/out/<runId>.holotype.zip`) and an HTML report. | `--only <id,...>`, `--story <id>`, `--static <dir>`, `--no-cache`, `--concurrency <n>`, `--viewport <WxH>`, `--fail-on <warn\|error>`, `--budget <n>` |
| `export` | Re-packages a cached run as a bundle, without rendering again. | `--file <path>`, `--only <id,...>`, `--check-plugin-compat` |
| `prune` | Lists deprecated components that are older than `sync.pruneAfterDays`, for removal. | `--json` |
| `cache` | Inspects or cleans the local cache. | `cache ls`, `cache prune [--older-than 14d]`, `cache clear`, `cache stats` |
| `serve` **later** | Runs a local server the plugin can connect to, instead of importing files. | `--port <p>`, `--watch`, `--revoke`, `--pair-url` |
| `publish` **later** | Publishes a bundle and a `latest.json` pointer. | `--to <url\|s3://…\|gh-pages>` |
| `status` **later** | Compares a library file with the current Storybook. | `--figma-file <key>` |

Example `capture` summary:

```txt
Holotype 0.4.0 · Storybook 10.6.7 (react-vite) · Chromium 14x.0
  ✔ components/button        12 variants  3 props  fidelity 0.993  2 warn
  ✔ components/input         18 variants  4 props  fidelity 0.988  0 warn
  ✖ components/date-picker    —           SB_STORY_ERROR (see report)
Bundle: .holotype/out/<runId>.holotype.zip (2.1 MB) · report: .holotype/out/report.html
Warnings by code:  FONT_MISSING ×1 · TEXT_LINE_MISMATCH ×1
```

## Branch files

See [Concepts](/guide/concepts#library-file-and-branch-file) for what a branch file is.

| Command | What it does | Key flags |
|---|---|---|
| `branch start` | On a git feature branch: captures from the dev server and prepares a Figma branch file in proposal mode. | `--figma <url>`, `--dev-server <url>`, `--only <id,...>` |
| `branch link` | Links an existing Figma branch or duplicated file to the current git branch. | `<figma-url>`, `--kind figma-branch\|duplicate` |
| `branch refresh` | Re-syncs the branch file from branch HEAD. The baseline moves forward and implemented items disappear. | `--only <id,...>` |
| `branch status` | Shows the link and how far the code has moved since the baseline. | `--json` |
| `branch close` | Marks the branch as merged and prints what to do in Figma (archive the branch, re-sync the library). | `--archive` |

## Change requests

See [Concepts](/guide/concepts#dcr) for what a change request contains.

| Command | What it does | Key flags |
|---|---|---|
| `dcr import` | Imports a downloaded `request.zip` and writes `.holotype/requests/<id>/`. This is the guaranteed path in the first release. | `dcr import <request.zip>` |
| `dcr` | Reads the request submitted in the linked Figma file and writes `.holotype/requests/<id>/`. Needs a Figma token. Planned for the first release if a pending technical check passes. | `--pull [<figma-url>]`, `--scope changed\|ready\|page:<name>\|all`, `--part all\|components\|screens`, `--out <dir>`, `--with-comments`, `--format json,md`, `--split` |
| `dcr prune` | Deletes old requests from `.holotype/requests/`. | `--keep latest` |
| `verify` | Renders the code at HEAD again and checks every item of a request. Writes `verify.json`. | `--dcr <id>`, `--screens`, `--decline <itemId> --reason <text>`, `--json` |

`verify` ends with the next step, for example:

```txt
2 partial → follow-up written to .holotype/requests/9b…/prompt.md.
Give it to your agent, then run holotype verify.
```

Errors name the fix. For example:

| Situation | Message |
|---|---|
| No Figma file is linked on this computer | "No Figma file is linked to &lt;branch&gt; on this computer. Run `holotype branch link <url>`." |
| The git branch differs from the request's | "Run `git switch <branch>`, then retry. Or download the request." |
| Nothing was submitted yet | "Nothing was submitted from this file yet. Ask the designer to press Submit." |
| No Figma token | "Holotype needs a read-only Figma token. … then run `holotype login --figma`." |

## Agents and integrations (later)

| Command | What it does | Key flags |
|---|---|---|
| `mcp` **later** | Runs an MCP server over stdio, so AI agents can read change requests and check them. | `--allow-apply` |
| `codeconnect` **later** | Generates Figma Code Connect files from the last import report. | `--map <file>`, `--out <dir>`, `--framework react\|html` |
