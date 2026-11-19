import type { ComponentState, VariantState } from '../state';

/** A stage that runs once per variant, in plan order. */
export interface VariantStage {
  /** The stage number of 07 §1; stages run in ascending `step` order. */
  readonly step: number;
  readonly name: string;
  readonly per: 'variant';
  run(variant: VariantState, component: ComponentState): void;
}

/** A stage that runs once per component. */
export interface ComponentStage {
  readonly step: number;
  readonly name: string;
  readonly per: 'component';
  run(component: ComponentState): void;
}

/** One stage of the mapper pipeline (07 §1). */
export type Stage = VariantStage | ComponentStage;
