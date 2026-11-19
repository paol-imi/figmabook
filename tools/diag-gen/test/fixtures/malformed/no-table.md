# 12 — Quality (fixture)

A table before the catalog looks like a catalog row but is not one:

| Code | Severity |
|---|---|
| `SB_NOT_IN_CATALOG` | error |

<a id="diagnostics"></a>

## 6. Diagnostics catalog

### 6.1 Structure and process

Prose that mentions `SB_INDEX_UNREACHABLE` and a table that is not part of the catalog.

### 6.2 Catalog

**5 codes in 2 domains:** SB 3 · CAP 2.

Columns: **Emitted by** is the package that raises the code.

#### Storybook (SB_) — 3

| Code | Severity | Emitted by | Meaning | User remedy | Defined in |
|---|---|---|---|---|---|
| `SB_INDEX_UNREACHABLE` | error | `storybook` | `index.json` could not be loaded; aborts the run (`data.fatal: true`, exit 3) | Check the URL and that Storybook is running | [03](03-storybook.md) |
| `SB_NOT_A_STORYBOOK` | error | `cli` (hosted), `plugin` | the target has no `index.json` plus `iframe.html` | Point Holotype at the root URL of a Storybook. See [the guide](03-storybook.md) | [13](13-security-legal.md#hosted) |
| `SB_ARG_UNKNOWN` | warning | `planner` | a configured arg has no argType; it was dropped | Fix the arg name in config, or add an argType for it! | [03](03-storybook.md) |

#### Capture (CAP_) — 2

Notes before the table become the domain's notes,
even across two lines.

<a id="capture-anchor"></a>

A domain without its table.

---
