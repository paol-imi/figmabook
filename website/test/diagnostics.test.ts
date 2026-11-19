import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTICS_INDEX,
  DIAGNOSTICS_SOURCE,
  diagnosticAreas,
  loadDiagnosticPages,
  pageSlug,
  plainText,
  searchSections,
  toSiteMarkdown,
} from '../.vitepress/lib/diagnostics.ts';

const REPO = 'https://github.com/acme/ui';
const GENERATED = fileURLToPath(new URL(`../../${DIAGNOSTICS_SOURCE}/`, import.meta.url));

describe('pageSlug', () => {
  it('maps the index and code pages', () => {
    expect(pageSlug('README.md')).toBe('index');
    expect(pageSlug('CAP_PAGE_CRASHED.md')).toBe('CAP_PAGE_CRASHED');
    expect(pageSlug('SB_V7_UNSUPPORTED.md')).toBe('SB_V7_UNSUPPORTED');
  });

  it('ignores files that are not generated pages', () => {
    for (const name of ['notes.md', 'CAP.md', 'CAP_PAGE_CRASHED.txt', 'cap_page_crashed.md', '.DS_Store']) {
      expect(pageSlug(name)).toBeUndefined();
    }
  });
});

describe('toSiteMarkdown', () => {
  const page = [
    '- Behaviour: plan chapter [05](../plan/05-capture.md) (`05-capture.md`).',
    '- Catalog entry: [12 §6.2](../plan/12-quality.md#diagnostics).',
    '- All codes: [diagnostics index](README.md#CAP_PAGE_CRASHED).',
    '| Area | [Capture (`CAP_`)](README.md#domain-cap) |',
    'See [`CAP_PAGE_CRASHED`](CAP_PAGE_CRASHED.md) and [the README](README.md).',
  ].join('\n');

  it('points plan links at the repository and index links at the site index', () => {
    expect(toSiteMarkdown(page, REPO)).toBe(
      [
        '- Behaviour: plan chapter [05](https://github.com/acme/ui/blob/main/docs/plan/05-capture.md) (`05-capture.md`).',
        '- Catalog entry: [12 §6.2](https://github.com/acme/ui/blob/main/docs/plan/12-quality.md#diagnostics).',
        '- All codes: [diagnostics index](./index.md#CAP_PAGE_CRASHED).',
        '| Area | [Capture (`CAP_`)](./index.md#domain-cap) |',
        'See [`CAP_PAGE_CRASHED`](CAP_PAGE_CRASHED.md) and [the README](./index.md).',
      ].join('\n'),
    );
  });

  it('keeps plan link text as plain text without a repository', () => {
    expect(toSiteMarkdown(page, undefined).split('\n').slice(0, 2)).toEqual([
      '- Behaviour: plan chapter 05 (`05-capture.md`).',
      '- Catalog entry: 12 §6.2.',
    ]);
  });

  it('leaves other relative links alone, so the dead-link check still sees them', () => {
    expect(toSiteMarkdown('[x](../research/a.md) [y](../../README.md)', REPO)).toBe(
      '[x](../research/a.md) [y](../../README.md)',
    );
  });
});

describe('diagnosticAreas', () => {
  it('reads areas, anchors and codes in page order', () => {
    const index = [
      '## Areas',
      '',
      '- [Storybook (`SB_`)](#domain-sb): 2',
      '',
      '<a id="domain-sb"></a>',
      '',
      '## Storybook (`SB_`)',
      '',
      '| Code | Severity | What happened | What to do |',
      '|---|---|---|---|',
      '| <a id="SB_INDEX_UNREACHABLE"></a>[`SB_INDEX_UNREACHABLE`](SB_INDEX_UNREACHABLE.md) | error | a | b |',
      '| <a id="SB_STORY_ERROR"></a>[`SB_STORY_ERROR`](SB_STORY_ERROR.md) | error | a | b |',
      '',
      '<a id="domain-net"></a>',
      '',
      '## Network (`NET_`)',
      '',
      '| <a id="NET_PORT_IN_USE"></a>[`NET_PORT_IN_USE`](NET_PORT_IN_USE.md) | warning | a | b |',
    ].join('\n');
    expect(diagnosticAreas(index)).toEqual([
      { title: 'Storybook', prefix: 'SB', anchor: 'domain-sb', codes: ['SB_INDEX_UNREACHABLE', 'SB_STORY_ERROR'] },
      { title: 'Network', prefix: 'NET', anchor: 'domain-net', codes: ['NET_PORT_IN_USE'] },
    ]);
  });
});

