import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DOCS_DIR, renderDocs } from './emit-docs.ts';
import { CATALOG_MODULE_PATH, renderCatalogModule } from './emit-ts.ts';
import { type Catalog, type CatalogIssue, catalogRows } from './model.ts';
import { parseCatalog } from './parse.ts';
import { scanPackageSources } from './scan.ts';

/** The catalog source, repository-relative (12 §6.2). */
export const CATALOG_SOURCE = 'docs/plan/12-quality.md';

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
export function renderOutputs(catalog: Catalog): ReadonlyMap<string, string> {
  const outputs = new Map<string, string>([[CATALOG_MODULE_PATH, renderCatalogModule(catalog)]]);
  for (const [name, content] of renderDocs(catalog)) outputs.set(`${DOCS_DIR}/${name}`, content);
  return outputs;
}

export interface GenerateResult {
  /** Files whose content changed (or that were created). */
  readonly written: readonly string[];
  /** Stale docs pages that were deleted. */
  readonly removed: readonly string[];
}

/** `pnpm diag:gen`: writes the module and docs pages, and deletes pages of codes no longer listed. */
export async function generate(root: string): Promise<GenerateResult> {
  const outputs = renderOutputs(await loadCatalog(root));
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
  const outputs = renderOutputs(catalog);
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

  const chapters = new Map<string, string | undefined>();
  for (const row of catalogRows(catalog)) {
    const { file, anchor } = row.definedIn;
    if (!chapters.has(file)) chapters.set(file, await readOptional(join(root, 'docs/plan', file)));
    const text = chapters.get(file);
    const at = `${CATALOG_SOURCE}:${row.line}`;
    if (text === undefined) {
      errors.push(`${at}: ${row.code} is defined in docs/plan/${file}, which does not exist`);
      continue;
    }
    if (!text.includes(row.code)) warnings.push(`${at}: docs/plan/${file} does not mention ${row.code}`);
    if (anchor && !hasAnchor(text, anchor)) warnings.push(`${at}: docs/plan/${file} has no #${anchor} anchor`);
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
