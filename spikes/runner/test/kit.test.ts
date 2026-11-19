import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import productPackage from '../../../packages/plugin/package.json';
import manifest from '../manifest.json';
import { buildKit, type Kit } from '../scripts/kit.ts';
import { KIT_FOLDER, uiHtml, zipKit } from '../scripts/pack.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const KB = 1024;

describe('manifest (BUILD §9.1)', () => {
  it('is a separate development plugin, never the product plugin id', () => {
    expect(manifest.id).not.toBe(productPackage['figma-plugin'].id);
    expect(manifest.name).toBe('Holotype Spikes');
  });

  it('runs under the same conditions as the product plugin', () => {
    expect(manifest).toMatchObject({
      api: '1.0.0',
      editorType: ['figma'],
      documentAccess: 'dynamic-page',
      enablePrivatePluginApi: true,
      main: 'build/main.js',
      ui: 'build/ui.html',
    });
    expect(manifest.permissions).toEqual(['teamlibrary']);
  });

  it('needs no network access', () => {
    expect(manifest.networkAccess).toEqual({ allowedDomains: ['none'] });
  });
});

describe('pack helpers', () => {
  it('escapes a closing script tag inside the UI bundle', () => {
    const html = uiHtml('const s = "</script>";');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain('<\\/script>');
  });

  it('zips under one folder, sorted, with fixed timestamps (same bytes every time)', () => {
    const first = zipKit({ 'b.txt': 'b', 'a.txt': new Uint8Array([97]) });
    const second = zipKit({ 'a.txt': 'a', 'b.txt': 'b' });
    expect(first).toEqual(second);
    expect(Object.keys(unzipSync(first))).toEqual([`${KIT_FOLDER}/a.txt`, `${KIT_FOLDER}/b.txt`]);
  });
});

describe('buildKit', () => {
  let kit: Kit;
  beforeAll(async () => {
    kit = await buildKit(root);
  }, 60_000);

  it('zips manifest.json, the two bundles and the README under holotype-spikes/', async () => {
    const files = unzipSync(kit.zip);
    expect(Object.keys(files)).toEqual([
      `${KIT_FOLDER}/README.md`,
      `${KIT_FOLDER}/build/main.js`,
      `${KIT_FOLDER}/build/ui.html`,
      `${KIT_FOLDER}/manifest.json`,
    ]);
    const zipped = (path: string) => strFromU8(files[`${KIT_FOLDER}/${path}`] ?? new Uint8Array());
    expect(zipped('manifest.json')).toBe(await readFile(`${root}runner/manifest.json`, 'utf8'));
    expect(zipped('build/main.js')).toBe(kit.main);
    expect(zipped('README.md')).toContain('Import plugin from manifest');
  });

  it('produces a main bundle that parses as a classic script and stays within the plugin budgets (D-04)', () => {
    expect(() => new Function(kit.main)).not.toThrow();
    expect(kit.main.length).toBeLessThan(400 * KB);
    expect(kit.ui.length).toBeLessThan(600 * KB);
  });

  it('keeps test-only and Node code out of the bundles', () => {
    for (const inputs of [kit.inputs.main, kit.inputs.ui]) {
      expect(inputs.length).toBeGreaterThan(0);
      // Answer schemas, tests and TypeBox's Value module are test-only; S-06 bundles only the compiler.
      expect(inputs.filter((path) => /(^|\/)schema\.ts$|\/test\//.test(path))).toEqual([]);
      expect(inputs.filter((path) => /typebox\/build\/esm\/value\/value\//.test(path))).toEqual([]);
    }
    for (const bundle of [kit.main, kit.ui]) {
      expect(bundle).not.toContain('playwright');
      expect(bundle).not.toContain('node:');
    }
  });

  it('bundles the TypeBox compiler for the S-06 code-generation probe, and fflate only in the UI', () => {
    const typeboxCompiler = (path: string) => /@sinclair\/typebox\/build\/esm\/compiler\//.test(path);
    const fflate = (path: string) => /\/fflate\//.test(path);
    expect(kit.inputs.main.some(typeboxCompiler)).toBe(true);
    expect(kit.inputs.ui.some(typeboxCompiler)).toBe(true);
    expect(kit.inputs.ui.some(fflate)).toBe(true);
    expect(kit.inputs.main.some(fflate)).toBe(false);
  });

  it('ships the UI as one HTML document with the S-05 references inside', () => {
    expect(kit.ui.startsWith('<!doctype html>')).toBe(true);
    expect(kit.ui).toContain('<div id="app"></div><script>');
    expect(kit.ui).toContain('holotype-s05-refs/1');
  });

  it('is deterministic', async () => {
    const again = await buildKit(root);
    expect(again.zip).toEqual(kit.zip);
  }, 60_000);
});
