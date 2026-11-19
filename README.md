# Holotype

Holotype turns a **Storybook** into a **native, editable, synced Figma component library**: real component sets with variants, component properties, auto layout, variables with modes, and nested instances. Re-imports update components in place, and designers keep their overrides.

It also closes the loop the other way. From a Figma branch file it extracts a **deterministic Design Change Request**, a precise and verifiable prompt for the AI coding agent of your choice. The agent writes the code, and Holotype checks the result by regenerating Figma from it.

> **Status:** Phase 0 (foundations). Nothing user-facing works yet. The plan lives in [`docs/plan/README.md`](docs/plan/README.md).

## Repository

| Path             | Contents                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `packages/*`     | the `@holotype/*` packages (see [plan §6](docs/plan/README.md#6-architecture-at-a-glance)) |
| `tools/fidelity` | fidelity scoring                                                                           |
| `docs/plan`      | the master plan and its chapters                                                           |

```sh
pnpm install
pnpm build && pnpm test && pnpm lint && pnpm typecheck && pnpm check:deps
```

Requires Node ≥22.12 (developed on Node 24, see `.nvmrc`) and pnpm 10. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
