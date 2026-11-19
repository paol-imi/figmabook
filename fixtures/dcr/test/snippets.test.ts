import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatSketch,
  listSnippets,
  loadSnippet,
  renderSnippet,
  SNIPPET_ROOT,
  STAGES,
  seededRandom,
  shuffleKeys,
  validateSnippetCase,
} from '../src/index.ts';

/* Snippet goldens (15 §7.3): one per VARIANT / BOOLEAN / TEXT row of the snippet table. */

const names = listSnippets();

describe('snippet goldens', () => {
  it('cover the slice rows of the snippet table', () => {
    expect(names.map((name) => loadSnippet(name).input.row).sort()).toEqual(['BOOLEAN', 'TEXT', 'VARIANT']);
  });

  it('formatSketch writes imports, a blank line, the sketch and a final newline', () => {
    expect(formatSketch({ lang: 'jsx-sketch', imports: ['import { A } from "a";'], code: '<A />' })).toBe(
      'import { A } from "a";\n\n<A />\n',
    );
    expect(formatSketch({ lang: 'jsx-sketch', imports: [], code: '<frame />' })).toBe('<frame />\n');
  });
});

describe.each(names)('snippet/%s', (name) => {
  it('the input validates', () => {
    const result = validateSnippetCase(JSON.parse(readFileSync(new URL(`${name}.json`, SNIPPET_ROOT), 'utf8')));
    expect(result.ok ? [] : result.error).toEqual([]);
  });

  it('the expected sketch is a jsx-sketch with sorted imports', () => {
    const { expected } = loadSnippet(name);
    expect(expected.endsWith('\n')).toBe(true);
    const imports = expected.split('\n').filter((line) => line.startsWith('import '));
    expect(imports).toEqual([...imports].sort());
  });

  it.skipIf(STAGES.snippet === 'pending')('renderSnippet gives the golden, also for shuffled input', () => {
    const { input, expected } = loadSnippet(name);
    expect(formatSketch(renderSnippet(input))).toBe(expected);
    expect(formatSketch(renderSnippet(shuffleKeys(input, seededRandom(1))))).toBe(expected);
  });
});
