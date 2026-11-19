# @holotype/planner

The variant planner ([04](../../internal/plan/04-variant-model.md)): turns a Storybook model and the
config into a `ComponentPlan` per component (`@holotype/ir`, 06 §1.1). It uses `@holotype/storybook`
types only; render-and-diff classification is injected by the CLI.

## Public API

| Export                                             | What it does                                                                                                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planSingleStory(model, storyId, { viewport? })`   | BUILD B-13: one story as a one-variant `ComponentPlan` (story args and globals, D-24 viewport, no axes or properties). `SB_STORY_MISSING` when the id is not among the model's filtered stories (`data.exclusion` says when the filter dropped it) |
| `identityOf(story, caps)`, `frameworkOf(caps)`     | the component identity from the index entry (display name = last title segment) and the framework (`@storybook/react` → `react`)                                                                                                                   |
| `DEFAULT_VIEWPORT`                                 | 1280×800                                                                                                                                                                                                                                           |
| `checkBudget(variants, budget?)`, `DEFAULT_BUDGET` | D-28 variant budgets                                                                                                                                                                                                                               |
| `planComponent(...)`                               | the full planner (stories as variants, args): not built yet                                                                                                                                                                                        |
