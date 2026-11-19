# @holotype/sandboxes

Generates throwaway Storybook projects ("sandboxes") for spikes and compatibility checks
(BUILD B-16, D-26). A sandbox is a template (framework + one Storybook minor line, every
dependency pinned) plus optional overlays (story sets a spike needs). Sandboxes go to
`tools/sandboxes/.out/<name>/`, which git ignores; they are not workspace packages and install
with `pnpm install --ignore-workspace` from the local store.

```sh
pnpm -F @holotype/sandboxes list
pnpm -F @holotype/sandboxes gen react-vite@10.6 --overlay faults --build storybook-static
```

## Templates and overlays

| Id                | What                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-vite@10.6` | `@storybook/react-vite` 10.6.7, React 19.3.1, Vite 8.3.8 (the `fixtures/ds-react` pins), sandbox Button                                               |
| overlay `faults`  | S-07 failure injection: `Faults/Probe` (throws, hangs, slow loader, console error, play failure), `Faults/Unstable`, `Faults/Slots` (React-node args) |

### TODO (hardening, not built yet)

- [ ] `react-vite@11`: Storybook 11 beta: `docgenServer`, `manifests/components.json`, the
  `services/core/docgen` merge (B-140; D-11 tracks 11 from beta).
- [ ] `react-vite@9.1`: the 9.1 smoke cell (B-141, D-11 best-effort).
- [ ] `react-vite@8.6`: the 8.6 smoke cell (B-141, D-11 best-effort).

`gen` refuses these ids with the work item that adds them. Adding one is a new entry in
`src/templates.ts` and, where the files differ, a new folder under `templates/`.

## Command line

`gen <template> [options]`

| Option                  | Does                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `--overlay <id>`        | add an overlay (repeatable, applied in order)                                      |
| `--storybook <version>` | an exact Storybook version on the template's line, e.g. `10.6.2`; default: the pin |
| `--out <dir>`           | parent folder; default `tools/sandboxes/.out`                                      |
| `--force`               | regenerate an earlier sandbox: its files are replaced, `node_modules` stays        |
| `--install`             | `pnpm install --ignore-workspace --prefer-offline` (`--offline`: store only)       |
| `--build <dir>`         | `storybook build` into `<dir>` (relative to the sandbox); implies `--install`      |

The generator never writes into a folder that has no `holotype-sandbox.json` (the manifest of
what it generated). Child processes run without the parent's `npm_*` / `PNPM_*` variables and
`NODE_PATH`, with `CI=true` and Storybook telemetry off.

## API

| Export                                                                                  | Does                                                                               |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `planSandbox(spec)`                                                                     | the files of a sandbox (template, overlays, generated `package.json`), sorted      |
| `generateSandbox(options)`                                                              | writes them plus `holotype-sandbox.json`; returns `{ dir, name, files, manifest }` |
| `installSandbox(dir, { offline? })`, `buildSandbox(dir, out)`                           | install and static build with the sandbox's own Storybook CLI                      |
| `startDevServer(dir, { port?, readyTimeoutMs? })`                                       | `storybook dev` on 127.0.0.1; resolves once `index.json` is served; `stop()`       |
| `TEMPLATES`, `PLANNED_TEMPLATES`, `OVERLAYS`, `findTemplate`, `resolveStorybookVersion` | the registry                                                                       |
| `sandboxEnv`, `freePort`, `storybookBin`, `run`                                         | helpers                                                                            |
