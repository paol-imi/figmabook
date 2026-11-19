import type { CaptureDoc, TokensDoc } from '@holotype/ir';
import { NotImplementedError } from '@holotype/shared';

export { mapComponent } from './map-component';
export { DEFAULT_MAPPER_SETTINGS, settingsProblem } from './settings';
export { type ComponentStage, STAGES, type Stage, type VariantStage } from './stages/index';
export type { ComponentState, HoistOrigin, NodeFields, SyntheticRole, VariantState, WorkNode } from './state';

/** Resolves CSS custom properties into variables, aliases and modes (08). */
export function mapTokens(_captures: readonly CaptureDoc[]): TokensDoc {
  throw new NotImplementedError('mapTokens', 'Phase 5');
}
