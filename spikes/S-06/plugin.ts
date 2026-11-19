/**
 * S-06 step 1, main thread: which runtime features exist in Figma's plugin sandbox (D-31),
 * whether `figma.fileKey` is readable with `enablePrivatePluginApi` (BUILD §11 gap 8), and
 * echo tasks for the `postMessage` size test.
 */
import { fingerprint, probe } from '../_shared/figma.ts';
import type { MainContext } from '../_shared/spike.ts';

/** SHA-256("abc"), FIPS 180-2 test vector. */
export const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

type Globals = Record<string, unknown>;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Resolves with the delay `setTimeout` really took, or `null` when it is missing. */
async function timerProbe(globals: Globals, delayMs: number): Promise<number | null> {
  const timer = globals.setTimeout;
  if (typeof timer !== 'function') return null;
  const started = Date.now();
  await new Promise<void>((resolve) => timer(resolve, delayMs));
  return Date.now() - started;
}

export type CryptoFacts = {
  available: boolean;
  subtle: boolean;
  digestSha256: 'ok' | 'wrong' | 'missing' | 'error';
  digestError: string | null;
  getRandomValues: boolean;
  randomUUID: boolean;
};

/** Same probe in main and in the UI iframe. */
export async function cryptoFacts(globals: Globals): Promise<CryptoFacts> {
  const crypto = globals.crypto as Partial<Crypto> | undefined;
  const subtle = crypto?.subtle;
  let digestSha256: CryptoFacts['digestSha256'] = 'missing';
  let digestError: string | null = null;
  if (subtle && typeof subtle.digest === 'function') {
    const result = await probe(() => subtle.digest('SHA-256', new TextEncoder().encode('abc')));
    if (result.ok) digestSha256 = toHex(result.value) === SHA256_ABC ? 'ok' : 'wrong';
    else {
      digestSha256 = 'error';
      digestError = result.error;
    }
  }
  return {
    available: typeof crypto === 'object' && crypto !== null,
    subtle: typeof subtle === 'object' && subtle !== null,
    digestSha256,
    digestError,
    getRandomValues: typeof crypto?.getRandomValues === 'function',
    randomUUID: typeof crypto?.randomUUID === 'function',
  };
}

async function mainChecks({ figma }: MainContext, _input: null) {
  const globals = globalThis as unknown as Globals;
  const timerResult = await probe(() => timerProbe(globals, 25));
  const fileKey = await probe(() => figma.fileKey);
  const key = fileKey.ok ? fileKey.value : undefined;
  return {
    setTimeout: {
      available: typeof globals.setTimeout === 'function',
      fired: timerResult.ok && timerResult.value !== null,
      elapsedMs: timerResult.ok ? timerResult.value : null,
      error: timerResult.ok ? null : timerResult.error,
    },
    setInterval: typeof globals.setInterval === 'function',
    queueMicrotask: typeof globals.queueMicrotask === 'function',
    crypto: await cryptoFacts(globals),
    textEncoder: typeof globals.TextEncoder === 'function' && typeof globals.TextDecoder === 'function',
    structuredClone: typeof globals.structuredClone === 'function',
    performanceNow: typeof (globals.performance as Partial<Performance> | undefined)?.now === 'function',
    webAssembly: typeof globals.WebAssembly === 'object',
    fetch: typeof globals.fetch === 'function',
    fileKey: {
      readable: typeof key === 'string' && key.length > 0,
      type: fileKey.ok ? typeof key : 'throws',
      length: typeof key === 'string' ? key.length : 0,
      /** Fingerprint only: lets later spikes compare files without the key itself. */
      fingerprint: typeof key === 'string' && key.length > 0 ? fingerprint(key) : null,
      error: fileKey.ok ? null : fileKey.error,
    },
    mode: figma.mode,
  };
}

/** UI → main payload test: main reports what arrived. */
async function echo(_ctx: MainContext, input: { payload: string | Uint8Array }) {
  const { payload } = input;
  return { kind: typeof payload === 'string' ? 'string' : 'bytes', length: payload.length };
}

/** Main → UI payload test: main builds a payload of the asked size. */
async function generate(_ctx: MainContext, input: { kind: 'string' | 'bytes'; length: number }) {
  return input.kind === 'string'
    ? { payload: 'x'.repeat(input.length) }
    : { payload: new Uint8Array(input.length).fill(7) };
}

export const s06Tasks = {
  'S-06/main-checks': mainChecks,
  'S-06/echo': echo,
  'S-06/generate': generate,
};
