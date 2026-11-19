import { type Unzipped, unzipSync, type ZipOptions, zipSync } from 'fflate';
import { MANIFEST_FILE } from './build';

/**
 * Every entry's timestamp. Zip stores local wall-clock fields, so the date is built from
 * local components: the bytes are the same in every time zone (as the plugin's own pack).
 */
export const ZIP_MTIME = new Date(2000, 0, 1, 0, 0, 0);

/** DEFLATE level for JSON entries. */
export const JSON_LEVEL = 9;

/** Regular file, mode 0644, in the high 16 bits of the external attributes (Unix host). */
const FILE_ATTRS = (0o100644 << 16) >>> 0;

/** Assets are PNG/JPEG/GIF (already compressed) or SVG text (02 §5.1). */
function isCompressed(path: string, bytes: Uint8Array): boolean {
  if (!path.startsWith('assets/')) return false;
  const [a, b, c] = bytes;
  const png = a === 0x89 && b === 0x50 && c === 0x4e;
  const jpeg = a === 0xff && b === 0xd8 && c === 0xff;
  const gif = a === 0x47 && b === 0x49 && c === 0x46;
  return png || jpeg || gif;
}

/** The compression an entry gets: `STORE` for images, `DEFLATE` for JSON and SVG text (02 §5.1). */
export function entryMethod(path: string, bytes: Uint8Array): 'store' | 'deflate' {
  return isCompressed(path, bytes) ? 'store' : 'deflate';
}

/**
 * Zips a bundle deterministically: `manifest.json` first, so streaming readers can plan
 * early (06 §4.1), then the other files in the given order; fixed timestamps, attributes
 * and compression levels. The same files always give the same bytes.
 */
export function zipBundle(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const manifest = files.get(MANIFEST_FILE);
  if (manifest === undefined) throw new RangeError(`A bundle needs ${MANIFEST_FILE}.`);
  const entries: Record<string, [Uint8Array, ZipOptions]> = {};
  const add = (path: string, bytes: Uint8Array) => {
    const level = entryMethod(path, bytes) === 'store' ? 0 : JSON_LEVEL;
    entries[path] = [bytes, { level, mtime: ZIP_MTIME, os: 3, attrs: FILE_ATTRS }];
  };
  add(MANIFEST_FILE, manifest);
  for (const [path, bytes] of files) if (path !== MANIFEST_FILE) add(path, bytes);
  return zipSync(entries);
}

/** Reads a bundle zip back into its files (tests, `export`). */
export function unzipBundle(zip: Uint8Array): Unzipped {
  return unzipSync(zip);
}
