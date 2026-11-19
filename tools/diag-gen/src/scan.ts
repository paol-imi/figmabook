import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { compareCodeUnits } from './emit-ts.ts';

/** A diagnostic-code literal found in source. */
export interface CodeUse {
  /** Repository-relative path with `/` separators. */
  readonly file: string;
  /** 1-based line. */
  readonly line: number;
  readonly code: string;
}

/** Put this marker on a line to exempt its literals, e.g. a deliberately unknown code. */
export const IGNORE_MARKER = 'diag-check-ignore';

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
const LITERAL = /(['"`])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\1/g;

/**
 * Finds quoted literals that look like diagnostic codes: the whole literal is UPPER_SNAKE and
 * starts with one of `prefixes` (e.g. `'SB_RENDER_TIMEOUT'`, or `` `CAP_X` `` in a doc
 * comment). Identifiers such as `Node.TEXT_NODE` are not literals and are not reported.
 */
export function findCodeLiterals(text: string, prefixes: readonly string[]): { line: number; code: string }[] {
  const domains = new Set(prefixes);
  const found: { line: number; code: string }[] = [];
  text.split(/\r?\n/).forEach((content, index) => {
    if (content.includes(IGNORE_MARKER)) return;
    for (const match of content.matchAll(LITERAL)) {
      const code = match[2] ?? '';
      if (domains.has(code.slice(0, code.indexOf('_')))) found.push({ line: index + 1, code });
    }
  });
  return found;
}

/** Scans `<root>/packages/<name>/src/**` for code literals, in a stable file order. */
export async function scanPackageSources(root: string, prefixes: readonly string[]): Promise<CodeUse[]> {
  const uses: CodeUse[] = [];
  const packagesDir = join(root, 'packages');
  for (const name of await sortedEntries(packagesDir)) {
    if (!name.isDirectory()) continue;
    for (const file of await sourceFiles(join(packagesDir, name.name, 'src'))) {
      const path = relative(root, file).split(sep).join('/');
      const text = await readFile(file, 'utf8');
      for (const use of findCodeLiterals(text, prefixes)) uses.push({ file: path, ...use });
    }
  }
  return uses;
}

async function sourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await sortedEntries(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) files.push(...(await sourceFiles(path)));
    else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) files.push(path);
  }
  return files;
}

async function sortedEntries(dir: string) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.sort((a, b) => compareCodeUnits(a.name, b.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
