# Concepts

::: warning Planned
These concepts describe the design of Holotype. Names and details may change before the first release.
:::

## Library file and branch file

Holotype works with two kinds of Figma files.

| | Library file | Branch file |
|---|---|---|
| What it is | The main component library, synced from `main` | A Figma branch of the library (or a duplicated file), linked to one git feature branch |
| A designer edit to a managed component is | a conflict: kept by default and flagged | intent: kept and recorded as a proposed change |
| Holds a baseline | no | yes |
| Can produce a change request | no | yes |

A **branch file** is linked to a git branch and to the commit its components were generated from. The link is stored in two places: inside the Figma file, and in the repository as `.holotype/branches/<branch>.json`, which is committed so other machines and CI can find it.

The default is a Figma-native branch of the library file, which needs a Figma plan with branching. On other plans, a duplicated file works as a fallback.

Branch files are never merged back into the library. When the code is merged, the Figma branch is archived and the library is re-synced from code.

### Managed nodes

Every layer that Holotype creates carries a stable key. These are **managed** layers. Layers a designer adds inside a managed component are left alone. A designer can also lock a layer ("Keep as designed") so sync never changes it and it is never treated as a request.

## Baseline {#baseline}

When the plugin imports a branch file, it stores a **baseline snapshot** for every variant: the values it actually applied, read back from Figma after building.

The change request compares the current file with this snapshot, using the same normalization. That is why:

- every reported change is a real edit, not a rounding difference in Figma;
- each changed value can point back to the code that produced it (the source file, CSS rule and `var()` chain recorded during capture);
- the file plus the repository is enough to extract a request later, on another machine.

When code moves on, `holotype branch refresh` re-syncs the branch file. Untouched layers update and their baseline moves forward. Edited layers keep the designer's value.

## Design change request {#dcr}

A **design change request** (DCR) is a JSON document, `dcr.json`, plus a Markdown prompt rendered from it, `prompt.md`. Both are written to `.holotype/requests/<id>/` and committed with the code.

Properties of a DCR:

- **Deterministic.** The same Figma file and the same baseline give a byte-identical DCR. No language model is involved.
- **Hashed.** The request carries a hash of its content. The CLI checks it when importing, and an optional approval is bound to it.
- **Self-contained.** Each item has its code location, a before/after table with tokens, an acceptance criterion and images.
- **Reviewable.** It starts with a one-page summary a non-developer can read and approve.

### Item kinds {#item-kinds}

Each change becomes one item. The first release (the Loop slice) covers the kinds marked **slice**. The others come later.

| Kind | Detected when | What the agent does | When |
|---|---|---|---|
| `component.modified` | Fields of a managed layer changed (fills, padding, radius, text, a variable binding…) | Change the CSS or markup that produces these values | slice |
| `variant.added` | A new variant appears, for example a duplicated `Variant=Primary` renamed to `Variant=Danger` | Add the arg value and a story for it | slice |
| `property.added`, `property.changed` | A new or renamed component property, or a new value on a variant axis | Add or rename the prop in code; add stories | slice |
| `component.new` | A local component without a Holotype key | Create a new component and a story | slice |
| `screen` | A new top-level frame built from instances, frames and text | Compose existing components into the screen | slice (one variant per screen); breakpoints, states, interactions, copy and accessibility later |
| `variant.removed` | A baseline variant is missing | Remove it or confirm it is deprecated (asked, never automatic) | later |
| `node.added`, `node.removed` | A layer added or removed inside a managed variant | Add or remove the element | later |
| `instance.detached`, `instance.deviation` | An instance was detached, or overridden beyond its properties | Extend the component, or treat it as a one-off (asked) | later |
| `instance.outdated`, `instance.deprecated` | An instance of an older or deprecated component | Use the current or replacement component | later |
| `token.changed`, `token.added` | A variable value changed or a variable was added | Change the token definitions (CSS custom properties) | later |
| `unknown` | Anything else that changed | Listed with raw before and after values | later |

Values that are not bound to a token, or that have no CSS equivalent, become **open questions** in the request. A reviewer can answer them, or the agent picks an option and records its choice.

## Verify statuses {#verify-statuses}

`holotype verify` renders the code at branch HEAD and checks every item against its acceptance criterion. Checks are done on Holotype's own scene model, field by field. Visual similarity is reported but does not decide the result.

| Status | Meaning | Next step |
|---|---|---|
| `implemented` | All checks pass | Nothing |
| `partial` | Some fields or regions differ | A follow-up request with only the remaining differences |
| `regressed` | Variants that were not part of the change now look different | Scope the change to the listed variants |
| `pending` | Nothing found: no story, no change | Back to the agent |
| `declined` | A person marked it as "won't do", with a reason | Recorded, not asked again |
| `not-verifiable` | It cannot be checked, for example a screen without a story | For information |

Verify exits with code 0 only when every item is `implemented`, `declined` or `not-verifiable`. Otherwise it exits with 5. See [Exit codes](/reference/exit-codes).

## Diagnostics

Every fallback, approximation and failure is reported as a **diagnostic** with a stable code, such as `SB_INDEX_UNREACHABLE` or `DCR_VALUE_UNTOKENIZED`. Each code has a page with what happened and what to do. See the [diagnostics reference](/reference/diagnostics/).
