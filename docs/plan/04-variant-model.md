# 04: Component & variant model

> **Package:** `@holotype/planner` (Node). **Inputs:** `StoryMeta`/`ProjectMeta` from [03](03-storybook.md), and config. **Outputs:** a `ComponentPlan` per component, consumed by `capture` ([05](05-capture.md)) and `mapper` ([07](07-mapping.md)).
> **Governing decisions:** D-12 (variant source priority), D-13 (property classification by render-and-diff), D-14 (pseudo-states), D-24 (capture defaults).

This chapter decides **which renders to make** and **what each arg becomes in Figma**. The principle is that a Figma component set must look like one a strong designer would build:

- **VARIANT axes** only for style-changing, enumerable dimensions.
- **BOOLEAN** properties for show/hide.
- **TEXT** properties for labels.
- **INSTANCE_SWAP** properties for icons and sub-components.
- **SLOT** properties for free content.

story.to.design turns every arg into a variant axis and multiplies them all together. That is the main weakness we fix ([01](01-landscape.md)).

---

## 1. Model

```ts
type ArgClass = 'VARIANT' | 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'SLOT' | 'FIXED' | 'IGNORED';

interface ComponentPlan {
  sid: string;
  identity: ComponentIdentity;                 // [03 §7.2]
  baseStoryId: string;                         // story whose initialArgs define the default variant
  axes: Axis[];                                // Figma VARIANT properties, ordered
  properties: PlannedProperty[];               // BOOLEAN/TEXT/INSTANCE_SWAP/SLOT
  fixedArgs: Record<string, unknown>;          // applied to every render
  variants: PlannedVariant[];                  // the renders that become ComponentNodes
  probes: ProbeRender[];                       // extra renders used only for classification (not emitted)
  modes: ModePlan | null;                      // themes → variable modes ([08])
  layoutGrid: { columns: string[]; rows: string[] };   // axis ids placed on x / y in the set ([09])
  budget: BudgetReport;
  provenance: Record<string, ProvenanceTag>;   // why each decision was taken (shown in UI / report)
  diagnostics: Diagnostic[];
}

interface Axis {
  id: string;                                   // stable, e.g. 'arg:variant', 'state', 'story', 'viewport', 'global:theme'
  name: string;                                 // Figma property name, e.g. 'Variant', 'State', 'Size'
  source: { kind: 'arg'; arg: string } | { kind: 'story' } | { kind: 'state' }
        | { kind: 'viewport' } | { kind: 'global'; global: string } | { kind: 'custom'; id: string };
  values: AxisValue[];                          // ordered; values[0] is the default
}
interface AxisValue {
  label: string;                                // Figma value string (sanitized, unique within axis)
  bind: { args?: Record<string, unknown>; storyId?: string; state?: PseudoState;
          viewport?: { width: number; height?: number }; globals?: Record<string, unknown> };
}

interface PlannedProperty {
  kind: 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'SLOT';
  name: string;                                 // Figma property display name
  arg: string;
  defaultValue: boolean | string | { ref: string /* sid or icon asset key */ };
  preferredValues?: { ref: string; label: string }[];     // INSTANCE_SWAP / SLOT
  verification: VerificationResult;                       // §4
}

interface PlannedVariant {
  vk: string;                                   // variant key (glossary)
  values: Record<string, string>;               // axisId → AxisValue.label
  render: { storyId: string; args: Record<string, unknown>; globals: Record<string, unknown>;
            state?: PseudoState; viewport: { width: number; height: number }; remount?: boolean };
  isDefault: boolean;
}

type PseudoState = 'hover' | 'focus' | 'focus-visible' | 'active' | 'focus-within' | 'visited';
type ProvenanceTag = 'config' | 'parameters' | 'stories' | 'argTypes' | 'verified-diff' | 'heuristic' | 'compat:s2d' | 'compat:chromatic';
```

**Invariants:**

- Every `PlannedVariant` has exactly one label per axis.
- Label tuples are unique within a set. Figma requires unique combinations, and `combineAsVariants` keys on the name `A=x, B=y` ([09](09-plugin.md)).
- No axis has fewer than 2 values. A 1-value axis is folded into `fixedArgs`.
- The default variant sits at the top-left position, so it is `ComponentSetNode.defaultVariant`. It is the variant whose labels are all `values[0]`.

---

## 2. Variant sources and priority (D-12)

They are resolved per component, highest priority first. A higher source *replaces* a lower one for the axes it defines. Sources do not merge their value lists.

| Priority | Source | Notes |
|---|---|---|
| 1 | `holotype.config.ts` `components[<sid>]` | Curated by DS engineers outside the stories |
| 2 | `parameters.holotype` (story > meta > project, merged by Storybook) | Typed by the optional addon (§9) |
| 2c | compat: `parameters.s2d.variantProperties`, `parameters.chromatic.modes` | Read only if no `holotype` params exist (§10) |
| 3 | **Stories-as-variants** | Default when the component has ≥2 stories that differ only in args |
| 4 | **Args matrix** from argTypes | Default when there is a single story, or `strategy: 'args'` |

`parameters.holotype.strategy` selects the source explicitly: `'auto' | 'stories' | 'args' | 'curated'`. The default is `'auto'`, which follows the table.

### 2.1 Stories-as-variants

Most design systems already curate meaningful states as stories (`Primary`, `Secondary`, `Large`, `Disabled`). Using them avoids explosion and respects author intent.

**Algorithm:**

