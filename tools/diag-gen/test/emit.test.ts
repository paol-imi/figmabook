import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { quote } from '../src/emit-ts.ts';
import { type Catalog, parseCatalog, renderCatalogModule, renderDocs, renderOutputs } from '../src/index.ts';

const fixture = fileURLToPath(new URL('fixtures/valid/12-quality.md', import.meta.url));

function load(): Catalog {
  const result = parseCatalog(readFileSync(fixture, 'utf8'), 'docs/plan/12-quality.md');
  if (!result.ok) throw new Error('fixture is malformed');
  return result.catalog;
}

describe('renderCatalogModule (golden)', () => {
  it('matches the golden module', async () => {
    await expect(renderCatalogModule(load())).toMatchFileSnapshot('fixtures/valid/expected/catalog.generated.ts');
  });

  it('is byte-identical across runs', () => {
    expect(renderCatalogModule(load())).toBe(renderCatalogModule(load()));
  });

  it('breaks a long property after the colon, as Biome does', () => {
    const output = renderCatalogModule(load());
    expect(output).toContain(
      "    message:\n      'The captured tree is over the node budget of the run, so it was cut; values like `a | b` and \"quotes\" and \\'single\\' and a back\\\\slash.',",
    );
  });
});

describe('renderDocs (golden)', () => {
  const pages = renderDocs(load());

  it('renders an index and one page per code, in sorted order', () => {
    expect([...pages.keys()]).toEqual([
      'README.md',
      'CAP_LICENSE_UNKNOWN.md',
      'CAP_TREE_TOO_LARGE.md',
      'SB_ARG_UNKNOWN.md',
      'SB_INDEX_UNREACHABLE.md',
      'SB_NOT_A_STORYBOOK.md',
    ]);
  });

  it.each([...pages.keys()])('matches the golden %s', async (name) => {
    await expect(pages.get(name)).toMatchFileSnapshot(`fixtures/valid/expected/docs/${name}`);
  });

  it('gives every code a stable anchor in the index', () => {
    const index = pages.get('README.md') ?? '';
    for (const name of pages.keys()) {
      if (name === 'README.md') continue;
      expect(index).toContain(`<a id="${name.replace('.md', '')}"></a>`);
    }
  });
});

describe('renderOutputs', () => {
  it('maps repository paths to the module and the docs pages', () => {
    const outputs = renderOutputs(load());
    expect([...outputs.keys()].slice(0, 2)).toEqual([
      'packages/shared/src/diagnostics/catalog.generated.ts',
      'docs/diagnostics/README.md',
    ]);
    expect(outputs.size).toBe(7);
  });
});

describe('quote', () => {
  it('prefers single quotes and switches when that needs fewer escapes', () => {
    expect(quote('plain')).toBe("'plain'");
    expect(quote("it's")).toBe('"it\'s"');
    expect(quote('say "hi"')).toBe('\'say "hi"\'');
    expect(quote(`'a' "b"`)).toBe(`'\\'a\\' "b"'`);
    expect(quote('a\\b\nc')).toBe("'a\\\\b\\nc'");
  });
});
