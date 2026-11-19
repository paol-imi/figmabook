# Internal notes

Material for the people building Holotype. It is **never published**: the documentation site is built from [`docs/`](../docs/README.md) only, and nothing here is inside its source root.

| Folder | What it holds |
|---|---|
| [`plan/`](plan/README.md) | The master plan: binding decisions (README §5), the chapters, the build breakdown ([BUILD.md](plan/BUILD.md)) and the plan review. The diagnostics catalog in [12 §6.2](plan/12-quality.md#diagnostics) is the source of `pnpm diag:gen`. |
| [`research/`](research/) | Research briefs the plan cites. |
| `spikes/` | Spike reports (S-xx): what a spike measured and what the plan took from it. |

The public docs are in [`docs/`](../docs/README.md): the guide, the reference and the generated diagnostics pages. Their links into this folder render as plain text on the site unless it is built with `HOLOTYPE_SITE_PLAN_LINKS=repo` (for a public repository only). Do not copy text from here into `docs/` without checking that it may be public.
