import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { createPluginZip, FIXED_MTIME, PLUGIN_FILES, packPlugin } from '../scripts/pack.mjs';
import { BUDGETS, checkBundleSizes, formatResult, KB } from '../scripts/size.mjs';

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A fake built plugin package in a temp directory. */
async function fakePackage(files: Record<string, string | Uint8Array>): Promise<URL> {
  dir = await mkdtemp(join(tmpdir(), 'holotype-plugin-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return pathToFileURL(`${dir}/`);
}

describe('pnpm size (D-04)', () => {
  it('budgets main at 400 KB and the UI at 600 KB', () => {
    expect(BUDGETS).toEqual({ 'build/main.js': 400 * KB, 'build/ui.js': 600 * KB });
  });

  it('passes bundles within budget and fails one over it', async () => {
    const root = await fakePackage({ 'build/main.js': 'x'.repeat(10), 'build/ui.js': new Uint8Array(600 * KB + 1) });
    const results = await checkBundleSizes(root);
    expect(results.map(({ file, ok }) => [file, ok])).toEqual([
      ['build/main.js', true],
      ['build/ui.js', false],
    ]);
    expect(results.map(formatResult)).toEqual([
      '✓ build/main.js: 0.0 KB (budget 400 KB)',
      '✗ build/ui.js: 600.0 KB (budget 600 KB)',
    ]);
  });

  it('says to build first when a bundle is missing', async () => {
    const root = await fakePackage({ 'build/main.js': '' });
    await expect(checkBundleSizes(root)).rejects.toThrow(
      'build/ui.js is missing. Run `pnpm -F @holotype/plugin build` first.',
    );
  });
});

describe('pack (02 §6.4)', () => {
  const files = {
    'manifest.json': JSON.stringify({ id: 'holotype', main: 'build/main.js', ui: 'build/ui.js' }),
    'build/main.js': 'main()',
    'build/ui.js': 'ui()',
  };

  it('is byte-identical across runs and insertion orders', () => {
    const encode = (entries: [string, string][]) =>
      Object.fromEntries(entries.map(([path, text]) => [path, new TextEncoder().encode(text)]));
    const a = createPluginZip(encode(Object.entries(files)));
    const b = createPluginZip(encode(Object.entries(files).reverse()));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('stores the fixed timestamp on every entry', () => {
    const zip = createPluginZip({ 'manifest.json': new Uint8Array([123, 125]) });
    // Local file header: DOS time at offset 10, date at 12 (little endian).
    const view = new DataView(zip.buffer, zip.byteOffset);
    const date = view.getUint16(12, true);
    expect([(date >> 9) + 1980, (date >> 5) & 15, date & 31]).toEqual([
      FIXED_MTIME.getFullYear(),
      FIXED_MTIME.getMonth() + 1,
      FIXED_MTIME.getDate(),
    ]);
    expect(view.getUint16(10, true)).toBe(0);
  });

  it('writes dist/holotype-plugin-<version>.zip with the manifest and both bundles', async () => {
    const root = await fakePackage({ ...files, 'package.json': JSON.stringify({ version: '1.2.3' }) });
    const result = await packPlugin(root);
    expect(result.path).toMatch(/dist[/\\]holotype-plugin-1\.2\.3\.zip$/);
    expect(result.placeholderId).toBe(true);
    const entries = unzipSync(new Uint8Array(await readFile(result.path)));
    expect(Object.keys(entries).sort()).toEqual([...PLUGIN_FILES].sort());
    expect(new TextDecoder().decode(entries['build/ui.js'])).toBe('ui()');
  });

  it('says to build first when the manifest is missing', async () => {
    const root = await fakePackage({ 'package.json': '{"version":"0.0.0"}' });
    await expect(packPlugin(root)).rejects.toThrow('manifest.json is missing.');
  });
});
