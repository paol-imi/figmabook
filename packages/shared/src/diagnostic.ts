import { DIAGNOSTIC_CATALOG, type DiagnosticCode, type DiagnosticDomain } from './diagnostics/catalog.generated';
import type { DefaultSeverity, Severity } from './severity';
import { compareSeverity } from './severity';

/**
 * An emitted diagnostic. Diagnostics are data, not logs (02 §9): every fallback,
 * approximation or skip produces one, and they travel in the IR documents and reports.
 */
export interface Diagnostic {
  /** A catalog code for diagnostics made here; `string` because reports from other versions may carry others. */
  readonly code: string;
  readonly severity: Severity;
  /** Plain-language message, rendered from the code's template. */
  readonly message: string;
  /** Node key (`nk`) in Scene IR, or the capture node id in Capture IR. */
  readonly nodeKey?: string;
  /** Variant key (`vk`). */
  readonly variantKey?: string;
  /** Component id. */
  readonly sid?: string;
  /** CSS or Figma property name concerned. */
  readonly property?: string;
  /** Offending value, truncated to {@link MAX_VALUE_LENGTH} characters. */
  readonly value?: string;
  /** What was done instead. */
  readonly fallback?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** What a code is registered with: everything except the derived `domain` and `docs`. */
export interface DiagnosticSpec<C extends DiagnosticCode = DiagnosticCode, M extends string = string> {
  readonly code: C;
  readonly severity: DefaultSeverity;
  /** Message template; `{name}` placeholders are filled from the emitter's params. */
  readonly message: M;
  /** What the user can do, in plain words (D-40). */
  readonly remedy: string;
  /** What Holotype did instead, when there is a fallback. */
  readonly fallback?: string;
  /** Version that introduced the code. */
  readonly since: string;
  /** Version that deprecated the code. Codes are API: never renamed, only deprecated. */
  readonly deprecated?: string;
}

export interface DiagnosticDef<C extends DiagnosticCode = DiagnosticCode, M extends string = string>
  extends DiagnosticSpec<C, M> {
  readonly domain: DiagnosticDomain;
  readonly docs: `/docs/diagnostics/${C}`;
}

export type MessageParamValue = string | number | boolean;

type Placeholders<T extends string> = T extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never;

/** The params a message template needs, derived from its `{name}` placeholders. */
export type MessageParams<M extends string> = string extends M
  ? Readonly<Record<string, MessageParamValue>>
  : { readonly [K in Placeholders<M>]: MessageParamValue };

/** Where a diagnostic applies, plus optional overrides. */
export interface DiagnosticContext {
  /** Raise the registered severity, e.g. to `fatal` when the run aborts. Lowering throws. */
  readonly severity?: Severity;
  readonly nodeKey?: string;
  readonly variantKey?: string;
  readonly sid?: string;
  readonly property?: string;
  readonly value?: string;
  readonly fallback?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

type CreateArgs<M extends string> = [Placeholders<M>] extends [never]
  ? [params?: MessageParams<M>, context?: DiagnosticContext]
  : [params: MessageParams<M>, context?: DiagnosticContext];

export const MAX_VALUE_LENGTH = 200;

/**
 * Builds the definition of a catalog code from a spec. Pure: registration happens by listing
 * the returned definition in a {@link createDiagnosticRegistry} call. The shared `registry`
 * already holds every catalog code, built from the catalog itself; use `diagnostic(code)`.
 */
export function defineDiagnostic<const C extends DiagnosticCode, const M extends string>(
  spec: DiagnosticSpec<C, M>,
): DiagnosticDef<C, M> {
  if (!Object.hasOwn(DIAGNOSTIC_CATALOG, spec.code)) {
    throw new TypeError(`Unknown diagnostic code "${spec.code}": add it to the catalog (12 §6.2) first.`);
  }
  const domain: DiagnosticDomain = DIAGNOSTIC_CATALOG[spec.code].domain;
  return Object.freeze({ ...spec, domain, docs: `/docs/diagnostics/${spec.code}` as const });
}

/** Renders `{name}` placeholders. Unknown placeholders are left in place. */
export function renderMessage(template: string, params: Readonly<Record<string, MessageParamValue>>): string {
  return template.replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

/** Emits an instance of a registered code. */
export function createDiagnostic<C extends DiagnosticCode, M extends string>(
  def: DiagnosticDef<C, M>,
  ...[params, context = {}]: CreateArgs<M>
): Diagnostic & { readonly code: C } {
  const severity = context.severity ?? def.severity;
  if (compareSeverity(severity, def.severity) < 0) {
    throw new RangeError(`${def.code}: severity may be raised above "${def.severity}", never lowered.`);
  }
  const { severity: _ignored, value, fallback = def.fallback, ...where } = context;
  return {
    code: def.code,
    severity,
    message: renderMessage(def.message, params ?? {}),
    ...where,
    ...(value === undefined ? {} : { value: value.slice(0, MAX_VALUE_LENGTH) }),
    ...(fallback === undefined ? {} : { fallback }),
  };
}

export interface DiagnosticRegistry<D extends DiagnosticDef = DiagnosticDef> extends Iterable<D> {
  readonly codes: readonly D['code'][];
  get(code: string): D | undefined;
  has(code: string): code is D['code'];
}

/** Builds the registry of known codes. Duplicate codes are a programmer error. */
export function createDiagnosticRegistry<const D extends readonly DiagnosticDef[]>(
  defs: D,
): DiagnosticRegistry<D[number]> {
  const byCode = new Map<string, D[number]>();
  for (const def of defs) {
    if (byCode.has(def.code)) throw new Error(`Duplicate diagnostic code "${def.code}".`);
    byCode.set(def.code, def);
  }
  return {
    codes: Object.freeze(defs.map((def): D[number]['code'] => def.code)),
    get: (code) => byCode.get(code),
    has: (code): code is D[number]['code'] => byCode.has(code),
    [Symbol.iterator]: () => byCode.values(),
  };
}
