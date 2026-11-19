import { compareSeverity, type Diagnostic, type Severity } from '@holotype/shared';

/** Process exit codes, as 11 §3.2 lists them (the canonical table). */
export const ExitCode = Object.freeze({
  Ok: 0,
  /** Completed with errors in some components (a partial bundle may be written). */
  Errors: 1,
  /** Usage or config error: invalid flags, config schema validation failed. */
  Usage: 2,
  /** Storybook unreachable or its index not loadable. */
  StorybookUnreachable: 3,
  /** Browser or Playwright failure: Chromium missing or crashed. */
  Browser: 4,
  /** Quality gate failed: `--fail-on`, fidelity threshold, budget exceeded. */
  QualityGate: 5,
  /** Network or auth failure (registry, login). */
  Network: 6,
  /** Interrupted (SIGINT). */
  Interrupted: 130,
});

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Exit code of a finished run: 1 when any diagnostic is an error, else 5 when one reaches
 * `failOn` (the `--fail-on` gate), else 0.
 */
export function exitCodeFor(diagnostics: readonly Diagnostic[], failOn?: Severity): ExitCode {
  if (diagnostics.some((d) => compareSeverity(d.severity, 'error') >= 0)) return ExitCode.Errors;
  if (failOn !== undefined && diagnostics.some((d) => compareSeverity(d.severity, failOn) >= 0)) {
    return ExitCode.QualityGate;
  }
  return ExitCode.Ok;
}
