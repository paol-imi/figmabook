import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as core from '../src/core';
import * as root from '../src/index';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');

/** Relative modules `file` imports at runtime (`import type` and `export type` are erased). */
function runtimeImports(file: string): string[] {
  const source = readFileSync(join(SRC, file), 'utf8');
  const specifiers: string[] = [];
  for (const match of source.matchAll(/^(import|export)\s+(type\s+)?[^;]*?from\s+'(\.[^']+)'/gms)) {
    if (match[2] === undefined && match[3] !== undefined) specifiers.push(match[3]);
  }
  return specifiers.map((specifier) => `${join(dirname(file), specifier)}.ts`);
}

function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...runtimeImports(file));
  }
  return seen;
}

describe('@holotype/ir/core (the lean plugin-main entry)', () => {
  it('re-exports the same bindings as the root entry', () => {
    const entries = Object.entries(core);
    const rootExports = new Map(Object.entries(root));
    expect(entries.length).toBeGreaterThan(20);
    for (const [name, value] of entries) expect(value, name).toBe(rootExports.get(name));
  });

  it('has versions, hashing and the ah normalizer', () => {
    expect(Object.keys(core)).toEqual(
      expect.arrayContaining(['SUPPORTED_SCENE_MAJORS', 'parseMajor', 'checkVersion', 'sha256Hex', 'h16']),
    );
    expect(Object.keys(core)).toEqual(expect.arrayContaining(['fnv1a64', 'normalizeGroups', 'appliedHash']));
  });

  it('loads no schema, validator or TypeBox module at runtime', () => {
    const modules = [...closure('core.ts')];
    expect(modules).toEqual(expect.arrayContaining(['hash.ts', 'utf8.ts', 'normalize.ts', 'versions.ts']));
    expect(modules.filter((file) => file.startsWith('schema/') || file === 'validate.ts')).toEqual([]);
    for (const file of modules) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).not.toMatch(/from '@sinclair\/typebox/);
    }
  });
});
