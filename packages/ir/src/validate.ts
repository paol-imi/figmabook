import { err, ok, type Result } from '@holotype/shared';
import { Kind, type Static, type TSchema } from '@sinclair/typebox';
import { type TypeCheck, TypeCompiler } from '@sinclair/typebox/compiler';
import { type ValueError, ValueErrorType } from '@sinclair/typebox/errors';
import { type BundleManifest, BundleManifestSchema } from './schema/bundle';
import { CAPTURE_REFERENCES, type CaptureDoc, CaptureDocSchema } from './schema/capture';
import {
  type HolotypeConfig,
  HolotypeConfigSchema,
  type HolotypeParams,
  HolotypeParamsSchema,
  normalizeConfigInput,
} from './schema/config';
import { type ProvenanceDoc, ProvenanceDocSchema } from './schema/provenance';
import { type ApplyReport, ApplyReportSchema, type BundleReport, BundleReportSchema } from './schema/report';
import { type SceneComponent, SceneComponentSchema } from './schema/scene';
import { type TokensDoc, TokensDocSchema } from './schema/tokens';

/**
 * A schema violation. Callers turn these into the diagnostic that fits their context:
 * `PLAN_INVARIANT_VIOLATION` for mapper output (06 §9), `PLAN_CONFIG_UNKNOWN_KEY` or
 * `PLAN_CONFIG_INVALID` for config (16 §18), `PLAN_PARAM_UNKNOWN_KEY` for parameters (04 §9).
 */
export interface ValidationIssue {
  /** JSON pointer to the offending value (for `unknown-key`, to the key itself). */
  readonly path: string;
  /** `unknown-key`: a key a strict schema does not allow; `invalid`: anything else. */
  readonly kind: 'unknown-key' | 'invalid';
  readonly message: string;
}

export type Validator<T> = (value: unknown) => Result<T, readonly ValidationIssue[]>;

export interface ValidatorOptions {
  /** Schemas the document refers to by `$id` (recursive node types). */
  readonly references?: readonly TSchema[];
  /** Applied to the input before checking; the prepared value is what `ok` carries. */
  readonly prepare?: (value: unknown) => unknown;
  /** At most this many issues are reported. Default 50. */
  readonly maxIssues?: number;
}

/**
 * Creates a validator backed by a compiled TypeBox check (06 §9). Compilation is lazy, on
 * first use, so importing the package stays cheap. Packages that own further document
 * schemas (the DCR, 15 §6) build their validators with this too.
 */
export function createValidator<S extends TSchema>(schema: S, options: ValidatorOptions = {}): Validator<Static<S>> {
  const { references = [], prepare, maxIssues = 50 } = options;
  let compiled: TypeCheck<S> | undefined;
  return (input) => {
    compiled ??= TypeCompiler.Compile(schema, [...references]);
    const value = prepare ? prepare(input) : input;
    if (compiled.Check(value)) return ok(value);
    const issues: ValidationIssue[] = [];
    for (const error of compiled.Errors(value)) {
      for (const leaf of explain(error)) {
        issues.push(toIssue(leaf));
        if (issues.length === maxIssues) return err(issues);
      }
    }
    return err(issues);
  };
}

function toIssue(error: ValueError): ValidationIssue {
  if (error.type === ValueErrorType.ObjectAdditionalProperties) {
    return { path: error.path, kind: 'unknown-key', message: `Unknown key "${lastSegment(error.path)}"` };
  }
  if (isEnum(error.schema)) {
    const values = error.schema.anyOf.map((option) => JSON.stringify(option.const)).join(', ');
    return { path: error.path, kind: 'invalid', message: `Expected one of ${values}` };
  }
  return { path: error.path, kind: 'invalid', message: error.message };
}

const isEnum = (schema: TSchema): schema is TSchema & { anyOf: Array<TSchema & { const: unknown }> } =>
  Array.isArray(schema.anyOf) && schema.anyOf.every((option: TSchema) => option[Kind] === 'Literal');

/** A literal (discriminant) mismatch: the value is not meant to be this union member. */
const isDiscriminantMiss = (error: ValueError): boolean =>
  error.type === ValueErrorType.Literal || (error.type === ValueErrorType.Union && isEnum(error.schema));

/**
 * Replaces an "Expected union value" error by the errors of the member the value was most
 * likely meant to be: fewest discriminant mismatches, then the deepest failure, then the
 * fewest errors. Enum unions (string literals) are kept as one error.
 */
function* explain(error: ValueError): Generator<ValueError> {
  if (error.type !== ValueErrorType.Union || isEnum(error.schema) || error.errors.length === 0) {
    yield error;
    return;
  }
  const depth = (e: ValueError) => e.path.split('/').length;
  let best: ValueError[] | undefined;
  let bestScore: readonly [number, number, number] | undefined;
  for (const member of error.errors) {
    const errors = [...member];
    if (errors.length === 0) continue;
    const score = [errors.filter(isDiscriminantMiss).length, -Math.max(...errors.map(depth)), errors.length] as const;
    if (bestScore === undefined || compareScores(score, bestScore) < 0) {
      best = errors;
      bestScore = score;
    }
  }
  if (best === undefined) {
    yield error;
    return;
  }
  for (const inner of best) yield* explain(inner);
}

function compareScores(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function lastSegment(pointer: string): string {
  const segment = pointer.slice(pointer.lastIndexOf('/') + 1);
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

export const validateCaptureDoc: Validator<CaptureDoc> = createValidator(CaptureDocSchema, {
  references: CAPTURE_REFERENCES,
});
export const validateSceneComponent: Validator<SceneComponent> = createValidator(SceneComponentSchema);
export const validateTokensDoc: Validator<TokensDoc> = createValidator(TokensDocSchema);
export const validateBundleManifest: Validator<BundleManifest> = createValidator(BundleManifestSchema);
export const validateBundleReport: Validator<BundleReport> = createValidator(BundleReportSchema);
export const validateApplyReport: Validator<ApplyReport> = createValidator(ApplyReportSchema);
export const validateProvenanceDoc: Validator<ProvenanceDoc> = createValidator(ProvenanceDocSchema);

/** Validates one `parameters.holotype` object (any level), after `normalizeConfigInput`. */
export const validateHolotypeParams: Validator<HolotypeParams> = createValidator(HolotypeParamsSchema, {
  prepare: normalizeConfigInput,
});

/** Validates a resolved `holotype.config.ts` value, after `normalizeConfigInput`. */
export const validateHolotypeConfig: Validator<HolotypeConfig> = createValidator(HolotypeConfigSchema, {
  prepare: normalizeConfigInput,
});
