/**
 * S-06 probes that only make sense in the UI iframe: the security context, Web Workers from
 * a Blob URL, and fflate's async `unzip` (which hands large entries to such a worker).
 * Every probe catches its own errors and records the message.
 */
import type { unzip, unzipSync, zipSync } from 'fflate';
import { probe } from '../_shared/figma.ts';
import { check, type Globals, isOk, type Outcome } from './sandbox.ts';
import { withTimeout } from './timeout.ts';

export const WORKER_ECHO_TIMEOUT_MS = 2000;
export const UNZIP_TIMEOUT_MS = 5000;
const PING = 'holotype-s06-worker-ping';

export type ContextFacts = {
  readonly isSecureContext: boolean | null;
  /** `location.origin` of the plugin window, e.g. `null` for an opaque origin. */
  readonly origin: string | null;
  readonly error: string | null;
};

export async function contextFacts(globals: Globals): Promise<ContextFacts> {
  const secure = globals.isSecureContext;
  const origin = await probe(() => (globals.location as Location | undefined)?.origin ?? null);
  return {
    isSecureContext: typeof secure === 'boolean' ? secure : null,
    origin: origin.ok ? origin.value : null,
    error: origin.ok ? null : origin.error,
  };
}

export type WorkerFacts = Outcome & { readonly ms: number | null };

/** Starts a Worker from a Blob URL and waits for it to echo one message. */
export async function blobWorkerFacts(
  globals: Globals,
  options: { timeoutMs: number; now: () => number } = { timeoutMs: WORKER_ECHO_TIMEOUT_MS, now: Date.now },
): Promise<WorkerFacts> {
  const WorkerCtor = globals.Worker as typeof Worker | undefined;
  const BlobCtor = globals.Blob as typeof Blob | undefined;
  const urls = globals.URL as typeof URL | undefined;
  const present =
    typeof WorkerCtor === 'function' && typeof BlobCtor === 'function' && typeof urls?.createObjectURL === 'function';
  const started = options.now();
  const outcome = await check(
    present,
    async () => {
      const api = urls as typeof URL;
      const source = api.createObjectURL(
        new (BlobCtor as typeof Blob)(['onmessage=function(e){postMessage(e.data)}'], { type: 'text/javascript' }),
      );
      let worker: Worker | undefined;
      try {
        const created = new (WorkerCtor as typeof Worker)(source);
        worker = created;
        const echoed = new Promise<unknown>((resolve, reject) => {
          created.onmessage = (event) => resolve(event.data);
          created.onerror = (event) => reject(new Error(event.message || 'worker error event'));
        });
        created.postMessage(PING);
        return await withTimeout(echoed, options.timeoutMs, 'Blob URL worker echo');
      } finally {
        worker?.terminate();
        api.revokeObjectURL?.(source);
      }
    },
    (echo) => echo === PING,
  );
  return { ...outcome, ms: isOk(outcome) ? Math.round(options.now() - started) : null };
}

/** The fflate functions the probe uses, injectable for tests. */
export type ZipLib = {
  readonly zipSync: typeof zipSync;
  readonly unzip: typeof unzip;
  readonly unzipSync: typeof unzipSync;
};

/**
 * Which way of unzipping worked, best first. `async-worker`: async `unzip` of an entry large
 * enough that fflate decompresses it in a Worker. `async-inline`: async `unzip` of a tiny zip
 * (fflate decompresses entries under 512 KB on the calling thread). `sync`: only `unzipSync`.
 */
export type ZipPath = 'async-worker' | 'async-inline' | 'sync' | 'none';

export type FflateFacts = {
  readonly asyncUnzipSmall: Outcome;
  readonly asyncUnzipLarge: Outcome;
  readonly unzipSync: Outcome;
  readonly path: ZipPath;
};

const SMALL_TEXT = 'holotype s06 unzip test';
/** Above fflate's 512 KB threshold, so async `unzip` inflates it in a Worker; compresses to ~1 KB. */
export const LARGE_ENTRY_BYTES = 600 * 1024;

const loadFflate = async (): Promise<ZipLib> => import('fflate');

/** Async `unzip` with a deadline; on failure, any worker fflate started is terminated. */
async function unzipAsync(lib: ZipLib, data: Uint8Array, timeoutMs: number): Promise<Record<string, Uint8Array>> {
  let terminate: (() => void) | undefined;
  const result = new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    terminate = lib.unzip(data, (error, files) => (error ? reject(error) : resolve(files)));
  });
  try {
    return await withTimeout(result, timeoutMs, 'fflate unzip');
  } catch (error) {
    terminate?.();
    throw error;
  }
}

function sameText(bytes: Uint8Array | undefined, text: string): boolean {
  return bytes !== undefined && new TextDecoder().decode(bytes) === text;
}

function isLargeEntry(bytes: Uint8Array | undefined): boolean {
  return bytes?.length === LARGE_ENTRY_BYTES && bytes[0] === 7 && bytes[LARGE_ENTRY_BYTES - 1] === 7;
}

export async function fflateFacts(
  load: () => Promise<ZipLib> = loadFflate,
  timeoutMs = UNZIP_TIMEOUT_MS,
): Promise<FflateFacts> {
  const loaded = await probe(load);
  if (!loaded.ok) {
    const failed: Outcome = { status: 'error', error: loaded.error };
    return { asyncUnzipSmall: failed, asyncUnzipLarge: failed, unzipSync: failed, path: 'none' };
  }
  const lib = loaded.value;
  const small = () => lib.zipSync({ 'small.txt': new TextEncoder().encode(SMALL_TEXT) });
  const large = () => lib.zipSync({ 'large.bin': new Uint8Array(LARGE_ENTRY_BYTES).fill(7) });

  const asyncUnzipSmall = await check(
    true,
    async () => sameText((await unzipAsync(lib, small(), timeoutMs))['small.txt'], SMALL_TEXT),
    (same) => same,
  );
  const asyncUnzipLarge = await check(
    true,
    async () => isLargeEntry((await unzipAsync(lib, large(), timeoutMs))['large.bin']),
    (same) => same,
  );
  const unzipSync = await check(
    true,
    () => sameText(lib.unzipSync(small())['small.txt'], SMALL_TEXT),
    (same) => same,
  );
  const path: ZipPath = isOk(asyncUnzipLarge)
    ? 'async-worker'
    : isOk(asyncUnzipSmall)
      ? 'async-inline'
      : isOk(unzipSync)
        ? 'sync'
        : 'none';
  return { asyncUnzipSmall, asyncUnzipLarge, unzipSync, path };
}
