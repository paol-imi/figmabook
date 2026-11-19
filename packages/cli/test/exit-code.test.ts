import { createDiagnostic, PLAN_CONFIG_UNKNOWN_KEY, SB_INDEX_UNREACHABLE } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { ExitCode, exitCodeFor } from '../src';

const warning = createDiagnostic(PLAN_CONFIG_UNKNOWN_KEY, { pointer: '/colr' });
const error = createDiagnostic(SB_INDEX_UNREACHABLE, { url: 'http://localhost:6006' });

describe('exit codes (11 §3.2)', () => {
  it('matches the canonical table', () => {
    expect(ExitCode).toEqual({
      Ok: 0,
      Errors: 1,
      Usage: 2,
      StorybookUnreachable: 3,
      Browser: 4,
      QualityGate: 5,
      Network: 6,
      Interrupted: 130,
    });
  });

  it('is 1 when a diagnostic is an error', () => {
    expect(exitCodeFor([])).toBe(ExitCode.Ok);
    expect(exitCodeFor([warning])).toBe(ExitCode.Ok);
    expect(exitCodeFor([warning, error])).toBe(ExitCode.Errors);
    expect(exitCodeFor([{ ...error, severity: 'fatal' }])).toBe(ExitCode.Errors);
  });

  it('is 5 when only the --fail-on gate trips', () => {
    expect(exitCodeFor([warning], 'warn')).toBe(ExitCode.QualityGate);
    expect(exitCodeFor([warning], 'error')).toBe(ExitCode.Ok);
    expect(exitCodeFor([warning, error], 'warn')).toBe(ExitCode.Errors);
  });
});