```ts
function planFromStories(stories: StoryMeta[], base: StoryMeta): AxisCandidates {
  // 0. Eligible: same sid, not playLocked (unless play:'rerun'), not tagged !figma, same component ref.
  // 1. Normalize each story to its full arg set: {...base.initialArgs-defaults, ...story.initialArgs}.
  //    Also normalize story-level globals.
  // 2. Diff every story against `base` (the story named Default|Primary|Basic|Playground, else the first
  //    in index order, else config.baseStory).
  const diffs = stories.map(s => ({ s, d: diffArgs(base.args, s.args), g: diffGlobals(base, s) }));
  // 3. Try "arg-explained" stories: if every non-base story differs from base in exactly ONE arg
  //    that is enumerable (boolean / options / small set of literal values), then those args become
  //    candidate axes whose values are {base value} ∪ {values used by stories}.
  //    Example: Primary(base) / Secondary{variant:'secondary'} / Large{size:'lg'} / Disabled{disabled:true}
  //      → axes Variant{primary,secondary}, Size{md,lg}, Disabled{false,true} (classification may turn
  //        Disabled into a State value, §6.2, or a BOOLEAN, §4).
  // 4. Otherwise (stories differ in several args or in non-enumerable args, or in render functions),
  //    fall back to a single "Story" axis whose values are story names in index order.
  // 5. Hybrid: arg-explained stories become axes; the rest are appended as values of a "Story" axis
  //    only if ≤ config.maxStoryAxisValues (default 8); otherwise they become separate components
  //    named "<Component>/<Story>" (PLAN_STORY_SPLIT).
}
```

**Edge cases:**

- **Custom `render` functions.** These are detected when `parameters.docs.source.code` differs or the story has a `render` key (the `$fn` marker on `render`). The rendered tree may differ structurally, so these stories go to the Story axis and never into arg axes.
- **Combining axes.** When stories are combined into arg-derived axes, the cross product of those axes may include combinations no story rendered, for example `secondary` + `lg`. Whether to render them is set by `stories.fillMatrix`: `'none' | 'budget' | 'full'`, default `'budget'`. With `'budget'` they are rendered if the total stays within budget (§5). Filled variants are tagged `provenance: 'argTypes'`.
- **Different viewports or globals.** Stories with different story-level `globals` contribute global axes, or modes (§7).

### 2.2 Args matrix

Candidate axes come from argTypes whose control is `boolean`, `radio`, `inline-radio`, `select` or `inline-check`, or whose `type.name==='enum'`, or that have `options`/`mapping`. Exclusions:

- `table.category ∈ {events, outputs, slots, methods, expose}`
- functions (`$fn` markers or `type.name==='function'`)
- `table.disable`, `control:false`, and anything in `parameters.controls.exclude` or outside `include`
- `on[A-Z]*` names
- the `{$fn}` defaults of `fn()` spies

