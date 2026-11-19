import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/*
 * The plugin bundles layout-sim into Figma's main thread (02 §6.2, D-04): no Node APIs, and
 * syntax the plugin build lowers to its es2017 target. This bundles the package the same way
 * and runs it in a bare VM context with no Node globals.
 */
describe('browser and plugin bundle', () => {
  it('bundles for es2017 without Node built-ins and runs without Node globals', async () => {
    const output = await build({
      entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
      bundle: true,
      write: false,
      platform: 'browser',
      target: 'es2017',
      format: 'iife',
      globalName: 'layoutSim',
      conditions: ['@holotype/source'],
      treeShaking: true,
      logLevel: 'silent',
    });
    const code = output.outputFiles[0]?.text ?? '';
    expect(code.length).toBeGreaterThan(0);
    expect(code.length).toBeLessThan(40_000);

    const sandbox: { layoutSim?: { simulate: (root: unknown) => { ok: boolean; value: { size: unknown } } } } = {};
    runInNewContext(code, sandbox);
    const result = sandbox.layoutSim?.simulate({
      key: 'f',
      size: { w: 0, h: 0 },
      layout: {
        mode: 'HORIZONTAL',
        padding: { t: 8, r: 16, b: 8, l: 16 },
        itemSpacing: 4,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'CENTER',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'AUTO',
        strokesIncludedInLayout: false,
      },
      children: [
        { key: 'icon', size: { w: 16, h: 16 } },
        { key: 'label', size: { w: 40, h: 20 } },
      ],
    });
    expect(result?.ok).toBe(true);
    expect(JSON.stringify(result?.value.size)).toBe('{"w":92,"h":36}');
  });
});
