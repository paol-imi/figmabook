import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type ChapterTitles, renderDocs } from './emit-docs.ts';
import { CATALOG_MODULE_PATH, renderCatalogModule } from './emit-ts.ts';
import { chapterTitle } from './markdown.ts';
import { type Catalog, type CatalogIssue, catalogRows } from './model.ts';
import { parseCatalog } from './parse.ts';
import { CATALOG_SOURCE, DOCS_DIR, PLAN_DIR } from './paths.ts';
import { scanPackageSources } from './scan.ts';

export { CATALOG_SOURCE } from './paths.ts';

/** Thrown when the catalog tables are malformed; lists every problem as `file:line: message`. */
export class CatalogError extends Error {
  override readonly name = 'CatalogError';
  readonly issues: readonly CatalogIssue[];

  constructor(source: string, issues: readonly CatalogIssue[]) {
    super(
      [`The diagnostics catalog in ${source} is malformed:`, ...issues.map((i) => formatIssue(source, i))].join('\n'),
    );
    this.issues = issues;
  }
}

export function formatIssue(source: string, issue: CatalogIssue): string {
  return `${source}:${issue.line}: ${issue.message}`;
}

/** Reads and parses the catalog under `root`; throws {@link CatalogError} when malformed. */
export async function loadCatalog(root: string, source = CATALOG_SOURCE): Promise<Catalog> {
  const result = parseCatalog(await readFile(join(root, source), 'utf8'), source);
  if (!result.ok) throw new CatalogError(source, result.issues);
  return result.catalog;
}

/** Every generated file, keyed by repository-relative path, in a stable order. */
export function renderOutputs(catalog: Catalog, titles: ChapterTitles = new Map()): ReadonlyMap<string, string> {
  const outputs = new Map<string, string>([[CATALOG_MODULE_PATH, renderCatalogModule(catalog)]]);
  for (const [name, content] of renderDocs(catalog, titles)) outputs.set(`${DOCS_DIR}/${name}`, content);
  return outputs;
}

/**
 * The text of every chapter the catalog links to (its **Defined in** chapters and the catalog
 * itself), keyed by file name inside {@link PLAN_DIR}; `undefined` for a missing file.
 */
async function readChapters(root: string, catalog: Catalog): Promise<ReadonlyMap<string, string | undefined>> {
  const files = new Set([sourceFile(catalog.source), ...catalogRows(catalog).map((row) => row.definedIn.file)]);
  const chapters = new Map<string, string | undefined>();
  for (const file of [...files].sort()) chapters.set(file, await readOptional(join(root, PLAN_DIR, file)));
  return chapters;
}

/** Chapter titles from their headings, for the pages' "Where it is defined" links. */
function titlesOf(chapters: ReadonlyMap<string, string | undefined>): ChapterTitles {
  const titles = new Map<string, string>();
  for (const [file, text] of chapters) {
    const title = text === undefined ? undefined : chapterTitle(text);
    if (title) titles.set(file, title);
  }
  return titles;
}

function sourceFile(source: string): string {
  return source.slice(source.lastIndexOf('/') + 1);
}

export interface GenerateResult {
  /** Files whose content changed (or that were created). */
  readonly written: readonly string[];
  /** Stale docs pages that were deleted. */
  readonly removed: readonly string[];
}

/** `pnpm diag:gen`: writes the module and docs pages, and deletes pages of codes no longer listed. */
export async function generate(root: string): Promise<GenerateResult> {
  const catalog = await loadCatalog(root);
  const outputs = renderOutputs(catalog, titlesOf(await readChapters(root, catalog)));
  const written: string[] = [];
  for (const [path, content] of outputs) {
    if ((await readOptional(join(root, path))) === content) continue;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
    written.push(path);
  }
  const removed = await stalePages(root, outputs);
  for (const path of removed) await rm(join(root, path));
  return { written, removed };
}

export interface CheckReport {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * `pnpm diag:check`. Errors: a malformed catalog (row format, per-domain counts against the
 * headings and the summary line, duplicates); generated files that are stale or missing; a
 * docs page for a code that is not listed; a code literal in `packages/<name>/src` that is not
 * in the catalog; a **Defined in** link to a chapter that does not exist. Warnings: a defining
 * chapter that never mentions its code, or lacks the linked anchor (12 §6.1).
 */
export async function check(root: string): Promise<CheckReport> {
  let catalog: Catalog;
  try {
    catalog = await loadCatalog(root);
  } catch (error) {
    if (error instanceof CatalogError) {
      return { errors: error.issues.map((issue) => formatIssue(CATALOG_SOURCE, issue)), warnings: [] };
    }
    throw error;
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  const chapters = await readChapters(root, catalog);
  const outputs = renderOutputs(catalog, titlesOf(chapters));
  for (const [path, content] of outputs) {
    const actual = await readOptional(join(root, path));
    if (actual === undefined) errors.push(`${path}: missing; run \`pnpm diag:gen\``);
    else if (actual !== content) errors.push(`${path}: out of date with ${CATALOG_SOURCE}; run \`pnpm diag:gen\``);
  }
  for (const path of await stalePages(root, outputs)) {
    errors.push(`${path}: page for a code that is not in the catalog; run \`pnpm diag:gen\` to remove it`);
  }

  const codes = new Set(catalogRows(catalog).map((row) => row.code));
  const prefixes = catalog.domains.map((domain) => domain.prefix);
  for (const use of await scanPackageSources(root, prefixes)) {
    if (!codes.has(use.code)) {
      errors.push(
        `${use.file}:${use.line}: ${use.code} is not in the diagnostics catalog; add its row to ${CATALOG_SOURCE} first`,
      );
    }
  }

  for (const row of catalogRows(catalog)) {
    const { file, anchor } = row.definedIn;
    const text = chapters.get(file);
    const at = `${CATALOG_SOURCE}:${row.line}`;
    const path = `${PLAN_DIR}/${file}`;
    if (text === undefined) {
      errors.push(`${at}: ${row.code} is defined in ${path}, which does not exist`);
      continue;
    }
    if (!text.includes(row.code)) warnings.push(`${at}: ${path} does not mention ${row.code}`);
    if (anchor && !hasAnchor(text, anchor)) warnings.push(`${at}: ${path} has no #${anchor} anchor`);
  }
  return { errors, warnings };
}

/** Whether markdown has an explicit `id="…"` or a heading whose GitHub slug is `anchor`. */
export function hasAnchor(markdown: string, anchor: string): boolean {
  if (markdown.includes(`id="${anchor}"`)) return true;
  return markdown.split(/\r?\n/).some((line) => /^#{1,6}\s/.test(line) && slug(line.replace(/^#+\s*/, '')) === anchor);
}

function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

async function stalePages(root: string, outputs: ReadonlyMap<string, string>): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(join(root, DOCS_DIR));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${DOCS_DIR}/${name}`)
    .filter((path) => !outputs.has(path))
    .sort();
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
