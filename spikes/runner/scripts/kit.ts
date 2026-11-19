/**
 * Bundles the kit in memory: main thread (IIFE, ES2017 for Figma's sandbox), the UI document,
 * and the zip. `build.ts` writes the files; tests call this directly.
 * Runs under Node type stripping: no TypeScript-only runtime syntax here.
 */
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { uiHtml, zipKit } from './pack.ts';

export type Kit = {
  readonly version: string;
  readonly manifest: string;
  readonly main: string;
  readonly ui: string;
  readonly zip: Uint8Array;
  /** Source files esbuild put in each bundle, relative to `spikes/` (from the metafile). */
  readonly inputs: { readonly main: readonly string[]; readonly ui: readonly string[] };
};

type Bundle = { readonly text: string; readonly inputs: readonly string[] };

async function bundle(root: string, entry: string, target: string): Promise<Bundle> {
  const result = await build({
    entryPoints: [`${root}${entry}`],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target,
    minify: true,
    legalComments: 'none',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    write: false,
    metafile: true,
    absWorkingDir: root,
    logLevel: 'silent',
  });
  const [output] = result.outputFiles;
  if (!output) throw new Error(`esbuild produced no output for ${entry}`);
  return { text: output.text, inputs: Object.keys(result.metafile.inputs).sort() };
}

/** `root` is the `spikes/` folder, with a trailing slash. */
export async function buildKit(root: string): Promise<Kit> {
  const packageJson = JSON.parse(await readFile(`${root}package.json`, 'utf8')) as { version: string };
  const manifest = await readFile(`${root}runner/manifest.json`, 'utf8');
  const readme = await readFile(`${root}README.md`, 'utf8');
  // Figma's main sandbox accepts older syntax than the UI iframe (Chromium).
  const main = await bundle(root, 'runner/src/main.ts', 'es2017');
  const uiBundle = await bundle(root, 'runner/src/ui/index.tsx', 'es2020');
  const ui = uiHtml(uiBundle.text);
  const zip = zipKit({
    'manifest.json': manifest,
    'build/main.js': main.text,
    'build/ui.html': ui,
    'README.md': readme,
  });
  return {
    version: packageJson.version,
    manifest,
    main: main.text,
    ui,
    zip,
    inputs: { main: main.inputs, ui: uiBundle.inputs },
  };
}
