import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'ui' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('main-thread imports of @holotype/ir', () => {
  // create-figma-plugin `require`s the main entry, which defeats tree shaking of the ir root
  // entry: one value import from it pulls every TypeBox schema into build/main.js (D-04).
  it('use the lean `@holotype/ir/core` entry for values; the root entry for types only', () => {
    const offenders = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/^import\s+(type\s+)?[^;]*?from\s+'@holotype\/ir'/gms)]
        .filter((match) => match[1] === undefined)
        .map(() => relative(SRC, file)),
    );
    expect(offenders).toEqual([]);
  });
});
