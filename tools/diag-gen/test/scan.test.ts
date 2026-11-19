import { describe, expect, it } from 'vitest';
import { findCodeLiterals, IGNORE_MARKER } from '../src/index.ts';

const PREFIXES = ['SB', 'CAP', 'TEXT'];

describe('findCodeLiterals', () => {
  it('finds quoted code literals with a known prefix, with their lines', () => {
    const source = [
      "const a = 'SB_RENDER_TIMEOUT';",
      'const b = "CAP_NONFINITE_VALUE", c = `TEXT_FONT_MISSING`;',
      '/** Emits `SB_STORY_ERROR` when the story throws. */',
    ].join('\n');
    expect(findCodeLiterals(source, PREFIXES)).toEqual([
      { line: 1, code: 'SB_RENDER_TIMEOUT' },
      { line: 2, code: 'CAP_NONFINITE_VALUE' },
      { line: 2, code: 'TEXT_FONT_MISSING' },
      { line: 3, code: 'SB_STORY_ERROR' },
    ]);
  });

  it('ignores identifiers, unknown prefixes, partial literals and mixed case', () => {
    const source = [
      'if (node.nodeType === Node.TEXT_NODE) {}',
      "const env = 'NODE_ENV';",
      "const prefix = 'CAP_UNSUPPORTED_';",
      "const message = 'SB_RENDER_TIMEOUT happened';",
      "const lower = 'SB_render';",
      "const single = 'SB';",
    ].join('\n');
    expect(findCodeLiterals(source, PREFIXES)).toEqual([]);
  });

  it(`skips lines marked ${IGNORE_MARKER}`, () => {
    expect(findCodeLiterals(`const x = 'SB_FAKE'; // ${IGNORE_MARKER}`, PREFIXES)).toEqual([]);
  });
});
