import { describe, expect, it } from 'vitest';
import { type FieldRecord, markdownTable, summarize } from '../coverage.ts';
import { verifyField } from '../oracle.ts';
import { ProvenanceDiagnostics } from '../resolver/diagnostics.ts';
import type { FieldProvenance } from '../resolver/resolve.ts';
import { classifySheet } from '../resolver/sheets.ts';
import { header } from './support.ts';

const FILES: Record<string, string> = {
  'src/a.css': '.a,\n.b {\n  padding-inline: var(--x);\n}\n',
  'src/tokens.css': ':root {\n  --x: 4px;\n}\n',
};
const read = (path: string) => FILES[path];

const resolved: FieldProvenance = {
  property: 'padding-left',
  computed: '4px',
  status: 'resolved',
  declaration: { name: 'padding-inline', value: 'var(--x)', important: false, source: 'rule', level: 0 },
  selector: { served: '._b_abcde_2', original: '.b' },
  rule: { file: 'src/a.css', line: 3, col: 3 },
  varChain: {
    names: ['--x'],
    terminal: '4px',
    pure: true,
    fallbackUsed: false,
    status: 'complete',
    definitions: [{ name: '--x', value: '4px', loc: { file: 'src/tokens.css', line: 2, col: 3 } }],
  },
  valueCheck: 'match',
};

describe('verifyField', () => {
  it('accepts a declaration at its location inside the reported rule', () => {
    expect(verifyField(resolved, read)).toEqual({ rule: 'ok', selector: 'ok', definitions: 'ok' });
  });

  it('flags a wrong line, file, selector or definition', () => {
    expect(verifyField({ ...resolved, rule: { file: 'src/a.css', line: 2, col: 3 } }, read).rule).toBe('wrong');
    expect(verifyField({ ...resolved, rule: { file: 'src/missing.css', line: 3, col: 3 } }, read).rule).toBe('wrong');
    expect(verifyField({ ...resolved, selector: { served: 'x', original: '.c' } }, read)).toMatchObject({
      selector: 'wrong',
      detail: 'selector ".c" vs ".a, .b"',
    });
    const chain = resolved.varChain;
    if (chain === undefined) throw new Error('fixture');
    const wrongDef = {
      ...resolved,
      varChain: { ...chain, definitions: [{ name: '--x', loc: { file: 'src/tokens.css', line: 1, col: 1 } }] },
    };
    expect(verifyField(wrongDef, read).definitions).toBe('wrong');
  });

  it('has nothing to check without a location', () => {
    const { rule: _rule, varChain: _chain, ...rest } = resolved;
    expect(verifyField({ ...rest, status: 'unresolved', reason: 'user-agent' }, read)).toEqual({
      rule: 'n/a',
      selector: 'n/a',
      definitions: 'n/a',
    });
  });
});

describe('summarize / markdownTable', () => {
  const record = (component: string, field: FieldProvenance): FieldRecord => ({
    storyId: `${component}--x`,
    theme: 'light',
    component,
    nodeId: 'c1',
    path: 'div:0',
    kind: 'element',
    field,
    verdict: verifyField(field, read),
  });
  const records = [
    record('b', resolved),
    record('b', { ...resolved, rule: { file: 'src/a.css', line: 1, col: 1 } }),
    record('a', { property: 'padding-top', status: 'unresolved', reason: 'user-agent', valueCheck: 'unknown' }),
    record('a', { ...resolved, status: 'approximate' }),
    record('a', { property: 'color', status: 'selector-only', valueCheck: 'mismatch' }),
  ];

  it('counts per key and in total', () => {
    const rows = summarize(records, (r) => r.component);
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'all']);
    expect(rows[2]).toMatchObject({
      fields: 5,
      resolved: 1,
      approximateOk: 1,
      selectorOnly: 1,
      unresolved: 1,
      wrongFile: 1,
      withVar: 3,
      chainResolved: 3,
      chainComplete: 2,
      valueMatch: 3,
      valueMismatch: 1,
      reasons: { 'user-agent': 1 },
    });
  });

  it('renders a Markdown table', () => {
    const table = markdownTable(
      summarize(records, (r) => r.component),
      'component',
    );
    expect(table.split('\n')).toHaveLength(5);
    expect(table).toContain('| **all** | 5 | 1 (20.0%) | 1 / 0 | 1 | 1 (user-agent 1) |');
  });
});

describe('ProvenanceDiagnostics', () => {
  const options = { repoRoot: '/repo' };

  it('raises DCR_PROVENANCE_NO_SOURCEMAP once per file and MINIFIED for built CSS', () => {
    const diagnostics = new ProvenanceDiagnostics();
    const unmapped = classifySheet({ header: header('1') }, options);
    const devId = classifySheet({ header: header('2'), devId: '/repo/src/a.css' }, options);
    const sameFile = classifySheet({ header: header('3'), devId: '/repo/src/a.css' }, options);
    const built = classifySheet({ header: header('4', { sourceURL: 'http://127.0.0.1:1/assets/a.css' }) }, options);
    const mapped = classifySheet(
      { header: header('5'), sourceMap: { version: 3, sources: [], mappings: '' } },
      options,
    );
    for (const sheet of [unmapped, devId, sameFile, built, mapped, undefined]) diagnostics.observe('color', sheet);
    expect(diagnostics.list.map((d) => [d.code, d.severity, d.data])).toEqual([
      ['DCR_PROVENANCE_NO_SOURCEMAP', 'warn', { styleSheetId: '1', approximate: false }],
      ['DCR_PROVENANCE_NO_SOURCEMAP', 'warn', { styleSheetId: '2', file: 'src/a.css', approximate: true }],
      ['DCR_PROVENANCE_MINIFIED', 'info', { styleSheetId: '4', sourceURL: 'http://127.0.0.1:1/assets/a.css' }],
    ]);
  });
});
