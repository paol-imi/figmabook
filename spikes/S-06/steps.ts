/**
 * S-06 · Plugin environment, step 1 (quick checks). Step 2 (performance) is hardening (B-119)
 * and not part of this kit version.
 */
import { copyText, downloadFile } from '../_shared/dom.ts';
import { errorMessage } from '../_shared/json.ts';
import { type SpikeDefinition, type StepIO, taskClient } from '../_shared/spike.ts';
import { blobWorkerFacts, contextFacts, fflateFacts } from './iframe.ts';
import type { s06Tasks } from './plugin.ts';
import { codegenFacts, cryptoFacts, type Globals, isOk, runtimeFacts } from './sandbox.ts';
import { withTimeout } from './timeout.ts';

const KB = 1024;
const MB = 1024 * KB;

/** Payload sizes tried in each direction, smallest first; the test stops at the first failure. */
export const PAYLOAD_SIZES = [1 * KB, 256 * KB, 1 * MB, 4 * MB, 16 * MB, 32 * MB] as const;
export const PAYLOAD_TIMEOUT_MS = 20_000;
export const DOWNLOAD_NAME = 'holotype-s06-download-test.txt';

export type PayloadKind = 'string' | 'bytes';
export type PayloadTrial = { bytes: number; ok: boolean; ms: number | null; error: string | null };
export type PayloadSeries = {
  kind: PayloadKind;
  direction: 'uiToMain' | 'mainToUi';
  trials: PayloadTrial[];
  maxOkBytes: number;
};

/**
 * Sends growing payloads through `send` until one fails or returns the wrong length.
 * `send(bytes)` resolves with the length that arrived on the other side.
 */
export async function measureSeries(
  kind: PayloadKind,
  direction: PayloadSeries['direction'],
  send: (bytes: number) => Promise<number>,
  options: { sizes: readonly number[]; timeoutMs: number; now: () => number },
): Promise<PayloadSeries> {
  const trials: PayloadTrial[] = [];
  let maxOkBytes = 0;
  for (const bytes of options.sizes) {
    const started = options.now();
    try {
      const arrived = await withTimeout(send(bytes), options.timeoutMs, `${bytes} bytes`);
      const ok = arrived === bytes;
      trials.push({
        bytes,
        ok,
        ms: Math.round(options.now() - started),
        error: ok ? null : `arrived with ${arrived} bytes`,
      });
      if (!ok) break;
      maxOkBytes = bytes;
    } catch (error) {
      trials.push({ bytes, ok: false, ms: null, error: errorMessage(error) });
      break;
    }
  }
  return { kind, direction, trials, maxOkBytes };
}

async function clipboardFacts(doc: Document) {
  const execCommandCopy = copyText(doc, 'holotype-s06-clipboard-test');
  let writeText: 'ok' | 'missing' | string = 'missing';
  const clipboard = doc.defaultView?.navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await withTimeout(clipboard.writeText('holotype-s06-clipboard-test'), 3000, 'clipboard.writeText');
      writeText = 'ok';
    } catch (error) {
      writeText = `error: ${errorMessage(error)}`;
    }
  }
  return { execCommandCopy, navigatorClipboardWriteText: writeText };
}

/** The same probes as main where they apply, plus the iframe-only ones. */
async function uiChecks(globals: Globals) {
  return {
    crypto: await cryptoFacts(globals),
    codegen: await codegenFacts(globals),
    runtime: await runtimeFacts(globals),
    context: await contextFacts(globals),
    blobWorker: await blobWorkerFacts(globals),
    fflate: await fflateFacts(),
    clipboard: await clipboardFacts(document),
  };
}

