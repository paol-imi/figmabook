import { type Result, err, ok } from '@holotype/shared';
import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type BundleManifest, BundleManifestSchema } from './schema/bundle';
import { type CaptureDoc, CaptureDocSchema } from './schema/capture';
import { type BundleReport, BundleReportSchema } from './schema/report';
import { type SceneComponent, SceneComponentSchema } from './schema/scene';
import { type TokenSet, TokenSetSchema } from './schema/tokens';

/**
 * A schema violation. Callers turn these into the diagnostic that fits their context,
 * e.g. `PLAN_INVARIANT_VIOLATION` for mapper output (06 §9).
 */
export interface ValidationIssue {
  /** JSON pointer to the offending value. */
  readonly path: string;
  readonly message: string;
}

export type Validator<T> = (value: unknown) => Result<T, readonly ValidationIssue[]>;

const MAX_ISSUES = 50;

function createValidator<S extends TSchema>(schema: S): Validator<Static<S>> {
  return (value) => {
    if (Value.Check(schema, value)) return ok(value);
    const issues: ValidationIssue[] = [];
    for (const error of Value.Errors(schema, value)) {
      issues.push({ path: error.path, message: error.message });
      if (issues.length === MAX_ISSUES) break;
    }
    return err(issues);
  };
}

export const validateCaptureDoc: Validator<CaptureDoc> = createValidator(CaptureDocSchema);
export const validateSceneComponent: Validator<SceneComponent> = createValidator(SceneComponentSchema);
export const validateTokenSet: Validator<TokenSet> = createValidator(TokenSetSchema);
export const validateBundleManifest: Validator<BundleManifest> = createValidator(BundleManifestSchema);
export const validateBundleReport: Validator<BundleReport> = createValidator(BundleReportSchema);
