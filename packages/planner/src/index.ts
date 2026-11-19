import { NotImplementedError } from '@holotype/shared';
import type { StorybookModel } from '@holotype/storybook';

/** How an arg becomes part of the component (README §7, D-13). */
export type ArgClassification = 'VARIANT' | 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'SLOT' | 'FIXED' | 'IGNORED';

/**
 * Render-and-diff classification of one arg, injected by the CLI so the planner never
 * depends on the capture engine (02 §6.2).
 */
export type ClassifyFn = (request: { readonly sid: string; readonly arg: string }) => Promise<ArgClassification>;

/** Per-set variant budgets (D-28). Probe renders count against `maxProbes`, never `max`. */
export interface VariantBudget {
  readonly warn: number;
  readonly max: number;
  readonly hardLimit: number;
  readonly maxProbes: number;
}

export const DEFAULT_BUDGET: VariantBudget = Object.freeze({ warn: 128, max: 256, hardLimit: 1024, maxProbes: 120 });

export type BudgetStatus = 'ok' | 'warn' | 'over-max' | 'over-hard-limit';

/** Where a variant count falls against a budget. */
export function checkBudget(variants: number, budget: VariantBudget = DEFAULT_BUDGET): BudgetStatus {
  if (variants > budget.hardLimit) return 'over-hard-limit';
  if (variants > budget.max) return 'over-max';
  if (variants > budget.warn) return 'warn';
  return 'ok';
}

export interface PlannedVariant {
  readonly storyId: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly values: Readonly<Record<string, string>>;
}

export interface VariantPlan {
  readonly sid: string;
  readonly variants: readonly PlannedVariant[];
  readonly classifications: Readonly<Record<string, ArgClassification>>;
}

/** Plans the variants and component properties of one component (04). */
export async function planComponent(
  _model: StorybookModel,
  _sid: string,
  _config: unknown,
  _classify: ClassifyFn,
): Promise<VariantPlan> {
  throw new NotImplementedError('planComponent', 'Phase 3');
}
