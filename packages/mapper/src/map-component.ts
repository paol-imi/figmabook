import type { MapperInput, MapperOutput } from '@holotype/ir';
import { HolotypeError } from '@holotype/shared';
import { mapperFailure } from './diagnostics';
import { settingsProblem } from './settings';
import { STAGES } from './stages/index';
import { runStages } from './stages/run';
import { type ComponentState, liftRoot, type VariantState } from './state';

/** Checks that the inputs describe one component consistently, and pairs each planned variant with its capture. */
function variantStates(input: MapperInput): VariantState[] {
  const { sid, plan, meta, captures } = input;
  if (plan.sid !== sid || meta.sid !== sid) {
    throw mapperFailure(sid, `the plan (${plan.sid}) and metadata (${meta.sid}) are for another component`);
  }
  if (plan.variants.length === 0) throw mapperFailure(sid, 'the plan has no variants');
  const problem = settingsProblem(input.config);
  if (problem) throw mapperFailure(sid, problem);
  return plan.variants.map((planned) => {
    const capture = captures.get(planned.vk);
    if (capture === undefined) throw mapperFailure(sid, `no capture for variant ${planned.vk}`);
    if (capture.target.vk !== planned.vk || capture.target.sid !== sid) {
      throw mapperFailure(
        sid,
        `the capture keyed ${planned.vk} was rendered for ${capture.target.sid} variant ${capture.target.vk}`,
      );
    }
    return { planned, capture, root: liftRoot(capture), diagnostics: [] };
  });
}

/**
 * Maps one component's captures to Scene IR (07, D-08). Pure and deterministic: no I/O, no
 * clock, no randomness; the same input always gives the same canonical output.
 *
 * Throws a `HolotypeError` and nothing else: `PLAN_MAPPER_FAILED` when the input cannot be
 * mapped, `PLAN_INVARIANT_VIOLATION` when the output breaks a 06 §9 invariant. Either way
 * the CLI skips the component and the others are unaffected.
 */
export function mapComponent(input: MapperInput): MapperOutput {
  try {
    const component: ComponentState = {
      input,
      variants: variantStates(input),
      properties: [],
      scene: undefined,
      diagnostics: [],
    };
    runStages(STAGES, component);
    const { scene } = component;
    if (!scene) throw mapperFailure(input.sid, 'the pipeline produced no scene');
    return { scene, diagnostics: [...scene.diagnostics, ...scene.variants.flatMap((variant) => variant.diagnostics)] };
  } catch (error) {
    if (error instanceof HolotypeError) throw error;
    throw mapperFailure(input.sid, error instanceof Error ? error.message : String(error), error);
  }
}