describe('plainText', () => {
  it('keeps words and drops markup', () => {
    expect(
      plainText(
        '<!-- banner -->\n| | |\n|---|---|\n| Area | [Capture (`CAP_`)](./index.md#domain-cap) |\n**Run** `pnpm diag:gen` \\| now',
      ),
    ).toBe('Area Capture ( CAP_ ) Run pnpm diag:gen now');
  });
});

describe('searchSections', () => {
  it('indexes a code page as one section titled with the code', () => {
    const content = '<!-- x -->\n\n# `CAP_PAGE_CRASHED`\n\n## What happened\n\nThe page crashed.\n';
    expect(searchSections({ slug: 'CAP_PAGE_CRASHED', content })).toEqual([
      { titles: ['CAP_PAGE_CRASHED'], text: 'What happened The page crashed.' },
    ]);
  });

  it('indexes the index page by area, linking to each area anchor', () => {
    const content = [
      '# Diagnostics',
      '',
      'Intro.',
      '',
      '<a id="domain-sb"></a>',
      '',
      '## Storybook (`SB_`)',
      '',
      '| <a id="SB_STORY_ERROR"></a>[`SB_STORY_ERROR`](SB_STORY_ERROR.md) | error | A story threw. | Fix it. |',
    ].join('\n');
    expect(searchSections({ slug: 'index', content })).toEqual([
      { titles: ['Diagnostics'], text: 'Intro.' },
      {
        anchor: 'domain-sb',
        titles: ['Diagnostics', 'Storybook (SB_)'],
        text: 'SB_STORY_ERROR error A story threw. Fix it.',
      },
    ]);
  });

  it('gives every generated page searchable text', () => {
    for (const page of loadDiagnosticPages(GENERATED, REPO)) {
      const sections = searchSections(page);
      expect(sections.length, page.slug).toBeGreaterThan(0);
      expect(
        sections.every((section) => section.text.length > 0),
        page.slug,
      ).toBe(true);
    }
  });
});

describe('loadDiagnosticPages', () => {
  it('fails with the fix when the index is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotype-site-'));
    writeFileSync(join(dir, 'CAP_PAGE_CRASHED.md'), '# x\n');
    expect(() => loadDiagnosticPages(dir, REPO)).toThrow(/pnpm diag:gen/);
  });

  it('skips files that are not pages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotype-site-'));
    mkdirSync(join(dir, 'nested.md'));
    writeFileSync(join(dir, DIAGNOSTICS_INDEX), '# Diagnostics\n');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    writeFileSync(join(dir, 'CAP_PAGE_CRASHED.md'), '[i](README.md)\n');
    expect(loadDiagnosticPages(dir, REPO)).toEqual([
      { slug: 'CAP_PAGE_CRASHED', content: '[i](./index.md)\n' },
      { slug: 'index', content: '# Diagnostics\n' },
    ]);
  });

  it('serves every generated page, with no link left into unpublished docs', () => {
    const pages = loadDiagnosticPages(GENERATED, REPO);
    const areas = diagnosticAreas(readFileSync(join(GENERATED, DIAGNOSTICS_INDEX), 'utf8'));
    const codes = areas.flatMap((area) => area.codes);

    expect(areas.length).toBeGreaterThan(0);
    expect(new Set(pages.map((page) => page.slug))).toEqual(new Set(['index', ...codes]));
    for (const page of pages) {
      expect(page.content, page.slug).not.toMatch(/\]\((?:\.\.\/plan\/|README\.md)/);
    }
  });
});
