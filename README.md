# Holotype

Holotype turns a **Storybook** into a **native, editable, synced Figma component library**: real component sets with variants, component properties, auto layout, variables with modes, and nested instances. Re-imports update components in place, and designers keep their overrides.

It also closes the loop the other way. From a Figma branch file it extracts a **deterministic Design Change Request**, a precise and verifiable prompt for the AI coding agent of your choice. The agent writes the code, and Holotype checks the result by regenerating Figma from it.

> **Status:** Phase 0 (foundations). Nothing user-facing works yet. The plan lives in [`internal/plan/README.md`](internal/plan/README.md).

## Repository

| Path             | Contents                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `packages/*`     | the `@holotype/*` packages (see [plan §6](internal/plan/README.md#6-architecture-at-a-glance)) |
| `tools/fidelity` | fidelity scoring                                                                               |
| `docs`           | the public documentation site (VitePress), including the generated diagnostics pages           |
| `internal`       | internal notes, never published: the master plan, research and spike reports                   |

```sh
pnpm install
pnpm build && pnpm test && pnpm lint && pnpm typecheck && pnpm check:deps
```

Building needs Node ≥22.18 (the published packages run on ≥22.12; developed on Node 24, see `.nvmrc`) and pnpm 10. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
