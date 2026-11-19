import {
  createDiagnostic,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticContext,
  diagnostic,
  HolotypeError,
  type MESSAGE_TEMPLATES,
  PLAN_MAPPER_FAILED,
} from '@holotype/shared';

/** Catalog codes without a message template: their message is the catalog's plain meaning. */
export type PlainCode = Exclude<DiagnosticCode, keyof typeof MESSAGE_TEMPLATES>;

/** Where a mapper diagnostic applies; `nodeKey`, `variantKey` and `sid` are filled in at emission. */
export type NoteContext = Omit<DiagnosticContext, 'nodeKey' | 'variantKey' | 'sid' | 'severity'>;

/** A diagnostic of a template-less catalog code. */
export function plainDiagnostic(code: PlainCode, context: DiagnosticContext = {}): Diagnostic {
  return createDiagnostic(diagnostic(code), {}, context);
}

/**
 * Appends a diagnostic unless an equal one (same code, property and value) is already
 * there, so a fact found twice for the same node is reported once.
 */
export function addOnce(list: Diagnostic[], item: Diagnostic): void {
  const duplicate = list.some(
    (other) => other.code === item.code && other.property === item.property && other.value === item.value,
  );
  if (!duplicate) list.push(item);
}

/**
 * The mapper's error for inputs it cannot map at all (a pipeline bug upstream, or a
 * mapper bug): `PLAN_MAPPER_FAILED`, which skips the component.
 */
export function mapperFailure(sid: string, reason: string, cause?: unknown): HolotypeError {
  const failure = createDiagnostic(PLAN_MAPPER_FAILED, { reason }, { sid });
  return new HolotypeError(failure, cause === undefined ? undefined : { cause });
}
