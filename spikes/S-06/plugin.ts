/**
 * S-06 step 1, main thread: which runtime features exist in Figma's plugin sandbox (D-31),
 * including code generation for TypeBox's compiled validators, whether `figma.fileKey` is
 * readable with `enablePrivatePluginApi` (BUILD §11 gap 8), and echo tasks for the
 * `postMessage` size test.
 */
import { fingerprint, probe } from '../_shared/figma.ts';
import type { MainContext } from '../_shared/spike.ts';
import { codegenFacts, cryptoFacts, type Globals, runtimeFacts } from './sandbox.ts';

/** Resolves with the delay `setTimeout` really took, or `null` when it is missing. */
async function timerProbe(globals: Globals, delayMs: number): Promise<number | null> {
  const timer = globals.setTimeout;
  if (typeof timer !== 'function') return null;
  const started = Date.now();
  await new Promise<void>((resolve) => timer(resolve, delayMs));
  return Date.now() - started;
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
    codegen: await codegenFacts(globals),
    runtime: await runtimeFacts(globals),
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
