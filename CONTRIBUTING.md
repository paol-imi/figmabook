# Contributing to Holotype

Thanks for helping. The plan in [`docs/plan/`](docs/plan/README.md) is the spec. The decisions in its README §5 are binding. If your change disagrees with one, propose a change to the plan first.

## Setup

```sh
nvm use            # Node 24 (any Node ≥22.12 works)
corepack enable    # pnpm version from package.json `packageManager`
pnpm install
```

| Command           | What it does                                                    |
| ----------------- | --------------------------------------------------------------- |
| `pnpm build`      | builds every package (tsup; create-figma-plugin for the plugin) |
| `pnpm test`       | runs Vitest in every package                                    |
| `pnpm lint`       | Biome lint and format check (`pnpm format` to fix formatting)   |
| `pnpm typecheck`  | `tsc` in every package, strict                                  |
| `pnpm check:deps` | dependency-cruiser: package boundaries from plan 02 §6.2        |

Workspace packages resolve to each other's TypeScript sources through the `@holotype/source` export condition, so tests and type checks don't need a build first.

To try the plugin, run `pnpm --filter @holotype/plugin build`. Then, in the Figma desktop app, choose _Plugins → Development → Import plugin from manifest…_ and pick `packages/plugin/manifest.json`.

## Rules of the road

- **TypeScript strict, ESM only.**
- **Respect package boundaries.** `shared`, `ir`, `layout-sim`, `mapper` and `dcr` run everywhere, including the Figma sandbox: no Node built-ins, no Node globals. `dcr` is also deterministic: no clock, no randomness, no network. Lint and `check:deps` enforce this.
- **Diagnostics are API.** Define new codes once, in `packages/shared/src/diagnostics.ts`, with a plain-language message and a remedy. Never rename a code; deprecate it.
- **Changesets.** Every change to a published package needs a changeset: run `pnpm changeset`.
- **Tests.** Every behavior change comes with a Vitest test. Golden values (hashes, canonical JSON) change only on purpose.

## Developer Certificate of Origin

Contributions are accepted under the [Developer Certificate of Origin 1.1](https://developercertificate.org/) (DCO). By signing off a commit, you certify that you wrote it, or otherwise have the right to submit it under this project's MIT license.

Sign off every commit:

```sh
git commit -s -m "feat(ir): add the tokens schema"
```

This adds a trailer with the name and email from your git config:

```
Signed-off-by: Your Name <you@example.com>
```

Commits without a sign-off can't be merged. To fix the most recent commit, run `git commit --amend -s`. For older commits, run `git rebase --signoff main`.
