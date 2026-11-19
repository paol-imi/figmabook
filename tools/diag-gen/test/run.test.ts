import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.ts';
import { CatalogError, check, generate, hasAnchor, loadCatalog } from '../src/index.ts';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
const MODULE = 'packages/shared/src/diagnostics/catalog.generated.ts';

let root: string;

async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

/** A throwaway repository with the valid fixture catalog and the chapters it links to. */
async function seedRepo(): Promise<void> {
  await put('docs/plan/12-quality.md', await readFile(`${fixtures}valid/12-quality.md`, 'utf8'));
  await put('docs/plan/03-storybook.md', '# 03\n\n`SB_INDEX_UNREACHABLE`, `SB_ARG_UNKNOWN`\n');
  await put('docs/plan/13-security-legal.md', '# 13\n\n<a id="hosted"></a>\n\n`SB_NOT_A_STORYBOOK`\n');
  await put('docs/plan/05-capture.md', '# 05\n\n## Walk\n\n`CAP_TREE_TOO_LARGE`, `CAP_LICENSE_UNKNOWN`\n');
  await put('packages/capture/src/walk.ts', "export const code = 'CAP_TREE_TOO_LARGE';\n");
}

function silentLog() {
  const lines: string[] = [];
  const push = (...args: unknown[]): void => {
    lines.push(args.join(' '));
  };
  return { lines, log: { log: push, warn: push, error: push } };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'diag-gen-'));
  await seedRepo();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('generate', () => {
  it('writes the module and the docs pages, then reports nothing to do', async () => {
    const first = await generate(root);
    expect(first.written).toContain(MODULE);
    expect(first.written).toContain('docs/diagnostics/README.md');
    expect(first.written).toHaveLength(7);
    expect(await generate(root)).toEqual({ written: [], removed: [] });
  });

  it('is byte-identical across runs', async () => {
    await generate(root);
    const before = await readFile(join(root, MODULE), 'utf8');
    await rm(join(root, MODULE));
    await generate(root);
    expect(await readFile(join(root, MODULE), 'utf8')).toBe(before);
  });

  it('removes pages of codes that are no longer listed', async () => {
    await put('docs/diagnostics/SB_GONE.md', 'old');
    const result = await generate(root);
    expect(result.removed).toEqual(['docs/diagnostics/SB_GONE.md']);
    expect(await readdir(join(root, 'docs/diagnostics'))).not.toContain('SB_GONE.md');
  });

  it('throws a CatalogError listing every problem', async () => {
    await put('docs/plan/12-quality.md', await readFile(`${fixtures}malformed/bad-severity.md`, 'utf8'));
    await expect(generate(root)).rejects.toThrow(CatalogError);
    await expect(loadCatalog(root)).rejects.toThrow(/docs\/plan\/12-quality\.md:\d+: SB_ARG_UNKNOWN: severity/);
  });
});

describe('check', () => {
  beforeEach(async () => {
    await generate(root);
  });

  it('passes on a generated tree', async () => {
    expect(await check(root)).toEqual({ errors: [], warnings: [] });
  });

  it('fails on a stale or missing generated file', async () => {
    await put(MODULE, '// edited by hand\n');
    await rm(join(root, 'docs/diagnostics/SB_ARG_UNKNOWN.md'));
    expect((await check(root)).errors).toEqual([
      `${MODULE}: out of date with docs/plan/12-quality.md; run \`pnpm diag:gen\``,
      'docs/diagnostics/SB_ARG_UNKNOWN.md: missing; run `pnpm diag:gen`',
    ]);
  });

  it('fails on a page for a code that is not listed', async () => {
    await put('docs/diagnostics/SB_GONE.md', 'old');
    expect((await check(root)).errors).toEqual([
      'docs/diagnostics/SB_GONE.md: page for a code that is not in the catalog; run `pnpm diag:gen` to remove it',
    ]);
  });

  it('fails on a code literal in packages/*/src that is not in the catalog', async () => {
    await put(
      'packages/plugin/src/apply/nested.ts',
      [
        "export const a = 'SB_RENDER_TIMEOUT';",
        "export const b = 'SB_FAKE'; // diag-check-ignore",
        "export const c = 'NODE_ENV';",
      ].join('\n'),
    );
    await put('packages/plugin/test/fake.test.ts', "export const t = 'SB_ONLY_IN_TESTS';\n");
    await put('packages/plugin/src/node_modules/x.ts', "export const t = 'SB_VENDORED';\n");
    expect((await check(root)).errors).toEqual([
      'packages/plugin/src/apply/nested.ts:1: SB_RENDER_TIMEOUT is not in the diagnostics catalog; add its row to docs/plan/12-quality.md first',
    ]);
  });

  it('fails on a malformed catalog, listing each row', async () => {
    await put('docs/plan/12-quality.md', await readFile(`${fixtures}malformed/count-mismatch.md`, 'utf8'));
    expect((await check(root)).errors).toEqual([
      'docs/plan/12-quality.md:19: summary says 5 codes, the domain headings add up to 6',
      'docs/plan/12-quality.md:19: summary says SB 3, the SB_ heading says 4',
      'docs/plan/12-quality.md:23: domain SB_ heading says 4 codes, its table has 3 rows',
    ]);
  });

  it('fails on a link to a missing chapter and warns on a chapter that does not mention its code', async () => {
    await rm(join(root, 'docs/plan/13-security-legal.md'));
    await put('docs/plan/05-capture.md', '# 05\n\n`CAP_TREE_TOO_LARGE`\n');
    expect(await check(root)).toEqual({
      errors: [
        'docs/plan/12-quality.md:28: SB_NOT_A_STORYBOOK is defined in docs/plan/13-security-legal.md, which does not exist',
      ],
      warnings: [
        'docs/plan/12-quality.md:40: docs/plan/05-capture.md has no #walk anchor',
        'docs/plan/12-quality.md:41: docs/plan/05-capture.md does not mention CAP_LICENSE_UNKNOWN',
      ],
    });
  });
});

describe('hasAnchor', () => {
  it('finds explicit ids and heading slugs', () => {
    expect(hasAnchor('<a id="walk"></a>', 'walk')).toBe(true);
    expect(hasAnchor('## Portals and overlays', 'portals-and-overlays')).toBe(true);
    expect(hasAnchor('## 6. Diagnostics catalog', '6-diagnostics-catalog')).toBe(true);
    expect(hasAnchor('Walk', 'walk')).toBe(false);
  });
});

describe('cli main', () => {
  it('gen then check exit 0', async () => {
    const { log } = silentLog();
    expect(await main(['gen', '--root', root], log)).toBe(0);
    expect(await main(['check', '--root', root], log)).toBe(0);
  });

  it('check exits 1 and prints each error', async () => {
    const { lines, log } = silentLog();
    expect(await main(['check', '--root', root], log)).toBe(1);
    expect(lines).toContain(`error: ${MODULE}: missing; run \`pnpm diag:gen\``);
    expect(lines.at(-1)).toBe('diag:check: 7 errors');
  });

  it('gen exits 1 on a malformed catalog', async () => {
    await put('docs/plan/12-quality.md', await readFile(`${fixtures}malformed/no-anchor.md`, 'utf8'));
    const { lines, log } = silentLog();
    expect(await main(['gen', '--root', root], log)).toBe(1);
    expect(lines.join('\n')).toMatch(/malformed:\ndocs\/plan\/12-quality\.md:1: missing the/);
  });

  it('exits 2 on usage errors', async () => {
    const { log } = silentLog();
    expect(await main([], log)).toBe(2);
    expect(await main(['gen', '--bogus'], log)).toBe(2);
  });
});
