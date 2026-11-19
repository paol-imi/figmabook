/**
 * Builds Holotype Spikes:
 *   runner/build/main.js and runner/build/ui.html (so runner/manifest.json can be imported as is)
 *   dist/holotype-spikes-<version>.zip and dist/holotype-spikes.zip (same bytes)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildKit } from './kit.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const kit = await buildKit(root);

await mkdir(`${root}runner/build`, { recursive: true });
await writeFile(`${root}runner/build/main.js`, kit.main);
await writeFile(`${root}runner/build/ui.html`, kit.ui);
await mkdir(`${root}dist`, { recursive: true });
await writeFile(`${root}dist/holotype-spikes-${kit.version}.zip`, kit.zip);
await writeFile(`${root}dist/holotype-spikes.zip`, kit.zip);

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const size = (text: string) => new TextEncoder().encode(text).length;
console.log(
  `Holotype Spikes ${kit.version}: main.js ${kb(size(kit.main))}, ui.html ${kb(size(kit.ui))}, zip ${kb(kit.zip.length)} → dist/holotype-spikes.zip`,
);