**Enum reliability, weighed by `origin`** ([03 §4.2](03-storybook.md#metadata-extraction)):

| Origin | Treatment |
|---|---|
| `story` | Hand-written options are trusted |
| `docgen-service` / `react-component-meta` / `react-docgen-typescript` | Literal unions are trusted |
| `react-docgen` with `type.name==='other'` and a raw alias name | Not enumerable. Emit `PLAN_ENUM_UNRESOLVED` and suggest adding `options` |
| `custom-elements-manifest` | Parse the type string `'a' \| 'b'` with a tolerant parser. Anything else is not enumerable |

Booleans are *candidates*. Classification (§4) decides whether each one becomes VARIANT, BOOLEAN, a State value or FIXED.

---

## 3. Classification inputs

For each arg, `planner` first assigns a **prior** from type and naming, then **verifies** it by probe renders (§4). The prior only orders the experiments and does not decide the outcome.

| Signal | Prior |
|---|---|
| boolean named `disabled\|loading\|selected\|checked\|active\|pressed\|invalid\|error\|readOnly\|indeterminate\|open\|expanded` | VARIANT (state-like; folded into the State axis when `states.foldBooleans`, §6.2) |
| boolean named `show*\|has*\|with*\|*Visible\|icon\|leading*\|trailing*\|clearable\|dismissible` | BOOLEAN |
| boolean, other | BOOLEAN, then VARIANT |
| enum ≤12 options | VARIANT |
| enum >12 options | VARIANT, with a budget warning. Options that map to nodes via `mapping` → INSTANCE_SWAP |
| `string` / `text` control, named `label\|title\|text\|placeholder\|description\|helperText\|caption\|value\|heading` | TEXT |
| `string`, other | TEXT, then FIXED |
| `number` / `range` | FIXED (a VARIANT only if config lists values) |
| `color` | FIXED (tokens handle color; [08](08-tokens.md)) |
| `date`, `object`, `file`, arrays | FIXED |
| arg value marked `{$node}` (ReactNode/VNode), `children`, slot categories, CEM slots | SLOT, then INSTANCE_SWAP |
| `mapping` whose values are `{$node}` | INSTANCE_SWAP, then SLOT |
| `$fn` / events | IGNORED |

---

## 4. Classification by render-and-diff (D-13) <a id="classification"></a>

### 4.1 Probe protocol

Probes are extra renders of the base variant with **one** arg changed. They are captured like any variant ([05](05-capture.md)), but only a cheap **probe capture** is taken: geometry, text and paint hashes per node, with no assets. Their Capture IR is compared to the base by `diffCaptures`. Probe renders are cached exactly like variants. When a probe's arg set equals a real variant's, the capture is reused.

```ts
interface CaptureDiff {
  identical: boolean;                       // render hash equal (after normalization)
  added: NodePath[]; removed: NodePath[];   // after tree alignment ([07 §alignment])
  changed: { path: NodePath; fields: ('text'|'geometry'|'paint'|'effects'|'font'|'svg'|'image'|'visibility')[] }[];
  rootGeometryDelta: { dw: number; dh: number };
}
```

The tree alignment used here is the same algorithm used to align variants in the mapper ([07 §alignment](07-mapping.md)). The planner calls `mapper.alignTrees` (a pure function).

### 4.2 Decision rules

Rules are evaluated per arg, in this order:

**R0 IGNORED.**

- The arg is a function or event → IGNORED with no probe.
- For any other arg, if every probe render is `identical` to the base, → IGNORED. The diagnostic is `PLAN_ARG_NO_VISUAL_EFFECT` (info). Typical cases are `onClick`, `aria-*` and `id`.

**R1 BOOLEAN** (`visible` binding). This needs probes with `true` and `false`.

- **Structure.** One render must be a superset of the other: `added` (or `removed`) is non-empty, and every `changed` entry is explained only by auto-layout reflow. That means geometry changes on ancestors and siblings of the added subtree, and nothing else.
- **Reflow test.** Build the superset tree with the extra subtree hidden (`visible:false`). Run `layout-sim` on the hidden-subtree tree. The positions it produces must equal the subset render within 1px. Hidden children of Figma auto layout take no space, so this is exactly the property we need.
- **Result.** If both pass, the arg becomes a **BOOLEAN** property bound to the root of the extra subtree (`componentPropertyReferences.visible`). The *superset* render is used for every variant, and the default value is the arg's base value.
- **Multiple subtrees.** If the extra content consists of several sibling subtrees, they are bound together: one property can be referenced by several layers.
- **Fallback.** If either test fails (paint or text also changes, or the layout difference cannot be explained by hiding), → VARIANT. The diagnostic is `PLAN_BOOLEAN_PROMOTED_TO_VARIANT` (info), carrying the failing field list.

**R2 TEXT** (`characters` binding). Probe with two strings:

- **Probe strings.** Use `P1 = "Holotype probe"` and `P2 = "Ag"`. Both are safe-listed for the URL fallback ([03 §5.4](03-storybook.md#render-loop-driver)), and they have different lengths so the reflow shows.
- **Locating the bound node.** Exactly one TEXT node must differ in `text`, and its characters must contain the probe string. Text transforms are compared case-insensitively; `textCase` is applied in Figma.
- **Allowed geometry changes.** All other changes must be geometry-only reflow, verified with `layout-sim`. The TEXT node uses `WIDTH_AND_HEIGHT` or `HEIGHT` auto-resize, so Figma reproduces the same reflow.
- **Result.** If both conditions hold, the arg becomes a **TEXT** property bound to that node, with default value = the arg's base value (a string).
- **Concatenated text.** Sometimes the arg appears inside a larger text, e.g. a label rendered as `"{count} items"`. If the arg string is a substring of a larger text node, emit `PLAN_TEXT_PARTIAL` (warn). The property is still created, its default value is the full node text, and the doc frame notes the template.
- **Repeated text.** If the probe string appears in more than one node, for example a tooltip that duplicates the label, the arg becomes TEXT on the first node in paint order. The others are left as static text, with `PLAN_TEXT_MULTI_NODE` (warn).
- **Failure.** If no TEXT node changes, or paint or structure changes, → FIXED (non-enumerable strings are never axes). The diagnostic is `PLAN_TEXT_UNBOUND`.

**R3 INSTANCE_SWAP.** This applies to args with `mapping`, or with options that are `{$node}` values (icons, avatars, sub-components).

- **Probes.** Render each option. Over all probes, the diffs must be confined to **one aligned subtree** (the "slot site"), and outside it only reflow is allowed.
- **Cross-component reference.** Each option's slot-site subtree must be resolvable as a component reference, in either of two ways:
  - **(a)** It is a framework boundary mapped to a Storybook component (`data-fx-cmp`, [03 §10](03-storybook.md#framework-enhancers)) or an imported icon component.
  - **(b)** It is an SVG whose normalized hash matches an icon in the icon registry. The icon registry is built from icon stories, and also by automatic extraction of SVGs used ≥2 times ([07](07-mapping.md), [09](09-plugin.md)).
- **Result.** The arg becomes an **INSTANCE_SWAP** property. `preferredValues` are the resolved components of all options. The default is the base option, and the property is bound via `componentPropertyReferences.mainComponent` on the instance at the slot site.
- **Unresolvable options.** If an option cannot be resolved, it stays an INSTANCE_SWAP with a preferred value only if at least 2 options resolve, and the rest get `PLAN_SWAP_OPTION_UNRESOLVED`. Otherwise the arg goes to VARIANT if it is enumerable and within budget, or else to FIXED.

**R4 SLOT** (Figma `SLOT` property; plugin typings ≥1.140; `ComponentNode.createSlot()`).

- **Candidates.** `children`, `{$node}` args, CEM `slots`, Vue slot categories, and `parameters.holotype.slots`.
- **Probes.** Render with the authored content (base) and with **empty** content (`undefined`, or `[]` for children).
- **Slot site.** The slot site is the deepest aligned container that contains all of the base content's nodes and none of the other nodes. If the content is a sub-tree inside a wrapper with padding, the wrapper is the slot site.
- **Result.** The slot site becomes a SLOT. Its default children are the base content (captured nodes). `slotSettings.minChildren`/`maxChildren` come from config, unset by default.
- **Fallback.** If Figma slots are unavailable (the feature flag is false in the plugin's capability probe, or an old client), the plugin degrades SLOT → a plain frame named `Slot / <name>` (`APPLY_SLOT_UNSUPPORTED`). This happens at apply time ([09](09-plugin.md)), so the planner always plans SLOT.
- **No probe value.** If the empty render throws because the content is required, or there is no way to produce an alternative, the arg still becomes a SLOT based on the base render alone, with `PLAN_SLOT_UNVERIFIED` (info).

**R5 VARIANT.** These are enumerable args that change paint, typography, effects, structure or geometry beyond reflow.

- **Values** are the option list, filtered by `if` (§5.3) and by budget (§5).
- **Dedup.** Any two option values whose probe renders are identical are merged into one value, labelled with the first. The diagnostic is `PLAN_VALUES_MERGED` (info), e.g. when `size="md"` and `size=undefined` render the same.

**R6 FIXED.** Everything else, fixed at the base value. These include free numbers, colors, objects, dates and unbound strings.

### 4.3 Interaction with variants

Classification runs **once per component**, on the base variant. Results are re-checked on a sample of non-default variants: up to 3, chosen to span the axes. This catches args that are BOOLEAN on `size=sm` but structurally different on `size=lg`. If a re-check fails, the property is demoted to VARIANT (`PLAN_PROPERTY_INCONSISTENT`, warn).

Bindings for BOOLEAN, TEXT, INSTANCE_SWAP and SLOT are established per variant by **node key**, `nk` ([07 §alignment](07-mapping.md)). Every variant contains the bound nodes under the same `nk`, which is what makes a single set-level property work ([09](09-plugin.md)).

### 4.4 Cost

The probe cost per component is about

`Σ_bool 2 + Σ_text 2 + Σ_enum |options| + Σ_swap |options| + Σ_slot 2`

probe renders. The base render and any probe that coincides with a variant are reused. A typical Button has 4 booleans, 1 label, 2 enums of 3–4 values and 1 icon of 10 options, so about 30 probes. At ≤400ms each, that is roughly 12s, once, after which everything is cached.

`classification: 'fast'` skips probes and trusts the priors (§3). This is useful on the dev-server inner loop, and it gives `PLAN_UNVERIFIED_CLASSIFICATION` (info).

---

## 5. Matrix generation and budgets

### 5.1 Strategies

`parameters.holotype.matrix`, or the config default:

| Strategy | Combinations | When |
|---|---|---|
| `full` | the Cartesian product of all VARIANT axes | small components; explicit opt-in when the product is above `budget.warn` |
| `pairwise` | covers every pair of values across axes (IPOG greedy). For 5×3×3×2 this is about 15 instead of 90 | large products. Note that the Figma set then has holes, so variant switching to a missing combination snaps to the nearest one. Emits `PLAN_SPARSE_SET` (warn) |
| `one-at-a-time` | the base plus, for each axis, each value with the other axes at their default | a quick preview |
| `curated` | exactly `parameters.holotype.variants: Array<Record<axisName, label>>` | full control |
| **`auto` (default)** | `full` if the product is ≤ `budget.max`. Otherwise, keep the full product over the top-K axes by priority, then pin the remaining axes to their default (they become FIXED, with `PLAN_AXIS_DROPPED_BUDGET`). Each dropped axis's values are listed in the report with a one-click "include" | always |

**Axis priority, for `auto`:**

1. Axes from config or parameters.
2. The `state` axis.
3. Arg axes in `table.category==='props'`, ordered by fewer values first.
4. Global axes.
5. The `story` axis.
6. Viewport.

### 5.2 Budgets <a id="budgets"></a>

| Setting | Default | Notes |
|---|---|---|
| `budget.max` | 256 variants per set | hard cap for `auto` (verify Figma perf, S-06) |
| `budget.warn` | 128 | warning in UI and report |
| `budget.hardLimit` | 1024 | refuse even with `full`, unless `--force` (`PLAN_BUDGET_EXCEEDED`, error) |
| `budget.maxProbes` | 120 per component | otherwise classification falls back to priors for the rest (`PLAN_PROBE_BUDGET`) |

story.to.design has shown 2,160 variants importing, which is slow. Our defaults favour usable sets.

### 5.3 Conditional args

`argTypes[x].if = {arg|global, truthy|exists|eq|neq}` (`csf/includeConditionalArg.ts`):

- For every planned variant, drop args whose condition is false. This means they are not passed, and the variant's FIXED value is unset.
- If an axis's arg is conditionally excluded for some combinations, those combinations collapse. Example: `iconPosition` only applies when `icon` is truthy, so `{icon:none, iconPosition:left}` and `{icon:none, iconPosition:right}` become identical.
- Planner normalization dedups them and keeps a single label. Because Figma requires full combinations, collapsed combinations are still emitted. The second one is a **duplicate render**, detected by render hash, and the plugin builds it as an instance-free clone (same Scene subtree) labelled correctly. Each such case gets `PLAN_CONDITIONAL_DUPLICATE` (info).
- Alternative: `conditional: 'sparse'` omits them, giving a sparse set (`PLAN_SPARSE_SET`).

### 5.4 Render-hash dedup

After capture, variants whose normalized render hashes match are reported. The hash covers the paint and geometry tree, and excludes `data-*` attributes and ids.

- If an **entire axis value** is always identical to another value, the values are merged (as in §4.2 R5).
- If an **entire axis** is identical across all its values, the axis is removed (`PLAN_AXIS_NO_EFFECT`, warn).

---

## 6. States (D-14) <a id="states-d-14"></a><a id="states"></a>

### 6.1 The State axis

- Default `states: ['default', 'hover', 'focus-visible', 'active']` for components whose root, or an interactive descendant, is focusable or clickable.
- Elements count as interactive if they are `button`, `a[href]`, `input`, `select`, `textarea`, `[role=button|link|checkbox|radio|switch|tab|menuitem|option]`, `[tabindex]`, or carry an `onClick` prop (React fiber).
- Non-interactive components get `states: []`, so no State axis.
- Labels are `Default`, `Hover`, `Focus`, `Pressed`, `Disabled`, `Loading`, `Checked`… They are configurable through `states.labels`.

### 6.2 Arg-derived states

Booleans such as `disabled`, `loading`, `invalid`, `readOnly` and `selected` are **folded into the State axis** when `states.foldBooleans` (default `['disabled', 'loading', 'invalid']`). They are mutually exclusive with pseudo-states. So:

```
State = Default | Hover | Focus | Pressed | Disabled | Loading | Error
Disabled → args.disabled=true, no pseudo; Hover → pseudo 'hover', args.disabled=false; ...
```

This matches designer convention: one State property instead of `Disabled=true × State=Hover` combinations that make no sense.

Non-folded state-like booleans such as `checked` or `selected` stay their own VARIANT axis. A checkbox, for example, gets `Checked × State`.

### 6.3 Target element

The planner picks the element that receives the pseudo-state:

1. `parameters.holotype.stateTarget` (a CSS selector relative to the capture root, piercing `>>>`).
2. The first interactive element in the composed tree, as defined in §6.1. A native `input` inside a custom wrapper counts.
3. The capture root.

### 6.4 Application strategy

Mechanics are in [05 §9](05-capture.md#pseudo-states).

| Mode | Mechanism | Default for |
|---|---|---|
| `force` (**default**) | CDP `CSS.forcePseudoState` on the target **and its ancestor chain** up to the capture root. Hover and active are forced on all ancestors (matching real pointer semantics). For focus, `focus-within` is forced on ancestors, and `focus`/`focus-visible` on the target | all |
| `addon` | `updateGlobals({pseudo:{hover:true}})` when `caps.pseudoStatesGlobal` and the addon is installed, for parity with the designer's Storybook view | when `parameters.pseudo` exists |
| `interact` | Playwright real events: `hover()`; `keyboard.press('Tab')` to the target for `focus-visible`; `mouse.down()` without `up()` for `active`. Wait for settle, then **reset** with mouse move to (0,0) / `blur()` / `mouse.up()` and a remount | fallback |

**Per state:**

1. Apply `force` and capture.
2. If the render hash equals Default, try `interact`, which catches JS-driven hover such as Radix `data-state` or MUI.
3. If it is still identical, **drop the state** for this component (`PLAN_STATE_NO_EFFECT`, info).
4. If `interact` produced new portal content, such as a tooltip on hover, the portal is excluded unless `states.includePortals`. This avoids tooltips inside button variants (`CAP_STATE_PORTAL_IGNORED`).

Prototype reactions (Hover → `ON_HOVER CHANGE_TO`, Pressed → `ON_PRESS`) are generated at apply time from the State axis ([09](09-plugin.md)).

(verify on 3 real design systems, S-08)

---

## 7. Themes, modes, viewports, sizes <a id="themes"></a>

### 7.1 Themes → variable modes (default)

- Each mode dimension ([03 §8](03-storybook.md#globals-themes-and-modes-discovery)) is planned as a **ModePlan**: every variant is captured once per mode value. Diffs across modes must be **token-explained**, meaning every changed paint or number on a node traces back to a `var()` whose value differs per mode. The token bindings come from [08](08-tokens.md).
- If that holds, the component is built **once**, with variables bound. Modes become variable-collection modes, and the doc frame shows the set under each mode (`setExplicitVariableModeForCollection`).
- If the diffs are not token-explained, for example a theme changes structure or hardcoded colors via class names, the theme becomes a **VARIANT axis** `Theme=Light|Dark`, with `PLAN_THEME_AS_AXIS` (warn, listing the unexplained nodes).
- If the file's plan limits modes (Starter allows 1), the plugin falls back the same way at apply time ([08](08-tokens.md), verify S-12).

```ts
interface ModePlan { dimensions: { global: string; values: { value: unknown; label: string }[] }[];
  strategy: 'variables' | 'axis'; capturedAs: 'per-variant' | 'base-only' }
```

`capturedAs: 'base-only'` (default `'per-variant'` when the component has ≤32 variants) captures only the base variant per mode, to harvest token values. This keeps cost at (variants + modes − 1) instead of variants × modes.

### 7.2 Viewports and breakpoints

- `parameters.holotype.viewports: { mobile: 390, desktop: 1440 }`, or a compat import from `chromatic.modes[*].viewport` and `parameters.viewport.options`.
- `viewports.as`, default `'axis'`, becomes a `Viewport` axis.
- `'components'` creates separate component sets `Name/Mobile` and `Name/Desktop`. This is the recommended choice for page-level patterns whose structure changes across breakpoints (`PLAN_VIEWPORT_STRUCTURE_CHANGE` suggests it automatically when the aligned trees differ structurally).

### 7.3 Size of the component

`parameters.holotype.width`:

| Value | Behaviour |
|---|---|
| `'hug'` (default) | Capture at natural size. The root becomes HUG where verified |
| `number` | The root wrapper is constrained to that width (`#storybook-root > *{width:Npx}` via an injected style on the root container). The root becomes FIXED, or FILL in instances |
| `{ probe: [320, 640, 960] }` | Layout probing ([05 §11](05-capture.md#probing)) to infer fill/hug intent. Off by default; recommended for layout components |

`height` works the same way, defaulting to `'hug'`.

---

## 8. Naming and ordering

- **Axis names.** Use `parameters.holotype.axes[arg].name`. Otherwise Title Case the arg name (`iconPosition` → `Icon position`). The State axis is named `State`, the story axis `Story`, viewport `Viewport`, and global axes take the `globalTypes[g].name` or the title-cased key.
- **Value labels.** Use `control.labels[value]`, then the mapping key, then `String(value)` in Title Case for strings and `True`/`False` for booleans (Figma's convention; `true` maps to `True`). `undefined` becomes `Default`, or the `table.defaultValue.summary` parsed value.
- **Sanitizing.** Strip `=`, `,`, `/` (variant-name delimiters) and trim. Make labels unique by suffixing `(2)`. Max 64 characters.
- **Value order.** Use the `options` order. The base value moves to index 0 *unless* `axes[arg].order: 'options'` is set. Booleans are ordered by default value first. The State axis follows `states` order.
- **Grid placement.** By default the first axis goes on columns and all other axes nest on rows, last axis innermost. Override with `parameters.holotype.layout: { columns: ['State'], rows: ['Variant','Size'] }`. The default variant is at the top-left ([09](09-plugin.md)).
- **Default variant.** The variant with all base values: the base story's args, no pseudo-state, the default viewport.

---

## 9. Configuration schema <a id="schema"></a><a id="config"></a>

The same TypeBox schema is used for `parameters.holotype` (any level) and `holotype.config.ts → defaults | components[sid]`. The schema is defined in `@holotype/ir` (D-07), and JSON Schema is published at `/schema/config/v1.json`.

```ts
import { Type as T, Static } from '@sinclair/typebox';

const PseudoStateT = T.Union(['hover','focus','focus-visible','active','focus-within','visited'].map(s => T.Literal(s)));
const ArgValuesT = T.Array(T.Unknown());

export const HolotypeParams = T.Object({
  disable: T.Optional(T.Boolean()),                               // same as tag !figma
  name: T.Optional(T.String()),                                   // Figma component display name
  component: T.Optional(T.String()),                              // regroup into another component id
  strategy: T.Optional(T.Union([T.Literal('auto'), T.Literal('stories'), T.Literal('args'), T.Literal('curated')])),
  baseStory: T.Optional(T.String()),                              // story export name or id
  matrix: T.Optional(T.Union(['auto','full','pairwise','one-at-a-time','curated'].map(s => T.Literal(s)))),
  classification: T.Optional(T.Union([T.Literal('verify'), T.Literal('fast')])),
  args: T.Optional(T.Record(T.String(), T.Object({
    as: T.Optional(T.Union(['variant','boolean','text','instance-swap','slot','fixed','ignore'].map(s => T.Literal(s)))),
    name: T.Optional(T.String()),                                 // Figma property/axis name
    values: T.Optional(ArgValuesT),                               // explicit values (enables numbers/strings as axes)
    labels: T.Optional(T.Record(T.String(), T.String())),
    order: T.Optional(T.Union([T.Literal('options'), T.Literal('default-first')])),
    target: T.Optional(T.String()),                               // selector of node to bind (text/boolean/slot)
  }))),
  fixed: T.Optional(T.Record(T.String(), T.Unknown())),           // args pinned for all variants
  variants: T.Optional(T.Array(T.Record(T.String(), T.String()))),// curated combos (axisName → label)
  states: T.Optional(T.Union([T.Literal(false), T.Object({
    include: T.Optional(T.Array(T.Union([PseudoStateT, T.Literal('default')]))),
    foldBooleans: T.Optional(T.Array(T.String())),
    labels: T.Optional(T.Record(T.String(), T.String())),
    mode: T.Optional(T.Union([T.Literal('force'), T.Literal('addon'), T.Literal('interact')])),
    target: T.Optional(T.String()),
    includePortals: T.Optional(T.Boolean()),
  })])),
  modes: T.Optional(T.Object({
    globals: T.Optional(T.Array(T.String())),                     // which globals are mode dimensions
    values: T.Optional(T.Record(T.String(), T.Array(T.Unknown()))),
    as: T.Optional(T.Union([T.Literal('variables'), T.Literal('axis')])),
    capture: T.Optional(T.Union([T.Literal('per-variant'), T.Literal('base-only')])),
  })),
  viewports: T.Optional(T.Object({
    sizes: T.Record(T.String(), T.Union([T.Number(), T.Object({ width: T.Number(), height: T.Optional(T.Number()) })])),
    as: T.Optional(T.Union([T.Literal('axis'), T.Literal('components')])),
  })),
  width: T.Optional(T.Union([T.Literal('hug'), T.Number(), T.Object({ probe: T.Array(T.Number()) })])),
  height: T.Optional(T.Union([T.Literal('hug'), T.Number()])),
  viewport: T.Optional(T.Object({ width: T.Number(), height: T.Optional(T.Number()) })),
  rootSelector: T.Optional(T.String()),
  unwrap: T.Optional(T.Union([T.Boolean(), T.Number()])),
  portal: T.Optional(T.Union([T.Boolean(), T.Literal('auto'), T.String(),
    T.Object({ selector: T.Optional(T.String()), frame: T.Optional(T.Union([T.Literal('union'), T.Literal('viewport')])) })])),
  exclude: T.Optional(T.Array(T.String())),                       // selectors removed from capture
  stateTarget: T.Optional(T.String()),
  slots: T.Optional(T.Record(T.String(), T.Object({ selector: T.Optional(T.String()),
    min: T.Optional(T.Number()), max: T.Optional(T.Number()) }))),
  layout: T.Optional(T.Object({ columns: T.Optional(T.Array(T.String())), rows: T.Optional(T.Array(T.String())) })),
  stories: T.Optional(T.Object({ fillMatrix: T.Optional(T.Union(['none','budget','full'].map(s => T.Literal(s)))),
    maxStoryAxisValues: T.Optional(T.Number()) })),
  budget: T.Optional(T.Object({ max: T.Optional(T.Number()), warn: T.Optional(T.Number()), maxProbes: T.Optional(T.Number()) })),
  conditional: T.Optional(T.Union([T.Literal('dense'), T.Literal('sparse')])),
  play: T.Optional(T.Union([T.Literal('initial-only'), T.Literal('rerun')])),
  remount: T.Optional(T.Boolean()),
  delay: T.Optional(T.Number()),
  keepLayout: T.Optional(T.Boolean()),
  textMode: T.Optional(T.Union([T.Literal('reflow'), T.Literal('locked-lines')])),  // D-17, used by [07]
}, { additionalProperties: false });
export type HolotypeParams = Static<typeof HolotypeParams>;
```

Unknown keys produce `PLAN_PARAM_UNKNOWN_KEY` (warn, with "did you mean…"). The addon's types prevent them at authoring time.

**Precedence** follows README §7. `holotype.config.ts` also accepts `components: Record<sid | glob, HolotypeParams>`; globs match the `sid` or title, and later entries win.

**Example: Button stories with explicit hints.**

```ts
export default {
  component: Button,
  tags: ['figma'],
  parameters: { holotype: {
    args: { label: { as: 'text', name: 'Label' }, icon: { as: 'instance-swap' }, iconOnly: { as: 'boolean' } },
    states: { include: ['default', 'hover', 'focus-visible', 'active'], foldBooleans: ['disabled', 'loading'] },
    layout: { columns: ['State'], rows: ['Variant', 'Size'] },
  } },
} satisfies Meta<typeof Button>;
```

---

## 10. Compatibility readers <a id="compatibility-readers"></a>

### 10.1 story.to.design (`parameters.s2d`)

This is read **only** when `parameters.holotype` is absent and `compat.s2d !== false`. It is a migration path; we implement it from the public docs (https://story.to.design/docs/variant-properties-api), not from their code.

| s2d | holotype |
|---|---|
| `variantProperties: ['size']` | `args.size.as='variant'` |
| `{fromArg, name, values:[{name, argValue, excludedArgs}]}` | `args[fromArg] = {as:'variant', name, values, labels}`. `excludedArgs` becomes a curated exclusion of combos |
| `{name, values:[{name, withArgs}]}` | a custom axis (`source.kind:'custom'`) whose values bind arg bundles |
| `initArgs` | `fixed` |
| `:hover`, `:focus`, `:active` pseudo-args | `states.include` |
| `:viewport` | `viewports` |
| `:appearance` | `modes.globals=['__prefersColorScheme']`. A synthetic global drives `emulateMedia({colorScheme})` |
| `:selector`, `:portalSelector`, `:excludeSelector`, `:actionSelector` | `rootSelector`, `portal.selector`, `exclude`, `stateTarget` |
| `:width`, `:height` | `width`, `height` |
| `:slots` | `slots` |
| `type:'components'`, `axis:'split'` | `viewports.as`-like split → separate components (`PLAN_COMPAT_SPLIT`) |
| `:tap` | no equivalent. `PLAN_COMPAT_UNSUPPORTED` (`:tap` toggles stateful controls; use an arg instead) |

Every compat mapping is tagged `provenance: 'compat:s2d'` and listed in the report.

### 10.2 Chromatic

- `parameters.chromatic.modes` → candidate mode dimensions and viewports (§7). `disableSnapshot: true` → treated as a hint only (`PLAN_CHROMATIC_DISABLED_HINT`, info). It does **not** exclude the story.
- `delay` and `pauseAnimationAtEnd` → settle options ([03 §5.5](03-storybook.md#settle-protocol)).

### 10.3 storybook-addon-pseudo-states

`parameters.pseudo = {hover: true | selectors[], …}` adds those states to `states.include`, with `mode:'addon'` when the addon is installed and `force` otherwise. A selector array sets `stateTarget`.

---

## 11. Worked examples <a id="worked-examples"></a>

### 11.1 Button

The stories are `Primary` (base) / `Secondary` / `Large` / `Small` / `Disabled` / `WithIcon`. The argTypes are:

- `variant: primary|secondary|ghost`
- `size: sm|md|lg`
- `disabled`, `loading`
- `label: string`
- `icon` (a mapping over 12 icons)
- `iconOnly: boolean`
- `onClick: fn`

The planner produces:

- **Stories-as-variants.** `Secondary`, `Large`, `Small` and `Disabled` are each explained by one arg, which gives the axes `Variant{Primary,Secondary}` and `Size{Md,Lg,Sm}`. `Disabled` is folded into State. `WithIcon` differs in `icon` only, so it explains the `icon` arg.
- **Args matrix fill (budget).** `ghost` comes from argTypes options, and `fillMatrix:'budget'` adds it: `Variant{Primary,Secondary,Ghost}`.
- **Classification:**
  - `label` → TEXT (probe diff: one text node).
  - `icon` → INSTANCE_SWAP, with 12 preferred icon components; icon SVGs are extracted to the Icons page.
  - `iconOnly` → VARIANT, because it changes padding and removes the label, which is not visibility-only. Diagnostic `PLAN_BOOLEAN_PROMOTED_TO_VARIANT`.
  - `loading` → folded into State.
  - `onClick` → IGNORED.
- **States.** `Default | Hover | Focus | Pressed | Disabled | Loading`. `Pressed` was identical to `Hover` in this DS, so it is merged (`PLAN_VALUES_MERGED`).
- **Result.** 3 × 3 × 2 (`iconOnly`) × 5 = 90 variants, under the budget. Properties: `Label` (TEXT) and `Icon` (INSTANCE_SWAP). Grid: columns = State; rows = Variant > Size > Icon only.

### 11.2 Checkbox

- `checked: boolean`, `indeterminate: boolean`, `disabled`, `label: string`.
- `checked` → VARIANT. Paint changes because the checkmark appears **and** the box fill changes, so it is not visibility-only.
- `indeterminate` is conditional with `if: {arg:'checked', truthy:false}` → a value of a combined axis.
- Config `args.checked.values`: the planner suggests `PLAN_SUGGEST_MERGE_AXES` and merges `checked` + `indeterminate` into `Checked=False|True|Indeterminate` when conditionally exclusive.
- `label` → TEXT. The State axis targets the native `input` (or `[role=checkbox]`).
- Hover is forced on the ancestor `label` element too. This is why we force the ancestor chain.

### 11.3 Card with slots

- `title: string` → TEXT.
- `media: ReactNode` → SLOT, because the empty-probe removes the media block and reflow passes; slot site = the media container.
- `children` → SLOT `Content`.
- `actions: ReactNode` → SLOT.
- `elevation: 0|1|2|3` → VARIANT, since it only changes the effects.
- Default children are captured from the story's args. If the actions contain a `Button` recognized via fiber, it is emitted as a **Button instance** inside the slot's default content ([09](09-plugin.md)).

### 11.4 Icon library

- Story `Icons/All` renders a grid of 300 icons, or `Icon` with `name` options over 300 values.
- `name` with more than 12 options is an INSTANCE_SWAP candidate, but the component itself *is* the icon. So the rule is: **an enum-valued arg of a component whose render is a single SVG is split into separate components**, one per value (`Icon/ArrowLeft`, …), on the Icons page. This sets `viewports.as`-style split `as:'components'` automatically (`PLAN_ICON_SPLIT`).
- `size` → FIXED, because icons scale in Figma.
- `color` → FIXED. The SVG fill is bound to `currentColor`, which becomes a fill on the vector that an instance can override.
- These components become the `preferredValues` of INSTANCE_SWAP properties elsewhere.

### 11.5 Modal via portal

- The story renders `<Modal open>` into `document.body` through a portal, and `#storybook-root` has zero size.
- Portal `'auto'` triggers ([03 §6.3](03-storybook.md#portals-and-overlays)). `portal.frame:'viewport'` at 1280×800 keeps the backdrop.
- `title` → TEXT, `children` → SLOT. `size: sm|md|lg` → VARIANT.
- The `open` boolean is IGNORED with `PLAN_ARG_NO_VISUAL_EFFECT` if it is always true in the stories, or FIXED=true.
- States: none, because the modal root is not interactive; focus-trap inner elements are excluded.

---

## 12. Planner outputs and caching

- `planner` is deterministic: identical inputs give a byte-identical `ComponentPlan` (canonical JSON). The plan hash `planHash` is part of the capture cache key ([05 §10](05-capture.md#determinism)).
- The planner runs in two passes:
  1. **pre-plan**: priors, axes and probes;
  2. **final plan**: after probe captures, with classification resolved and the matrix generated.

  Only the final plan is persisted in the bundle (`manifest.components[sid].plan`), so the plugin UI can explain every decision.
- `holotype plan <sid>` prints the plan, its provenance and its budget without capturing variants, but it does run probes unless `--fast`.

---

## 13. Diagnostics coined here

| Code | Severity | Meaning |
|---|---|---|
| `PLAN_ENUM_UNRESOLVED` | warn | docgen produced a non-enumerable alias; add `options` |
| `PLAN_ARG_NO_VISUAL_EFFECT` | info | arg ignored: no render change |
| `PLAN_BOOLEAN_PROMOTED_TO_VARIANT` | info | boolean not visibility-only |
| `PLAN_TEXT_PARTIAL` | warn | arg is a substring of a larger text |
| `PLAN_TEXT_MULTI_NODE` | warn | arg text appears in several nodes |
| `PLAN_TEXT_UNBOUND` | info | string arg could not be bound; FIXED |
| `PLAN_SWAP_OPTION_UNRESOLVED` | warn | an INSTANCE_SWAP option has no component |
| `PLAN_SLOT_UNVERIFIED` | info | slot inferred without an empty probe |
| `PLAN_VALUES_MERGED` | info | two axis values render identically |
| `PLAN_PROPERTY_INCONSISTENT` | warn | property classification failed on a non-default variant; demoted |
| `PLAN_UNVERIFIED_CLASSIFICATION` | info | `classification:'fast'` |
| `PLAN_SPARSE_SET` | warn | set has missing combinations |
| `PLAN_AXIS_DROPPED_BUDGET` | warn | axis pinned to default due to budget |
| `PLAN_BUDGET_EXCEEDED` | error | over `budget.hardLimit` |
| `PLAN_PROBE_BUDGET` | warn | probe budget hit; priors used |
| `PLAN_CONDITIONAL_DUPLICATE` | info | conditional args collapse combinations |
| `PLAN_AXIS_NO_EFFECT` | warn | axis removed, no visual effect |
| `PLAN_STATE_NO_EFFECT` | info | pseudo-state dropped |
| `PLAN_THEME_AS_AXIS` | warn | theme not token-explained; emitted as axis |
| `PLAN_VIEWPORT_STRUCTURE_CHANGE` | info | suggest splitting viewports into components |
| `PLAN_STORY_SPLIT` | info | too many unexplained stories; split into components |
| `PLAN_PARAM_UNKNOWN_KEY` | warn | unknown key in `parameters.holotype` |
| `PLAN_COMPAT_SPLIT` / `PLAN_COMPAT_UNSUPPORTED` | info / warn | s2d compat |
| `PLAN_CHROMATIC_DISABLED_HINT` | info | Chromatic disableSnapshot seen |
| `PLAN_SUGGEST_MERGE_AXES` | info | exclusive booleans could become one axis |
| `PLAN_ICON_SPLIT` | info | icon enum split into components |
| `CAP_STATE_PORTAL_IGNORED` | info | state produced a portal that was excluded |
