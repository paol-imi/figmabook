import type { BundleManifest } from '@holotype/ir';
import type { FigmaUiPort, Transport } from '../src/channel';
import { type MainToUi, type MainToUiBody, PROTOCOL_VERSION, type UiToMain, type UiToMainBody } from '../src/protocol';

export const SESSION = 'session-1';

export const manifest: BundleManifest = {
  kind: 'holotype/bundle',
  bundleVersion: '0.1.0',
  runId: 'r-test',
  createdAt: '2026-11-19T10:00:00Z',
  sceneVersion: '0.1.0',
  features: [],
  generator: {
    name: '@holotype/cli',
    version: '0.0.0',
    mapper: '0.0.0',
    capture: '0.0.0',
    chromium: '140.0.0.0',
    playwright: '1.63.0',
  },
  createdBy: 'cli',
  source: { storybookVersion: '10.6.7', origin: 'http://localhost:6006/', fingerprint: 'a'.repeat(64) },
  config: { hash: '0123456789abcdef' },
  components: [],
  assets: [],
  fonts: [],
  totals: { components: 0, variants: 0, nodes: 0, assetBytes: 0 },
  integrity: { algo: 'sha256', files: {} },
};

/** One valid body of every UI → main type. */
export const uiToMainBodies: Readonly<Record<UiToMain['t'], readonly UiToMainBody[]>> = {
  hello: [{ t: 'hello', uiVersion: '0.0.0' }],
  'session.open': [
    { t: 'session.open', manifest, source: 'file', options: {} },
    { t: 'session.open', manifest, source: 'server', options: { auto: true, undo: 'single' } },
  ],
  unit: [
    { t: 'unit', seq: 0, unit: { kind: 'tokens', json: '{}' }, last: false },
    { t: 'unit', seq: 1, unit: { kind: 'component', sid: 'button', json: '{"a"', part: 0, parts: 2 }, last: false },
    {
      t: 'unit',
      seq: 2,
      unit: { kind: 'asset', sha256: 'b'.repeat(64), mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) },
      last: true,
    },
  ],
  cancel: [{ t: 'cancel' }],
  pong: [{ t: 'pong', id: 7 }],
};

/** One valid body of every main → UI type. */
export const mainToUiBodies: Readonly<Record<MainToUi['t'], readonly MainToUiBody[]>> = {
  ready: [
    { t: 'ready', pluginVersion: '0.0.0', irMajors: [0], fileKey: null, registry: null },
    {
      t: 'ready',
      pluginVersion: '1.2.3',
      irMajors: [0, 1],
      fileKey: 'abc123',
      registry: { components: 3, variants: 40 },
    },
  ],
  need: [
    { t: 'need', unit: { kind: 'tokens' } },
    { t: 'need', unit: { kind: 'component', sid: 'button' } },
    { t: 'need', unit: { kind: 'asset', sha256: 'c'.repeat(64) } },
  ],
  progress: [
    { t: 'progress', stage: 'apply', done: 2, total: 5 },
    { t: 'progress', stage: 'verify', done: 5, total: 5, current: 'Button', etaMs: 1200 },
  ],
  diagnostics: [
    { t: 'diagnostics', items: [] },
    {
      t: 'diagnostics',
      items: [{ code: 'FONT_MISSING', severity: 'warn', message: 'Acme Sans is missing.', sid: 'button' }],
    },
  ],
  done: [
    { t: 'done', summary: { componentsOk: 3, componentsFailed: 1, variants: 24, durationMs: 4200, cancelled: false } },
    {
      t: 'done',
      summary: { componentsOk: 1, componentsFailed: 0, variants: 1, durationMs: 10, cancelled: false },
      report: {
        kind: 'holotype/apply-report',
        applyId: 'a-1',
        fileKey: null,
        components: [
          {
            sid: 'button',
            setId: '1:2',
            status: 'synced',
            variants: [{ vk: '0123456789abcdef', nodeId: '1:2', readback: { maxDelta: 0 } }],
          },
        ],
        diagnostics: [],
      },
    },
  ],
  error: [{ t: 'error', code: 'APPLY_IR_VERSION_UNSUPPORTED', message: 'Nope.', recoverable: false }],
  ping: [{ t: 'ping', id: 7 }],
};

export const envelope = { v: PROTOCOL_VERSION, sessionId: SESSION } as const;

type Listener = (message: unknown) => void;

/**
 * An in-memory `figma.ui` and plugin `window` pair. Messages cross with `structuredClone`,
 * as they do between Figma's sandbox and the iframe, and are delivered asynchronously.
 */
export function createFigmaUiPair() {
  const mainListeners = new Set<MessageEventHandler>();
  const uiListeners = new Set<(event: MessageEvent) => void>();
  const deliver = <T>(listeners: Set<T>, call: (listener: T) => void) =>
    queueMicrotask(() => {
      for (const listener of [...listeners]) call(listener);
    });

  const figmaUi: FigmaUiPort & { readonly listenerCount: () => number } = {
    postMessage(message: unknown) {
      const data = structuredClone({ pluginMessage: message, pluginId: 'holotype' });
      deliver(uiListeners, (listener) => listener(new MessageEvent('message', { data })));
    },
    on(_type: 'message', callback: MessageEventHandler) {
      mainListeners.add(callback);
    },
    off(_type: 'message', callback: MessageEventHandler) {
      mainListeners.delete(callback);
    },
    listenerCount: () => mainListeners.size,
  };

  const window = {
    parent: {
      postMessage(message: unknown, targetOrigin: string) {
        if (targetOrigin !== '*') throw new Error('The plugin iframe has a null origin: target must be "*".');
        const data = structuredClone(message) as { pluginMessage: unknown };
        deliver(mainListeners, (listener) => listener(data.pluginMessage, { origin: 'null' }));
      },
    },
    addEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => uiListeners.add(listener),
    removeEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => uiListeners.delete(listener),
  };

  return { figmaUi, window };
}

/** A transport that records what is posted and lets the test inject incoming messages. */
export function createRecordingTransport() {
  const posted: unknown[] = [];
  const listeners = new Set<Listener>();
  const transport: Transport = {
    post: (message) => posted.push(message),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const receive = (message: unknown) => {
    for (const listener of [...listeners]) listener(message);
  };
  return { transport, posted, receive, listenerCount: () => listeners.size };
}

/** Resolves after queued microtasks (message delivery) have run. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
