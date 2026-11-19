# @holotype/diag-gen

Generates the diagnostics registry from the catalog tables of [plan 12 §6.2](../../internal/plan/12-quality.md#diagnostics), and checks that the generated output is current (BUILD B-02).

| Command           | Does                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm diag:gen`   | writes `packages/shared/src/diagnostics/catalog.generated.ts` and `docs/diagnostics/` (an index plus one `<CODE>.md` page per code)                           |
| `pnpm diag:check` | fails on a malformed catalog, stale or missing generated files, a page for an unlisted code, or a code literal in `packages/*/src` that is not in the catalog |

Both take `--root <dir>` to run on another checkout. They run from source with Node's type stripping, so no build is needed.

## What the parser accepts

The catalog starts at the `### … Catalog` heading after `<a id="diagnostics"></a>` and ends at the next heading of level 1–3 or `---` rule. Inside it:

- one summary line, `**N codes in M domains:** SB 27 · PLAN 43 · …`;
- per domain, a heading `#### Title (PREFIX_) — N` and exactly one table with the columns `Code | Severity | Emitted by | Meaning | User remedy | Defined in`;
- rows with a backticked `PREFIX_UPPER_SNAKE` code, a severity of `info`, `warning` or `error` (optionally followed by a qualifier in parentheses), backticked package names, non-empty meaning and remedy, and one link to the defining chapter.

Rows may be added anywhere in a table. The check fails when a domain's row count differs from its heading or from the summary line, so update both counts with the rows. Every problem is reported with its line, not only the first one.

`diag:check` also warns, without failing, when a code's **Defined in** chapter never mentions the code or lacks the linked anchor (12 §6.1).

## Code literals

The check scans `packages/<name>/src/**` for quoted literals that are a whole UPPER_SNAKE code with a catalog prefix (`'SB_RENDER_TIMEOUT'`, or `` `SB_RENDER_TIMEOUT` `` in a doc comment). Identifiers such as `Node.TEXT_NODE` are not literals. A line containing `diag-check-ignore` is skipped.

## Using the generated catalog

Emitters use `@holotype/shared`:

```ts
import { createDiagnostic, diagnostic } from '@holotype/shared';

createDiagnostic(diagnostic('SB_RENDER_TIMEOUT'), undefined, { sid });
```

`diagnostic(code)` accepts only catalog codes (`DiagnosticCode` is the generated union). Severity, remedy, emitters and the defining chapter come from the catalog. The message is the catalog's meaning, unless `packages/shared/src/diagnostics/messages.ts` has a template with `{placeholders}` for the code; then `createDiagnostic` requires exactly those params.

## Tests

`test/fixtures/valid/` holds a small catalog and its golden output (`expected/`); `test/fixtures/malformed/` holds one broken catalog per error case, each with its golden error list (`*.errors.txt`). Update goldens on purpose with `pnpm -F @holotype/diag-gen test -u`.
