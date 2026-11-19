import type { ComponentState } from '../state';
import type { Stage } from './types';

/** `stages` in `step` order. Two stages with one step number are a programmer error. */
export function orderStages(stages: readonly Stage[]): Stage[] {
  const ordered = [...stages].sort((a, b) => a.step - b.step);
  ordered.forEach((stage, i) => {
    const previous = ordered[i - 1];
    if (previous && previous.step === stage.step) {
      throw new Error(`Mapper stages "${previous.name}" and "${stage.name}" share step ${stage.step} (07 §1).`);
    }
  });
  return ordered;
}

/** Runs the pipeline: variant stages once per variant in plan order, component stages once. */
export function runStages(stages: readonly Stage[], component: ComponentState): void {
  for (const stage of orderStages(stages)) {
    if (stage.per === 'variant') {
      for (const variant of component.variants) stage.run(variant, component);
    } else {
      stage.run(component);
    }
  }
}
