// @ts-check
// `pnpm -F @holotype/plugin run pack`: the release zip users import as a development plugin
// (02 §6.4, 11 §2.0). Reproducible: fixed entry order, timestamps and compression level.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

/** The files Figma needs: the manifest and the two bundles it points to. */
export const PLUGIN_FILES = Object.freeze(['manifest.json', 'build/main.js', 'build/ui.js']);

/** Placeholder manifest id, until Figma issues the real one (fixed forever afterwards, 02 §6.4). */
export const PLACEHOLDER_ID = 'holotype';

/**
 * Every entry gets this timestamp. Zip stores local wall-clock fields, so the date is built
 * from local components: the bytes are the same in every time zone.
 */
export const FIXED_MTIME = new Date(2000, 0, 1, 0, 0, 0);

/**
 * Zips `files` (path → bytes) deterministically: sorted paths, fixed mtime, fixed level.
 * @param {Readonly<Record<string, Uint8Array>>} files
 * @returns {Uint8Array}
 */
export function createPluginZip(files) {
  /** @type {Record<string, [Uint8Array, { mtime: Date; level: 9; os: 3; attrs: number }]>} */
  const entries = {};
  for (const path of Object.keys(files).sort()) {
    const bytes = files[path];
    if (bytes === undefined) continue;
    // 0o644 regular file, in the high 16 bits of the external attributes (Unix host).
    entries[path] = [bytes, { mtime: FIXED_MTIME, level: 9, os: 3, attrs: (0o100644 << 16) >>> 0 }];
  }
  return zipSync(entries);
}

/**
 * Reads the built plugin under `root` and writes `dist/holotype-plugin-<version>.zip`.
 * @param {URL} root package root, with a trailing slash
 * @returns {Promise<{ path: string; bytes: number; placeholderId: boolean }>}
 */
export async function packPlugin(root) {
  /** @type {Record<string, Uint8Array>} */
  const files = {};
  for (const path of PLUGIN_FILES) {
    try {
      files[path] = new Uint8Array(await readFile(new URL(path, root)));
    } catch (error) {
      throw new Error(`${path} is missing. Run \`pnpm -F @holotype/plugin build\` first.`, { cause: error });
    }
  }
  const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  const zip = createPluginZip(files);
  const out = new URL(`dist/holotype-plugin-${version}.zip`, root);
  await mkdir(new URL('dist/', root), { recursive: true });
  await writeFile(out, zip);
  return { path: fileURLToPath(out), bytes: zip.byteLength, placeholderId: manifest.id === PLACEHOLDER_ID };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { path, bytes, placeholderId } = await packPlugin(new URL('../', import.meta.url));
    console.log(`✓ ${path} (${(bytes / 1024).toFixed(1)} KB)`);
    if (placeholderId) {
      console.warn(
        `! The manifest id is the placeholder "${PLACEHOLDER_ID}". Replace it with the id Figma issues before the first release: it can never change afterwards.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
