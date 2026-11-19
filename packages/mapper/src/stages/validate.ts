import {
  checkSceneInvariants,
  type InvariantViolation,
  invariantDiagnostics,
  validateSceneComponent,
} from '@holotype/ir';
import { HolotypeError } from '@holotype/shared';
import { mapperFailure } from '../diagnostics';
import type { ComponentStage } from './types';

/*
 * Stage 16, invariant validation (06 §9): the full Scene schema plus the semantic
 * invariants. A failure is a mapper bug: `PLAN_INVARIANT_VIOLATION` (error) is thrown and
 * the CLI skips the component.
 */
export const validateStage: ComponentStage = {
  step: 16,
  name: 'validate',
  per: 'component',
  run(component) {
    const { scene, input } = component;
    if (!scene) throw mapperFailure(input.sid, 'validation ran before emission');
    const violations: InvariantViolation[] = [];
    const schema = validateSceneComponent(scene);
    if (!schema.ok) {
      for (const issue of schema.error)
        violations.push({ invariant: 'schema', path: issue.path, message: issue.message });
    }
    const tokens = input.tokens.tokens;
    violations.push(...checkSceneInvariants(scene, tokens ? { tokens } : {}));
    if (violations.length > 0) throw new HolotypeError(invariantDiagnostics(input.sid, violations));
  },
};
