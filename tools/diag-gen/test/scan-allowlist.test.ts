import { describe, expect, it } from 'vitest';
import { findCodeLiterals } from '../src/scan.ts';

describe('findCodeLiterals allowlist', () => {
  it('ignores Figma enum values that share a diagnostic prefix', () => {
    expect(findCodeLiterals("leadingTrim: 'CAP_HEIGHT'", ['CAP'])).toEqual([]);
  });
  it('still reports real codes on the same line', () => {
    expect(findCodeLiterals("['CAP_HEIGHT', 'CAP_TIMEOUT']", ['CAP'])).toEqual([{ line: 1, code: 'CAP_TIMEOUT' }]);
  });
});
