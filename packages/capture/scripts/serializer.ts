/**
 * Bundles the in-page serializer into an IIFE string and exposes it as the virtual module
 * `virtual:holotype-serializer`. One Rollup-style plugin serves both tsdown (Rolldown) and
 * Vitest (Vite). The IIFE itself stays a small standalone esbuild build: it targets the page,
 * not Node, and its bytes are what the capture goldens and the size budget are measured on.
 */
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const MODULE_ID = 'virtual:holotype-serializer';
const RESOLVED_ID = `\0${MODULE_ID}`;
const entry = fileURLToPath(new URL('../src/page/serializer.ts', import.meta.url));

export async function buildSerializer(): Promise<string> {
  const { outputFiles } = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    write: false,
  });
  const [output] = outputFiles;
  if (!output) throw new Error('The serializer build produced no output.');
  return output.text;
}

const moduleSource = async () => `export default ${JSON.stringify(await buildSerializer())};\n`;

/** The `virtual:holotype-serializer` module for Rolldown (tsdown) and Vite (Vitest). */
export function serializerPlugin() {
  return {
    name: 'holotype-serializer',
    resolveId: (id: string) => (id === MODULE_ID ? RESOLVED_ID : undefined),
    load: (id: string) => (id === RESOLVED_ID ? moduleSource() : undefined),
  };
}
