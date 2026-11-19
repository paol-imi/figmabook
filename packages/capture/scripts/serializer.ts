/**
 * Bundles the in-page serializer into an IIFE string and exposes it as the virtual module
 * `virtual:holotype-serializer`, both to tsup (esbuild) and to Vitest (Vite).
 */
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

const MODULE_ID = 'virtual:holotype-serializer';
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

export function serializerEsbuildPlugin(): Plugin {
  return {
    name: 'holotype-serializer',
    setup(builder) {
      builder.onResolve({ filter: /^virtual:holotype-serializer$/ }, ({ path }) => ({ path, namespace: MODULE_ID }));
      builder.onLoad({ filter: /.*/, namespace: MODULE_ID }, async () => ({ contents: await moduleSource(), loader: 'js' }));
    },
  };
}

export function serializerVitePlugin() {
  const resolvedId = `\0${MODULE_ID}`;
  return {
    name: 'holotype-serializer',
    resolveId: (id: string) => (id === MODULE_ID ? resolvedId : undefined),
    load: (id: string) => (id === resolvedId ? moduleSource() : undefined),
  };
}
