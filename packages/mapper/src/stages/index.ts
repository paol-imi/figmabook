import { emitStage } from './emit';
import { hashStage } from './hash';
import { namingStage } from './naming';
import { normalizeStage } from './normalize';
import { orderStage } from './order';
import { propertiesStage } from './properties';
import { simplifyStage } from './simplify';
import { textStage } from './text';
import type { Stage } from './types';
import { validateStage } from './validate';
import { visualsStage } from './visuals';

export type { ComponentStage, Stage, VariantStage } from './types';

/**
 * The mapper pipeline (07 §1). One line per stage, in 07 §1 order; append only (BUILD §2.3).
 * Each stage carries its 07 §1 number as `step`, and `runStages` runs them in `step` order,
 * so a stage appended later still runs in its place.
 */
export const STAGES: readonly Stage[] = [
  normalizeStage, // 1 Normalize
  orderStage, // 2 Paint-order sort and hoisting
  textStage, // 6 Text
  visualsStage, // 7 Visuals
  simplifyStage, // 8 Simplify (text-only elements)
  propertiesStage, // 11 Component property binding (VARIANT properties only)
  namingStage, // 13 Naming finalization
  emitStage, // 14 Fallback + expect emission
  hashStage, // 15 Hashing
  validateStage, // 16 Invariant validation
];
