import { describe, expect, it } from 'vitest';
import {
  createDiagnostic,
  err,
  HolotypeError,
  isLevelEnabled,
  maxSeverity,
  ok,
  type Result,
  SB_INDEX_UNREACHABLE,
  unwrap,
} from '../src';

const unreachable = createDiagnostic(SB_INDEX_UNREACHABLE, { url: 'http://localhost:6006' }, { severity: 'fatal' });

describe('Result (02 §9)', () => {
  it('narrows on `ok`', () => {
    const results: Result<number>[] = [ok(1), err([unreachable])];
    expect(results.map((r) => (r.ok ? r.value : r.error[0]?.code))).toEqual([1, 'SB_INDEX_UNREACHABLE']);
  });

  it('unwrap returns the value or throws the diagnostics as a HolotypeError', () => {
    expect(unwrap(ok('v'))).toBe('v');
    try {
      unwrap(err([unreachable]));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HolotypeError);
      expect((error as HolotypeError).code).toBe('SB_INDEX_UNREACHABLE');
      expect((error as HolotypeError).message).toBe('[SB_INDEX_UNREACHABLE] Could not load the Storybook index from http://localhost:6006.');
    }
  });

  it('maxSeverity picks the most severe diagnostic', () => {
    expect(maxSeverity([])).toBeUndefined();
    expect(maxSeverity([{ severity: 'warn' }, unreachable, { severity: 'error' }])).toBe('fatal');
  });
});

describe('isLevelEnabled (02 §10)', () => {
  it('filters by threshold', () => {
    expect(isLevelEnabled('info', 'warn')).toBe(true);
    expect(isLevelEnabled('info', 'debug')).toBe(false);
    expect(isLevelEnabled('silent', 'error')).toBe(false);
    expect(isLevelEnabled('trace', 'trace')).toBe(true);
  });
});
