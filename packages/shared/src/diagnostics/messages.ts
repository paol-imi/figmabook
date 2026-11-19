import type { DiagnosticCode } from './catalog.generated';

/** An emitter-facing message for a catalog code. */
export interface MessageTemplate {
  /** `{name}` placeholders are filled from the emitter's params, and typed from this literal. */
  readonly message: string;
  /** What Holotype did instead, when the code always has the same fallback. */
  readonly fallback?: string;
}

/**
 * Message templates with placeholders, for codes whose emitters report specifics (a URL, a
 * JSON pointer). Severity, remedy and metadata always come from the catalog (12 §6.2); a code
 * without a template uses the catalog's plain-language meaning as its message.
 *
 * Add a template here when you implement an emitter that has details to report.
 */
export const MESSAGE_TEMPLATES = {
  SB_INDEX_UNREACHABLE: { message: 'Could not load the Storybook index from {url}.' },
  SB_VERSION_UNSUPPORTED: { message: 'Storybook {version} is not supported; Holotype needs Storybook 8 or newer.' },
  PLAN_CONFIG_INVALID: { message: 'Invalid config value at {pointer}: {reason}.' },
  PLAN_CONFIG_UNKNOWN_KEY: { message: 'Unknown config key {pointer} was ignored.', fallback: 'the key was ignored' },
  PLAN_MAPPER_FAILED: { message: 'The mapper failed on this component: {reason}.' },
  PLAN_INVARIANT_VIOLATION: { message: 'The mapper produced invalid output ({invariant}); the component was skipped.' },
  CAP_NONFINITE_VALUE: { message: 'A non-finite number ({value}) reached the IR at {pointer}.' },
  APPLY_IR_VERSION_UNSUPPORTED: {
    message: '{document} version {found} is not supported; supported majors: {supported}.',
  },
  NET_SERVER_UNREACHABLE: { message: 'No Holotype server answered on ports {ports}.' },
  SEC_SECRET_IN_CONFIG: { message: 'The config contains a secret-like literal at {pointer}.' },
} as const satisfies { readonly [C in DiagnosticCode]?: MessageTemplate };

/** The message template type of a code: its literal template, or `string` without one. */
export type MessageTemplateOf<C extends DiagnosticCode> = C extends keyof typeof MESSAGE_TEMPLATES
  ? (typeof MESSAGE_TEMPLATES)[C]['message']
  : string;
