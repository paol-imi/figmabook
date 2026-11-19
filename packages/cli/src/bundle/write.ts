import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { type Bundle, MANIFEST_FILE } from './build';
import { zipBundle } from './zip';

/** The suffix that selects the zip form of `--out` (02 §5.1). */
export const ZIP_SUFFIX = '.holotype.zip';

export interface WrittenBundle {
  /** Absolute path of the zip file or the bundle directory. */
  readonly path: string;
  readonly kind: 'zip' | 'dir';
  /** Size of the zip, or the sum of the files of a directory bundle. */
  readonly bytes: number;
}

/** `zip` when `out` names a `.holotype.zip` file, else `dir`. */
export function outputKind(out: string): 'zip' | 'dir' {
  return out.toLowerCase().endsWith(ZIP_SUFFIX) ? 'zip' : 'dir';
}

async function writeAtomically(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, path);
}

/**
 * Writes a bundle to `out` (resolved against `cwd`): a `.holotype.zip` file, or a directory
 * holding the bundle tree (02 §5.1). A zip is written to a temporary name and renamed, so a
 * reader never sees half a file. A directory's previous bundle files are replaced; other
 * files in it are left alone.
 */
export async function writeBundle(bundle: Bundle, out: string, cwd: string = process.cwd()): Promise<WrittenBundle> {
  const path = resolve(cwd, out);
  if (outputKind(path) === 'zip') {
    const zip = zipBundle(bundle.files);
    await writeAtomically(path, zip);
    return { path, kind: 'zip', bytes: zip.byteLength };
  }
  for (const folder of ['components', 'assets']) await rm(join(path, folder), { recursive: true, force: true });
  // The manifest goes last, so it never names a file that is not there yet.
  const ordered = [...bundle.files].sort(([a], [b]) => Number(a === MANIFEST_FILE) - Number(b === MANIFEST_FILE));
  let bytes = 0;
  for (const [file, content] of ordered) {
    await writeAtomically(join(path, file), content);
    bytes += content.byteLength;
  }
  return { path, kind: 'dir', bytes };
}
