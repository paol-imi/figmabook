# Roadmap

::: info Current stage: L0, Skeleton
Holotype is pre-release. The foundations are being built: the data schemas, the diagnostics catalog, test fixtures, and first versions of the Storybook adapter, capture, mapper and Figma plugin. None of it is released or ready for use.
:::

Work is ordered so that the whole loop works end to end as early as possible, on a narrow scope, before fidelity and scale are broadened.

## Loop slice: L0 to L5 {#loop-slice}

The Loop slice is a thin but real version of the whole loop: git branch → Figma branch file → designer edits → Submit → change request → AI agent → `holotype verify`. It targets React with Vite on Storybook 10. Each stage ends with a demo.

| Stage | Name | Demo at the end of the stage | Status |
|---|---|---|---|
| **L0** | Skeleton | A story appears in Figma as frames and text. | **in progress** |
| **L1** | Components | Components appear as Figma component sets, with variant, boolean and text properties. Re-importing makes no changes. | planned |
| **L2** | Tokens and layout | Flexbox becomes auto layout, and variables are bound to `var()` values from your CSS. | planned |
| **L3** | Branch file | A designer edit shows up in the Changes list of a branch file. | planned |
| **L4** | Change requests | Submit produces a `prompt.md` with file and line provenance. | planned |
| **L5** | Loop (**M-Loop**) | The full loop with a real AI agent, checked by `holotype verify`. | planned |

### What the slice covers

| Area | In the slice |
|---|---|
| Storybook | Storybook 10, React and Vite; static builds and dev servers; `args`, `argTypes` and `parameters.holotype` |
| Variants | stories as variants, plus declared args; variant, boolean and text properties |
| Capture | light DOM and open shadow DOM; solid fills, borders, radius, simple shadows; Latin text; inline SVG; PNG and JPEG images |
| Layout and tokens | flexbox to auto layout, with a fallback to absolute positions; CSS custom properties to one variable collection |
| Plugin | import from a file; font check; idempotent re-import that keeps designer overrides |
| Branch files | `branch start`, `link` and `refresh`; proposal mode; embedded baseline; Changes list |
| Change requests | `component.modified`, `variant.added`, `property.added`, `property.changed`, `component.new`, `screen` (one variant per screen); `prompt.md`; `dcr import` |
| Verify | `holotype verify` v1: field and token checks, new variants and components, properties, regressions |

### M-Loop exit criteria

The slice is done when:

1. The loop runs on a real branch with a real AI agent. `holotype verify` exits with 0, and a human review of the pull request finds no unrelated changes.
2. A designer accepts 10 to 15 real components.
3. Change requests are byte-identical across repeated, shuffled runs, and the plugin and CLI compute the same hash.
4. At least two AI agents implement at least 70% of items correctly on the first try, on a test corpus.
5. A comparison against an alternative design-to-code workflow is done and recorded.
6. Designers have tested submitting and handing off across two computers.

## Hardening: M1 to M5

After the slice, each area is broadened. These groups can start once the slice stage they extend is done, but they never block the slice.

| Milestone | Group | What it adds |
|---|---|---|
| **M1** | Fidelity | The rest of CSS: gradients, masks, blend modes, filters, transforms, pseudo-elements, form controls, CJK and right-to-left text, icon fonts |
| **M2** | Native structure | Wrapping and grid auto layout, cleaner layer trees, better naming |
| **M3** | Variants at scale | Automatic arg classification, interaction states (hover, focus, pressed), large component sets, documentation frames and pages |
| **M4** | Sync UX | Diff preview, conflict resolution, renames and deprecation |
| **M4.5** | Change requests complete | Screens with breakpoints and states, interactions, copy and accessibility; outdated and deprecated instances; optional approval; an MCP server with change request tools for agents; pairing the plugin with a local CLI server |
| **M5** | Tokens complete and compatibility | Theme modes, styles, matching an existing library, token change items; Storybook 8 and 9, and Storybook 11 when it is released |

## After M5

| Milestone | Name | What it adds |
|---|---|---|
| **M6** | Composition | Nested components as instances, icons as instance-swap properties, slot properties |
| **M7** | Automation | Code Connect files, MCP sync tools, `holotype publish` and `holotype status`. A GitHub Action, a bundle registry and a Storybook addon wait until a second team uses Holotype. |
| **M8** | Private organization plugin | The plugin published privately to an organization, with automatic updates |

A public release (a Figma Community listing, published packages and benchmarks) is optional and would come after M8.

## Follow the work

The design documents and work breakdown live in the source repository. This site is updated as stages land.
