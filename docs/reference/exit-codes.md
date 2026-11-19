# Exit codes

::: warning Planned
The CLI is not released yet. These codes are part of its planned contract, so scripts and CI jobs can rely on them once it ships.
:::

Every `holotype` command exits with one of these codes.

| Code | Meaning |
|---|---|
| `0` | Success. Warnings are allowed. |
| `1` | Completed with errors in some components. A partial bundle was written; see the report. |
| `2` | Usage or configuration error: invalid flags, or the config failed validation. |
| `3` | Storybook is unreachable, or its story index cannot be loaded (`SB_INDEX_UNREACHABLE`, `SB_PREVIEW_INIT_TIMEOUT`). |
| `4` | Browser failure: Chromium is missing or crashed. |
| `5` | A quality gate failed: `--fail-on`, a fidelity threshold, or a budget was exceeded. |
| `6` | Network or authentication failure: the registry, a login, or the Figma token. |
| `130` | Interrupted (Ctrl+C). The partial cache is kept. |

## Change request commands

`dcr` and `verify` use the same codes:

- `verify` exits with `0` only if every item is `implemented`, `declined` or `not-verifiable`. Otherwise it exits with `5`. See [verify statuses](/guide/concepts#verify-statuses).
- `dcr` exits with `5` when the request needs an approval it does not have, and with `6` when the Figma token is missing or rejected.

Some diagnostics always lead to the same exit code:

| Diagnostic | Exit code |
|---|---|
| [`DCR_NOT_BRANCH_FILE`](./diagnostics/DCR_NOT_BRANCH_FILE) | `2` |
| [`DCR_GIT_BRANCH_MISMATCH`](./diagnostics/DCR_GIT_BRANCH_MISMATCH) | `2` |
| [`DCR_NO_SUBMITTED_REQUEST`](./diagnostics/DCR_NO_SUBMITTED_REQUEST) | `2` |
| [`DCR_NOT_APPROVED`](./diagnostics/DCR_NOT_APPROVED) | `5` |
| [`NET_FIGMA_TOKEN_MISSING`](./diagnostics/NET_FIGMA_TOKEN_MISSING) | `6` |
