/**
 * Builds and checks `fixtures/fonts.lock`: every font file the fixture design system ships,
 * with its sha256 (12 §1.2). The single source of truth is `src/styles/fonts.css`: each of its
 * `@import`s names a Fontsource stylesheet, and each `url()` in those stylesheets is a locked file.
 *
 * Runs under plain Node (type stripping), so it uses only erasable TypeScript syntax.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = fileURLToPath(new URL('..', import.meta.url));
export const fontsCssPath = join(packageRoot, 'src/styles/fonts.css');
export const fontsLockPath = join(packageRoot, '..', 'fonts.lock');

export interface LockedFontFile {
  /** Path inside the npm package, for example `files/inter-latin-400-normal.woff2`. */
  path: string;
  format: string;
  sha256: string;
}

export interface LockedFontFace {
  family: string;
  weight: number;
  style: string;
  /** The npm package the files come from, and its exact version. */
  package: string;
  version: string;
  /** The stylesheet inside the package that declares the face. */
  stylesheet: string;
  files: LockedFontFile[];
}

export interface FontsLock {
  lockfileVersion: 1;
  faces: LockedFontFace[];
}

export interface FontFaceRule {
  family: string;
  weight: number;
  style: string;
  sources: { url: string; format: string }[];
}

const require = createRequire(import.meta.url);

/** Returns the bare specifiers of the `@import "…"` rules in a stylesheet, in order. */
export function parseImports(css: string): string[] {
  return [...css.matchAll(/@import\s+["']([^"']+)["']\s*;/g)].map((m) => m[1] ?? '');
}

/** Parses the `@font-face` rules of a Fontsource stylesheet. */
export function parseFontFaces(css: string): FontFaceRule[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => {
    const body = match[1] ?? '';
    const descriptor = (name: string): string => {
      const value = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim();
      if (value === undefined) throw new Error(`@font-face without "${name}" in:\n${body}`);
      return value;
    };
    const sources = [...descriptor('src').matchAll(/url\(([^)]+)\)\s*format\(["']?([^"')]+)["']?\)/g)].map((m) => ({
      url: (m[1] ?? '').replace(/^["']|["']$/g, ''),
      format: m[2] ?? '',
    }));
    return {
      family: descriptor('font-family').replace(/^["']|["']$/g, ''),
      weight: Number(descriptor('font-weight')),
      style: descriptor('font-style'),
      sources,
    };
  });
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Splits a bare specifier such as `@fontsource/inter/latin-400.css` into package name and subpath. */
function splitSpecifier(specifier: string): { name: string; subpath: string } {
  const parts = specifier.split('/');
  const count = specifier.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, count).join('/'), subpath: parts.slice(count).join('/') };
}

/** Computes the lock from `src/styles/fonts.css` and the installed font packages. */
export function computeFontsLock(fontsCss = readFileSync(fontsCssPath, 'utf8')): FontsLock {
  const faces = parseImports(fontsCss).flatMap((specifier): LockedFontFace[] => {
    const { name, subpath } = splitSpecifier(specifier);
    const manifestPath = require.resolve(`${name}/package.json`, { paths: [packageRoot] });
    const pkgDir = dirname(manifestPath);
    const { version } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string };
    const stylesheetPath = join(pkgDir, subpath);
    return parseFontFaces(readFileSync(stylesheetPath, 'utf8')).map((face) => ({
      family: face.family,
      weight: face.weight,
      style: face.style,
      package: name,
      version,
      stylesheet: subpath,
      files: face.sources.map((source) => {
        const filePath = join(dirname(stylesheetPath), source.url);
        return { path: relative(pkgDir, filePath), format: source.format, sha256: sha256File(filePath) };
      }),
    }));
  });
  if (faces.length === 0) throw new Error(`${fontsCssPath} imports no font stylesheets.`);
  return { lockfileVersion: 1, faces };
}

/** The exact bytes written to `fixtures/fonts.lock`. */
export function serializeFontsLock(lock: FontsLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function readFontsLock(path = fontsLockPath): FontsLock {
  return JSON.parse(readFileSync(path, 'utf8')) as FontsLock;
}
