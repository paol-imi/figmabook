import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defineConfig,
  findConfigFile,
  loadConfig,
  mergeConfig,
  readConfigFile,
  resolveConfig,
  withoutPointer,
} from '../src';
import { defineConfig as fromSubpath } from '../src/config';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'holotype-config-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('finding the config file (11 §3.1)', () => {
  it('searches the working directory, then its parents', async () => {
    await writeFile(join(dir, 'holotype.config.json'), '{}');
    const nested = join(dir, 'a/b');
    await mkdir(nested, { recursive: true });
    expect(await findConfigFile(nested)).toBe(join(dir, 'holotype.config.json'));
  });

  it('prefers .ts over .json in one directory', async () => {
    await writeFile(join(dir, 'holotype.config.json'), '{}');
    await writeFile(join(dir, 'holotype.config.ts'), 'export default {};');
    expect(await findConfigFile(dir)).toBe(join(dir, 'holotype.config.ts'));
  });
});

describe('reading a config file', () => {
  it('parses JSON and imports modules', async () => {
    await writeFile(join(dir, 'a.json'), '{"storybook":{"source":"sb"}}');
    await writeFile(join(dir, 'b.mjs'), 'export default { storybook: { source: "sb" }, include: ["Micro/**"] };');
    await writeFile(
      join(dir, 'c.ts'),
      'const config: { storybook: { source: string } } = { storybook: { source: "sb" } };\nexport default config;\n',
    );
    expect(await readConfigFile(join(dir, 'a.json'))).toEqual({ ok: true, value: { storybook: { source: 'sb' } } });
    expect(await readConfigFile(join(dir, 'b.mjs'))).toEqual({
      ok: true,
      value: { storybook: { source: 'sb' }, include: ['Micro/**'] },
    });
    expect(await readConfigFile(join(dir, 'c.ts'))).toEqual({ ok: true, value: { storybook: { source: 'sb' } } });
  });

  it('reports PLAN_CONFIG_INVALID for a missing, broken or empty file', async () => {
    await writeFile(join(dir, 'broken.json'), '{');
    await writeFile(join(dir, 'empty.mjs'), 'export const x = 1;');
    const missing = await readConfigFile(join(dir, 'nope.json'));
    const broken = await readConfigFile(join(dir, 'broken.json'));
    const empty = await readConfigFile(join(dir, 'empty.mjs'));
    for (const result of [missing, broken, empty])
      expect(result.ok ? undefined : result.error.code).toBe('PLAN_CONFIG_INVALID');
    expect(empty.ok ? '' : empty.error.message).toBe('Invalid config value at /: empty.mjs has no default export.');
  });
});

describe('resolving the config (16 §1, §18)', () => {
  it('lets the flags win over the file', () => {
    const result = resolveConfig({ storybook: { source: 'from-file', requireTag: true } }, { storybook: 'from-flag' });
    expect(result.ok && result.value.config.storybook).toEqual({ source: 'from-flag', requireTag: true });
  });

  it('drops unknown keys with a PLAN_CONFIG_UNKNOWN_KEY warning', () => {
    const result = resolveConfig({ storybook: { source: 'sb', colour: 1 }, outptu: {} }, {}, 'holotype.config.json');
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.config).toEqual({ storybook: { source: 'sb' } });
    expect(result.value.warnings.map((w) => [w.code, w.message, w.value])).toEqual([
      ['PLAN_CONFIG_UNKNOWN_KEY', 'Unknown config key /outptu was ignored.', 'holotype.config.json'],
      ['PLAN_CONFIG_UNKNOWN_KEY', 'Unknown config key /storybook/colour was ignored.', 'holotype.config.json'],
    ]);
  });

  it('fails with PLAN_CONFIG_INVALID on a wrong value', () => {
    const result = resolveConfig({ storybook: { source: 'sb' }, capture: { dpr: 4 } }, {});
    expect(result.ok ? [] : result.error.map((d) => [d.code, d.severity, d.message])).toEqual([
      ['PLAN_CONFIG_INVALID', 'error', 'Invalid config value at /capture/dpr: Expected one of 1, 2, 3.'],
    ]);
  });

  it('names --storybook when no source is set', () => {
    const result = resolveConfig(undefined, {});
    expect(result.ok ? '' : result.error[0]?.message).toBe(
      'Invalid config value at /storybook: storybook.source is required: pass --storybook <dir|url> or run holotype init.',
    );
    const notObject = resolveConfig(['x'], {});
    expect(notObject.ok ? '' : notObject.error[0]?.message).toBe(
      'Invalid config value at /: the config must be an object.',
    );
  });

  it('loads the nearest file, or the one named with --config', async () => {
    await writeFile(join(dir, 'holotype.config.json'), '{"storybook":{"source":"sb"},"output":{"dir":"out"}}');
    await writeFile(join(dir, 'other.json'), '{"storybook":{"source":"other"}}');
    const nearest = await loadConfig(dir, {});
    expect(nearest.ok && nearest.value).toMatchObject({
      file: join(dir, 'holotype.config.json'),
      config: { output: { dir: 'out' } },
    });
    const named = await loadConfig(dir, {}, 'other.json');
    expect(named.ok && named.value.config.storybook.source).toBe('other');
    const missing = await loadConfig(dir, {}, 'missing.json');
    expect(missing.ok ? '' : missing.error[0]?.code).toBe('PLAN_CONFIG_INVALID');
  });
});

describe('merge helpers', () => {
  it('deep-merges objects, replaces arrays, unsets with null', () => {
    expect(mergeConfig({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, d: null })).toEqual({ a: { b: 1, c: [3] } });
    expect(mergeConfig({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it('removes a key by JSON pointer', () => {
    expect(withoutPointer({ a: { b: 1, 'x/y': 2 } }, '/a/x~1y')).toEqual({ a: { b: 1 } });
    expect(withoutPointer({ a: 1 }, '')).toEqual({ a: 1 });
  });

  it('types a config with defineConfig', () => {
    const config = { storybook: { source: 'storybook-static' } };
    expect(defineConfig(config)).toBe(config);
    expect(fromSubpath).toBe(defineConfig);
  });
});
