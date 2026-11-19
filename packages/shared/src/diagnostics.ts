/**
 * The diagnostic catalog: every code Holotype emits is defined here, once (02 §9, 12 §6).
 * Codes are API. They are never renamed, only deprecated. Add new codes to `registry` too;
 * a test fails when an exported definition is missing from it.
 */
import { createDiagnosticRegistry, defineDiagnostic } from './diagnostic';

export const SB_INDEX_UNREACHABLE = defineDiagnostic({
  code: 'SB_INDEX_UNREACHABLE',
  severity: 'error',
  message: 'Could not load the Storybook index from {url}.',
  remedy:
    'Check the URL and that Storybook is running. For a static build, run `storybook build` and point Holotype at `storybook-static/`.',
  since: '0.0.0',
});

export const SB_VERSION_UNSUPPORTED = defineDiagnostic({
  code: 'SB_VERSION_UNSUPPORTED',
  severity: 'error',
  message: 'Storybook {version} is not supported; Holotype needs Storybook 8 or newer.',
  remedy: 'Upgrade to Storybook 10 (8 and 9 work best-effort).',
  since: '0.0.0',
});

export const PLAN_CONFIG_INVALID = defineDiagnostic({
  code: 'PLAN_CONFIG_INVALID',
  severity: 'error',
  message: 'Invalid config value at {pointer}: {reason}.',
  remedy: 'Fix the value at the JSON pointer printed with the error.',
  since: '0.0.0',
});

export const PLAN_CONFIG_UNKNOWN_KEY = defineDiagnostic({
  code: 'PLAN_CONFIG_UNKNOWN_KEY',
  severity: 'warn',
  message: 'Unknown config key {pointer} was ignored.',
  remedy: 'Check the spelling against the "did you mean…" hint.',
  fallback: 'the key was ignored',
  since: '0.0.0',
});

export const PLAN_MAPPER_FAILED = defineDiagnostic({
  code: 'PLAN_MAPPER_FAILED',
  severity: 'error',
  message: 'The mapper failed on this component: {reason}.',
  remedy: 'Report it with the stack in `report.json`; the other components are unaffected.',
  since: '0.0.0',
});

export const PLAN_INVARIANT_VIOLATION = defineDiagnostic({
  code: 'PLAN_INVARIANT_VIOLATION',
  severity: 'error',
  message: 'The mapper produced invalid output ({invariant}); the component was skipped.',
  remedy: 'Report it with `report.json`; the other components are unaffected.',
  since: '0.0.0',
});

export const CAP_NONFINITE_VALUE = defineDiagnostic({
  code: 'CAP_NONFINITE_VALUE',
  severity: 'error',
  message: 'A non-finite number ({value}) reached the IR at {pointer}.',
  remedy: 'Report it; usually a Holotype bug or a broken CSS value in the story.',
  since: '0.0.0',
});

export const APPLY_IR_VERSION_UNSUPPORTED = defineDiagnostic({
  code: 'APPLY_IR_VERSION_UNSUPPORTED',
  severity: 'error',
  message: '{document} version {found} is not supported; supported majors: {supported}.',
  remedy: 'Update whichever side is older: the plugin, or the CLI (`npx holotype@latest`).',
  since: '0.0.0',
});

export const NET_SERVER_UNREACHABLE = defineDiagnostic({
  code: 'NET_SERVER_UNREACHABLE',
  severity: 'error',
  message: 'No Holotype server answered on ports {ports}.',
  remedy: 'Start `holotype serve`, use the Figma desktop app, or import a bundle file instead.',
  since: '0.0.0',
});

export const SEC_SECRET_IN_CONFIG = defineDiagnostic({
  code: 'SEC_SECRET_IN_CONFIG',
  severity: 'error',
  message: 'The config contains a secret-like literal at {pointer}.',
  remedy: 'Move the secret to an environment variable (e.g. HOLOTYPE_SB_TOKEN) or `.holotype/auth/`.',
  since: '0.0.0',
});

export const registry = createDiagnosticRegistry([
  SB_INDEX_UNREACHABLE,
  SB_VERSION_UNSUPPORTED,
  PLAN_CONFIG_INVALID,
  PLAN_CONFIG_UNKNOWN_KEY,
  PLAN_MAPPER_FAILED,
  PLAN_INVARIANT_VIOLATION,
  CAP_NONFINITE_VALUE,
  APPLY_IR_VERSION_UNSUPPORTED,
  NET_SERVER_UNREACHABLE,
  SEC_SECRET_IN_CONFIG,
]);

/** Every registered diagnostic code. */
export type DiagCode = (typeof registry.codes)[number];
