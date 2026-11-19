// Writes the JSON Schema files (06 §7) from the built package. Run by `pnpm build`.
import { mkdir, writeFile } from 'node:fs/promises';
import { jsonSchemaFiles } from '../dist/index.js';

const outDir = new URL('../schema/', import.meta.url);
await mkdir(outDir, { recursive: true });
for (const [name, contents] of Object.entries(jsonSchemaFiles())) {
  await writeFile(new URL(name, outDir), contents);
}