async function quickChecks(io: StepIO) {
  const call = taskClient<typeof s06Tasks>(io);
  io.progress('Checking the main thread…');
  const main = await call('S-06/main-checks', null);

  io.progress('Checking the plugin window…');
  const ui = await uiChecks(globalThis as unknown as Globals);

  const now = () => performance.now();
  const options = { sizes: PAYLOAD_SIZES, timeoutMs: PAYLOAD_TIMEOUT_MS, now };
  const series: PayloadSeries[] = [];
  for (const kind of ['string', 'bytes'] as const) {
    io.progress(`Sending ${kind} payloads to main…`);
    series.push(
      await measureSeries(
        kind,
        'uiToMain',
        async (bytes) => {
          const payload = kind === 'string' ? 'x'.repeat(bytes) : new Uint8Array(bytes);
          return (await call('S-06/echo', { payload })).length;
        },
        options,
      ),
    );
    io.progress(`Receiving ${kind} payloads from main…`);
    series.push(
      await measureSeries(
        kind,
        'mainToUi',
        async (bytes) => (await call('S-06/generate', { kind, length: bytes })).payload.length,
        options,
      ),
    );
  }

  const downloadStarted = downloadFile(document, DOWNLOAD_NAME, 'Holotype spike S-06: download test.\n', 'text/plain');
  const download = await io.ask({
    kind: 'choice',
    lines: [
      `The plugin just tried to download a small file named "${DOWNLOAD_NAME}".`,
      'Did a download appear (in Downloads, or a save dialog)?',
    ],
    choices: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
      { id: 'unsure', label: 'Not sure' },
    ],
  });

  const max = (kind: PayloadKind, direction: PayloadSeries['direction']) =>
    series.find((entry) => entry.kind === kind && entry.direction === direction)?.maxOkBytes ?? 0;

  return {
    answers: {
      setTimeoutInMain: main.setTimeout.fired,
      cryptoSubtleInMain: main.crypto.subtle,
      cryptoSubtleDigestInMain: isOk(main.crypto.digestSha256),
      newFunctionInMain: isOk(main.codegen.newFunction),
      evalInMain: isOk(main.codegen.eval),
      typeboxCompiledCheckInMain: isOk(main.codegen.typeboxCompiled),
      structuredCloneInMain: isOk(main.runtime.structuredClone),
      textEncoderInMain: isOk(main.runtime.textEncoder),
      textDecoderInMain: isOk(main.runtime.textDecoder),
      newFunctionInUi: isOk(ui.codegen.newFunction),
      evalInUi: isOk(ui.codegen.eval),
      typeboxCompiledCheckInUi: isOk(ui.codegen.typeboxCompiled),
      cryptoSubtleInUi: ui.crypto.subtle,
      cryptoSubtleDigestInUi: isOk(ui.crypto.digestSha256),
      getRandomValuesInUi: isOk(ui.crypto.getRandomValues),
      randomUUIDInUi: isOk(ui.crypto.randomUUID),
      secureContextInUi: ui.context.isSecureContext,
      originInUi: ui.context.origin,
      blobWorkerInUi: isOk(ui.blobWorker),
      fflateUnzipPathInUi: ui.fflate.path,
      postMessageMaxOkBytes: {
        uiToMain: { string: max('string', 'uiToMain'), bytes: max('bytes', 'uiToMain') },
        mainToUi: { string: max('string', 'mainToUi'), bytes: max('bytes', 'mainToUi') },
        largestTried: PAYLOAD_SIZES[PAYLOAD_SIZES.length - 1] ?? 0,
      },
      fileKeyReadable: main.fileKey.readable,
      blobDownloadFromUi: download.choice,
    },
    main,
    ui: { ...ui, downloadAttempted: downloadStarted },
    postMessage: series,
  };
}

export const s06: SpikeDefinition = {
  id: 'S-06',
  title: 'Plugin environment',
  question:
    'Which runtime features exist in the plugin sandbox and the plugin window (code generation, crypto, workers, unzip), how big can messages be, and can the plugin read the file key and download a file?',
  userTime: '2 min',
  steps: [
    {
      id: 'step1',
      label: 'Step 1 (quick checks)',
      where: 'any new, empty design file',
      before: ['Takes about a minute. Figma may pause for a few seconds while large messages are tested.'],
      after: ['Paste the results in the chat.'],
      run: async (io) => ({ results: await quickChecks(io) }),
    },
  ],
};
