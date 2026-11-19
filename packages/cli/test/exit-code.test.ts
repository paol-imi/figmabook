import { createDiagnostic, PLAN_CONFIG_UNKNOWN_KEY, SB_INDEX_UNREACHABLE } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { ExitCode, exitCodeFor } from '../src';

const warning = createDiagnostic(PLAN_CONFIG_UNKNOWN_KEY, { pointer: '/colr' });
const error = createDiagnostic(SB_INDEX_UNREACHABLE, { url: 'http://localhost:6006' });

describe('exit codes (02 §9)', () => {
  it('matches the documented numbers', () => {
    expect(ExitCode).toEqual({ Ok: 0, Diagnostics: 1, Usage: 2, StorybookUnreachable: 3, Internal: 4 });
  });

  it('fails on diagnostics at or above --fail-on', () => {
    expect(exitCodeFor([])).toBe(ExitCode.Ok);
    expect(exitCodeFor([warning])).toBe(ExitCode.Ok);
    expect(exitCodeFor([warning, error])).toBe(ExitCode.Diagnostics);
    expect(exitCodeFor([warning], 'warn')).toBe(ExitCode.Diagnostics);
    expect(exitCodeFor([error], 'fatal')).toBe(ExitCode.Ok);
  });
});
