import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Catalog, catalogRows, formatIssue, parseCatalog } from '../src/index.ts';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(path, 'utf8');
const VALID = read(`${fixtures}valid/12-quality.md`);

function parseOk(markdown: string): Catalog {
  const result = parseCatalog(markdown, 'internal/plan/12-quality.md');
  if (!result.ok) throw new Error(result.issues.map((issue) => formatIssue('fixture', issue)).join('\n'));
  return result.catalog;
}

describe('parseCatalog: valid tables', () => {
  const catalog = parseOk(VALID);

  it('reads only the rows of the catalog section, in order', () => {
    expect(catalogRows(catalog).map((row) => row.code)).toEqual([
      'SB_INDEX_UNREACHABLE',
      'SB_NOT_A_STORYBOOK',
      'SB_ARG_UNKNOWN',
      'CAP_TREE_TOO_LARGE',
      'CAP_LICENSE_UNKNOWN',
    ]);
    expect(catalog.domains.map(({ prefix, title, count }) => ({ prefix, title, count }))).toEqual([
      { prefix: 'SB', title: 'Storybook', count: 3 },
      { prefix: 'CAP', title: 'Capture', count: 2 },
    ]);
  });

  it('parses every column', () => {
    const [index, hosted, arg, tree, license] = catalogRows(catalog);
    expect(index).toMatchObject({
      domain: 'SB',
      severity: 'error',
      emittedBy: ['storybook'],
      definedIn: { chapter: '03', file: '03-storybook.md' },
      line: 27,
    });
    expect(hosted).toMatchObject({
      emittedBy: ['cli', 'plugin'],
      emittedByMarkdown: '`cli` (hosted), `plugin`',
      definedIn: { chapter: '13', file: '13-security-legal.md', anchor: 'hosted' },
    });
    expect(arg?.severity).toBe('warn');
    expect(tree).toMatchObject({ severity: 'warn', severityNote: 'error over 8 MB', emittedBy: ['capture'] });
    expect(tree?.meaningMarkdown).toContain('`a \\| b`');
    expect(license).toMatchObject({ severity: 'info', emittedBy: ['CI'] });
    expect(index?.severityNote).toBeUndefined();
  });

  it('keeps prose around a table as domain notes, without anchors', () => {
    expect(catalog.domains[0]?.notes).toEqual([]);
    expect(catalog.domains[1]?.notes).toEqual([
      "Notes before the table become the domain's notes, even across two lines.",
      'A note after the table is kept too.',
    ]);
  });

  it('accepts CRLF line endings', () => {
    expect(parseOk(VALID.replaceAll('\n', '\r\n'))).toEqual(catalog);
  });
});

describe('parseCatalog: robust to edits of chapter 12', () => {
  const extraRow = '| `SB_NEW_CODE` | info | `storybook` | a new condition | Nothing to do | [03](03-storybook.md) |';

  it('accepts an added row once the counts are updated', () => {
    const edited = VALID.replace('#### Storybook (SB_) — 3', '#### Storybook (SB_) — 4')
      .replace('**5 codes in 2 domains:** SB 3 · CAP 2.', '**6 codes in 2 domains:** SB 4 · CAP 2.')
      .replace('| `SB_ARG_UNKNOWN`', `${extraRow}\n| \`SB_ARG_UNKNOWN\``);
    expect(catalogRows(parseOk(edited)).map((row) => row.code)).toContain('SB_NEW_CODE');
  });

  it('reports an added row whose counts were not updated', () => {
    const edited = VALID.replace('| `SB_ARG_UNKNOWN`', `${extraRow}\n| \`SB_ARG_UNKNOWN\``);
    const result = parseCatalog(edited, 'x.md');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((issue) => issue.message)).toEqual([
      'domain SB_ heading says 3 codes, its table has 4 rows',
    ]);
  });

  it('accepts a new domain section', () => {
    const edited = VALID.replace(
      '**5 codes in 2 domains:** SB 3 · CAP 2.',
      '**6 codes in 3 domains:** SB 3 · CAP 2 · NET 1',
    ).replace(
      'A note after the table is kept too.',
      [
        'A note after the table is kept too.',
        '',
        '#### Network (NET_) — 1',
        '',
        '| Code | Severity | Emitted by | Meaning | User remedy | Defined in |',
        '|---|---|---|---|---|---|',
        '| `NET_DOWN` | error | `cli` | the network is down | Retry later | [09](09-plugin.md) |',
      ].join('\n'),
    );
    expect(parseOk(edited).domains.map((domain) => domain.prefix)).toEqual(['SB', 'CAP', 'NET']);
  });

  it('accepts en dashes and hyphens in headings and a heading without a number', () => {
    const edited = VALID.replace('### 6.2 Catalog', '### Catalog')
      .replace('#### Storybook (SB_) — 3', '#### Storybook (SB_) – 3')
      .replace('#### Capture (CAP_) — 2', '#### Capture (CAP_) - 2');
    expect(parseOk(edited).domains).toHaveLength(2);
  });

  it('accepts tables with padded cells, as a markdown formatter writes them', () => {
    const padded = VALID.split('\n')
      .map((line) => (line.startsWith('|') && !line.includes('---') ? line.replaceAll(' | ', '    |    ') : line))
      .join('\n');
    expect(parseOk(padded)).toEqual({ ...parseOk(VALID) });
  });
});

describe('parseCatalog: malformed tables (golden)', () => {
  const cases = readdirSync(`${fixtures}malformed`)
    .filter((name) => name.endsWith('.md'))
    .sort();

  it('has malformed fixtures', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases)('%s', async (name) => {
    const result = parseCatalog(read(`${fixtures}malformed/${name}`), 'internal/plan/12-quality.md');
    expect(result.ok).toBe(false);
    const report = result.ok ? '' : result.issues.map((issue) => formatIssue('internal/plan/12-quality.md', issue));
    await expect(`${[...report].join('\n')}\n`).toMatchFileSnapshot(
      `fixtures/malformed/${name.replace(/\.md$/, '.errors.txt')}`,
    );
  });
});

describe('parseCatalog: the plan (12 §6.2)', () => {
  const catalog = parseOk(read(`${repoRoot}internal/plan/12-quality.md`));
  const rows = catalogRows(catalog);

  it('parses every row with unique codes and non-empty remedies', () => {
    expect(rows.length).toBeGreaterThanOrEqual(278);
    expect(new Set(rows.map((row) => row.code)).size).toBe(rows.length);
    for (const row of rows) expect(row.remedyMarkdown.trim(), row.code).not.toBe('');
  });

  it('matches its domain headings', () => {
    for (const domain of catalog.domains) expect(domain.rows).toHaveLength(domain.count);
    expect(catalog.domains.map((domain) => domain.prefix).slice(0, 3)).toEqual(['SB', 'PLAN', 'CAP']);
  });
});
