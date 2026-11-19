/*
 * Unzipping an imported bundle in the UI iframe (09 §3.4 step 5) with fflate, inside the
 * safety limits of 06 §8: at most 200 MB compressed, 2 GB uncompressed and a compression
 * ratio of 100. fflate's asynchronous `unzip` inflates in Web Workers; where the null-origin
 * iframe cannot start one, the synchronous fallback runs on the UI thread (verify, S-06).
 */
import { createDiagnostic, type Diagnostic, diagnostic, err, ok, type Result } from '@holotype/shared';
import { type UnzipFileFilter, type Unzipped, unzip, unzipSync } from 'fflate';

export interface ZipLimits {
  readonly maxCompressedBytes: number;
  readonly maxUncompressedBytes: number;
  /** Uncompressed ÷ compressed bytes of the whole archive. */
  readonly maxRatio: number;
}

const MB = 1024 * 1024;

/** 06 §8 "Whole bundle". */
export const BUNDLE_LIMITS: ZipLimits = Object.freeze({
  maxCompressedBytes: 200 * MB,
  maxUncompressedBytes: 2048 * MB,
  maxRatio: 100,
});

/** An unzip implementation: fflate's, or a test double. */
export type Unzip = (bytes: Uint8Array, filter: UnzipFileFilter) => Promise<Unzipped>;

/**
 * fflate in Web Workers, falling back to the synchronous inflater, which also gives the
 * definitive error for a file that is not a zip. `filter` may see a file twice.
 */
export const fflateUnzip: Unzip = (bytes, filter) =>
  new Promise<Unzipped>((resolve, reject) => {
    const fallback = () => {
      try {
        resolve(unzipSync(bytes, { filter }));
      } catch (error) {
        reject(error);
      }
    };
    try {
      unzip(bytes, { filter }, (error, files) => (error ? fallback() : resolve(files)));
    } catch {
      fallback();
    }
  });

function rejected(reason: string, value?: string): Diagnostic {
  return createDiagnostic(diagnostic('APPLY_BUNDLE_REJECTED'), undefined, {
    ...(value === undefined ? {} : { value }),
    data: { reason },
  });
}

export const notAZip = (reason: string): Diagnostic =>
  createDiagnostic(diagnostic('APPLY_BUNDLE_CORRUPT'), undefined, { data: { reason: `not a zip file: ${reason}` } });

/**
 * The archive's files (directories left out), or `APPLY_BUNDLE_REJECTED` when it breaks a
 * limit, or `APPLY_BUNDLE_CORRUPT` when it is not a readable zip. Sizes are checked from the
 * central directory before anything is inflated.
 */
export async function unzipBundle(
  bytes: Uint8Array,
  limits: ZipLimits = BUNDLE_LIMITS,
  implementation: Unzip = fflateUnzip,
): Promise<Result<Readonly<Record<string, Uint8Array>>, Diagnostic>> {
  if (bytes.length > limits.maxCompressedBytes) {
    return err(rejected(`the file is ${bytes.length} bytes; the limit is ${limits.maxCompressedBytes}`));
  }
  let uncompressed = 0;
  const counted = new Set<string>();
  let violation: Diagnostic | undefined;
  const filter: UnzipFileFilter = (file) => {
    if (violation !== undefined || file.name.endsWith('/')) return false;
    if (!counted.has(file.name)) {
      counted.add(file.name);
      uncompressed += file.originalSize;
    }
    if (uncompressed > limits.maxUncompressedBytes) {
      violation = rejected(`more than ${limits.maxUncompressedBytes} bytes uncompressed`, file.name);
    } else if (uncompressed > Math.max(bytes.length, 1) * limits.maxRatio) {
      violation = rejected(`compression ratio above ${limits.maxRatio}`, file.name);
    }
    return violation === undefined;
  };
  let files: Unzipped;
  try {
    files = await implementation(bytes, filter);
  } catch (error) {
    return err(notAZip(error instanceof Error ? error.message : String(error)));
  }
  return violation === undefined ? ok(files) : err(violation);
}
