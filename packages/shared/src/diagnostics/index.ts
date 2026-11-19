/**
 * The diagnostic registry: every code in the catalog of plan chapter 12 §6.2 (02 §9).
 * Codes are API. They are never renamed, only deprecated.
 *
 * `catalog.generated.ts` is generated from the plan by `pnpm diag:gen`; never edit it. To add
 * a code, add its row to 12 §6.2 first, then regenerate. Message templates with placeholders
 * live in `messages.ts`.
 */
import { createDiagnosticRegistry, type DiagnosticDef, defineDiagnostic } from '../diagnostic';
import {
  DIAGNOSTIC_CATALOG,
  DIAGNOSTIC_CODES,
  type DiagnosticChapterRef,
  type DiagnosticCode,
  type DiagnosticEmitter,
} from './catalog.generated';
import { MESSAGE_TEMPLATES, type MessageTemplate, type MessageTemplateOf } from './messages';

/** Version that introduced the codes of the first catalog. */
export const CATALOG_SINCE = '0.0.0';

/** A registered code: its definition plus the catalog's metadata. */
export interface CatalogDiagnosticDef<C extends DiagnosticCode = DiagnosticCode, M extends string = string>
  extends DiagnosticDef<C, M> {
  /** Packages that raise the code (the catalog's **Emitted by**). */
  readonly emittedBy: readonly DiagnosticEmitter[];
  /** The plan chapter that specifies the behaviour. */
  readonly definedIn: DiagnosticChapterRef;
  /** Qualifier of the default severity, e.g. `error over 8 MB`. */
  readonly severityNote?: string;
}

const templates: { readonly [C in DiagnosticCode]?: MessageTemplate } = MESSAGE_TEMPLATES;

function fromCatalog(code: DiagnosticCode): CatalogDiagnosticDef {
  const entry = DIAGNOSTIC_CATALOG[code];
  const template = templates[code];
  const def = defineDiagnostic({
    code,
    severity: entry.severity,
    message: template?.message ?? entry.message,
    remedy: entry.remedy,
    ...(template?.fallback === undefined ? {} : { fallback: template.fallback }),
    since: CATALOG_SINCE,
  });
  return Object.freeze({
    ...def,
    emittedBy: entry.emittedBy,
    definedIn: entry.definedIn,
    ...(entry.severityNote === undefined ? {} : { severityNote: entry.severityNote }),
  });
}

/** Every catalog code, in catalog order. */
export const registry = createDiagnosticRegistry(DIAGNOSTIC_CODES.map(fromCatalog));

/** Every registered diagnostic code. Alias of {@link DiagnosticCode}. */
export type DiagCode = DiagnosticCode;

/** Whether `value` is a catalog code, e.g. for a diagnostic read from JSON. */
export function isDiagnosticCode(value: string): value is DiagnosticCode {
  return registry.has(value);
}

/**
 * The definition of a catalog code, typed with its message template so
 * {@link createDiagnostic} checks the params: `createDiagnostic(diagnostic('SB_RENDER_TIMEOUT'))`.
 */
export function diagnostic<const C extends DiagnosticCode>(code: C): CatalogDiagnosticDef<C, MessageTemplateOf<C>> {
  const def = registry.get(code);
  if (!def) throw new TypeError(`Unknown diagnostic code "${code}": add it to the catalog (12 §6.2) first.`);
  return def as CatalogDiagnosticDef<C, MessageTemplateOf<C>>;
}

// Named definitions for the codes used before the catalog was generated (B-00). New emitters
// call `diagnostic(code)`.
export const SB_INDEX_UNREACHABLE = diagnostic('SB_INDEX_UNREACHABLE');
export const SB_VERSION_UNSUPPORTED = diagnostic('SB_VERSION_UNSUPPORTED');
export const PLAN_CONFIG_INVALID = diagnostic('PLAN_CONFIG_INVALID');
export const PLAN_CONFIG_UNKNOWN_KEY = diagnostic('PLAN_CONFIG_UNKNOWN_KEY');
export const PLAN_MAPPER_FAILED = diagnostic('PLAN_MAPPER_FAILED');
export const PLAN_INVARIANT_VIOLATION = diagnostic('PLAN_INVARIANT_VIOLATION');
export const CAP_NONFINITE_VALUE = diagnostic('CAP_NONFINITE_VALUE');
export const APPLY_IR_VERSION_UNSUPPORTED = diagnostic('APPLY_IR_VERSION_UNSUPPORTED');
export const NET_SERVER_UNREACHABLE = diagnostic('NET_SERVER_UNREACHABLE');
export const SEC_SECRET_IN_CONFIG = diagnostic('SEC_SECRET_IN_CONFIG');

export {
  DIAGNOSTIC_CATALOG,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_DOMAIN_TITLES,
  DIAGNOSTIC_DOMAINS,
  DIAGNOSTIC_EMITTERS,
  type DiagnosticCatalogEntry,
  type DiagnosticChapterRef,
  type DiagnosticCode,
  type DiagnosticDomain,
  type DiagnosticEmitter,
} from './catalog.generated';
export { MESSAGE_TEMPLATES, type MessageTemplate, type MessageTemplateOf } from './messages';
