// Writes the committed JSON Schema files (06 §7). Run by `pnpm build`, which first bundles
// this script from source (tsdown.emit.config.ts) into dist/.emit/, so no prior workspace
// build is needed. Paths are relative to that bundle.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { jsonSchemaFiles } from '../src/json-schema';

const outDir = new URL('../../schema/', import.meta.url);
const files = jsonSchemaFiles();
await mkdir(outDir, { recursive: true });
for (const name of await readdir(outDir)) {
  if (name.endsWith('.json') && !Object.hasOwn(files, name)) await rm(new URL(name, outDir));
}
for (const [name, contents] of Object.entries(files)) {
  await writeFile(new URL(name, outDir), contents);
}
