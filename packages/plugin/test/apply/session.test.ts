import { describe, expect, it, vi } from 'vitest';
import { createPuller } from '../../src/apply/pull';
import { createApplyId, PROGRESS_INTERVAL_MS, parseComponent, runImportSession } from '../../src/apply/session';
import {
  createMainChannel,
  createUiChannel,
  figmaUiTransport,
  type UiChannel,
  windowTransport,
} from '../../src/channel';
import { type HostOptions, startHost } from '../../src/host';
import type { MainToUi } from '../../src/protocol';
import { readBundle } from '../../src/ui/import/bundle';
import { serveBundle } from '../../src/ui/import/serve';
import { createFigmaUiPair, createRecordingTransport, envelope, flush, SESSION } from '../fixtures';
import { applyToFake } from '../support/apply';
import { createFakeFigma, type FakeFigma } from '../support/fake';
import { badge, bundleOf, PNG_SHA, SVG_SHA, zipOf } from '../support/scenes';

interface SessionSetup {
  readonly figma?: FakeFigma;
  readonly now?: () => number;
  readonly yieldToEditor?: () => Promise<void>;
  readonly maxPartBytes?: number;
  /** Called with the UI channel as soon as it exists. */
  readonly withUi?: (ui: UiChannel) => void;
}

/** UI and main joined by an in-memory `figma.ui`: the real import path, against the fake. */
async function importThroughProtocol(setup: SessionSetup = {}) {
  const { figma = createFakeFigma(), now = () => 0, yieldToEditor, maxPartBytes } = setup;
  const { figmaUi, window } = createFigmaUiPair();
  const main = createMainChannel(figmaUiTransport(figmaUi));
  const ui = createUiChannel(windowTransport(window), SESSION);
  setup.withUi?.(ui);
  const received: MainToUi[] = [];
  for (const t of ['progress', 'diagnostics', 'done', 'error', 'need'] as const)
    ui.on(t, (message) => received.push(message));
  const openSession: HostOptions['openSession'] = async (message, host) => {
    await runImportSession({
      message,
      host,
      channel: main,
      port: figma,
      now,
      yieldToEditor: yieldToEditor ?? (() => host.uiRoundTrip()),
      createId: () => 'apply-1',
    });
  };
  startHost({ channel: main, pluginVersion: '0.0.0', irMajors: [0], fileKey: () => null, openSession });
  ui.on('ping', ({ id }) => ui.send({ t: 'pong', id }));
  const read = await readBundle('fixtures.holotype.zip', zipOf(bundleOf().files));
  if (!read.ok) throw new Error(read.error.message);
  serveBundle(ui, read.value, maxPartBytes);
  ui.send({ t: 'hello', uiVersion: '0.0.0' });
  const outcome = Promise.race([ui.next('done'), ui.next('error')]);
  ui.send({ t: 'session.open', manifest: read.value.manifest, source: 'file', options: {} });
  return { figma, ui, received, outcome: await outcome };
}

const ofType = <T extends MainToUi['t']>(messages: readonly MainToUi[], t: T) =>
  messages.filter((message): message is Extract<MainToUi, { t: T }> => message.t === t);

describe('import session over the protocol (09 §3.3)', () => {
  it('builds the same document as a direct apply, pulling every unit once', async () => {
    const { figma, received, outcome } = await importThroughProtocol();
    const direct = await applyToFake();
    expect(figma.snapshot()).toEqual(direct.figma.snapshot());
    expect(outcome).toMatchObject({ t: 'done', summary: { componentsOk: 3, componentsFailed: 0, variants: 4 } });
    expect(outcome.t === 'done' ? outcome.report : undefined).toMatchObject({
      kind: 'holotype/apply-report',
      applyId: 'apply-1',
    });
    expect(ofType(received, 'need').map((message) => message.unit)).toEqual([
      { kind: 'component', sid: 'micro-flex' },
      { kind: 'component', sid: 'components-badge' },
      { kind: 'component', sid: 'components-card' },
      { kind: 'asset', sha256: PNG_SHA },
      { kind: 'asset', sha256: SVG_SHA },
    ]);
  });

  it('reassembles components sent in many parts back to back', async () => {
    const { outcome, received } = await importThroughProtocol({ maxPartBytes: 512 });
    expect(outcome).toMatchObject({ t: 'done', summary: { componentsOk: 3 } });
    expect(ofType(received, 'need')).toHaveLength(5);
  });

  it(`sends progress at most every ${PROGRESS_INTERVAL_MS} ms, always the last one`, async () => {
    const { received } = await importThroughProtocol();
    expect(ofType(received, 'progress').map(({ done, total }) => [done, total])).toEqual([
      [0, 4],
      [4, 4],
    ]);
    expect(ofType(received, 'progress').every((message) => message.stage === 'apply')).toBe(true);
  });

  it('streams diagnostics in batches', async () => {
    const { received } = await importThroughProtocol();
    expect(ofType(received, 'diagnostics').flatMap((message) => message.items.map((item) => item.code))).toContain(
      'FONT_MISSING',
    );
  });

  it('finishes the current component when the UI cancels, then stops', async () => {
    let clock = 0;
    let ui: UiChannel | undefined;
    const { outcome } = await importThroughProtocol({
      withUi: (channel) => {
        ui = channel;
      },
      // Every read of the clock is 20 ms later, so the slicer yields after each node.
      now: () => {
        clock += 20;
        return clock;
      },
      yieldToEditor: async () => {
        ui?.send({ t: 'cancel' });
        await flush();
      },
    });
    expect(outcome).toMatchObject({ t: 'done', summary: { cancelled: true, componentsOk: 1, variants: 1 } });
  });

  it('reports a failure outside any component as a fatal error', async () => {
    const figma = createFakeFigma();
    vi.spyOn(figma, 'createPage').mockImplementation(() => {
      throw new Error('in createPage: The document is read-only');
    });
    const { outcome } = await importThroughProtocol({ figma });
    expect(outcome).toMatchObject({ t: 'error', code: 'APPLY_COMPONENT_FAILED', recoverable: false });
  });
});

describe('createPuller', () => {
  it('asks with need only once its listener is in place', async () => {
    const { transport, posted, receive } = createRecordingTransport();
    const main = createMainChannel(transport);
    receive({ ...envelope, t: 'hello', uiVersion: '0' });
    const pending = createPuller(main).asset('a'.repeat(64));
    expect(posted).toEqual([{ ...envelope, t: 'need', unit: { kind: 'asset', sha256: 'a'.repeat(64) } }]);
    receive({
      ...envelope,
      t: 'unit',
      seq: 0,
      unit: { kind: 'asset', sha256: 'b'.repeat(64), mime: '', bytes: new Uint8Array() },
      last: true,
    });
    receive({
      ...envelope,
      t: 'unit',
      seq: 1,
      unit: { kind: 'asset', sha256: 'a'.repeat(64), mime: 'image/png', bytes: new Uint8Array([1]) },
      last: true,
    });
    expect(await pending).toMatchObject({ sha256: 'a'.repeat(64), mime: 'image/png' });
  });

  it('joins parts in part order, whatever order they arrive in', async () => {
    const { transport, receive } = createRecordingTransport();
    const main = createMainChannel(transport);
    receive({ ...envelope, t: 'hello', uiVersion: '0' });
    const pending = createPuller(main).component('x');
    const part = (index: number, json: string) =>
      receive({
        ...envelope,
        t: 'unit',
        seq: index,
        unit: { kind: 'component', sid: 'x', json, part: index, parts: 3 },
        last: index === 2,
      });
    part(2, '3]');
    part(0, '[1,');
    part(0, '[1,');
    part(1, '2,');
    expect(await pending).toEqual({ kind: 'component', sid: 'x', json: '[1,2,3]', part: 0, parts: 1 });
  });

  it('rejects a transfer whose part count changes (APPLY_BUNDLE_CORRUPT)', async () => {
    const { transport, receive } = createRecordingTransport();
    const main = createMainChannel(transport);
    receive({ ...envelope, t: 'hello', uiVersion: '0' });
    const pending = createPuller(main).component('x');
    receive({
      ...envelope,
      t: 'unit',
      seq: 0,
      unit: { kind: 'component', sid: 'x', json: '[', part: 0, parts: 2 },
      last: false,
    });
    receive({
      ...envelope,
      t: 'unit',
      seq: 1,
      unit: { kind: 'component', sid: 'x', json: ']', part: 1, parts: 3 },
      last: false,
    });
    await expect(pending).rejects.toMatchObject({ code: 'APPLY_BUNDLE_CORRUPT' });
  });
});

describe('parseComponent', () => {
  const [entry] = bundleOf([badge]).manifest.components;
  if (entry === undefined) throw new Error('fixture');

  it('returns the component of a matching file', () => {
    expect(parseComponent(entry, JSON.stringify(badge))).toEqual(badge);
  });

  it.each([
    ['not JSON', '{', 'APPLY_BUNDLE_CORRUPT'],
    ['another document', JSON.stringify({ kind: 'holotype/bundle' }), 'APPLY_BUNDLE_CORRUPT'],
    ['another component', JSON.stringify({ ...badge, sid: 'other' }), 'APPLY_BUNDLE_CORRUPT'],
    ['no variants', JSON.stringify({ ...badge, variants: [] }), 'APPLY_BUNDLE_CORRUPT'],
    ['an unknown major', JSON.stringify({ ...badge, sceneVersion: '7.0.0' }), 'APPLY_IR_VERSION_UNSUPPORTED'],
  ])('rejects %s', (_name, json, code) => {
    expect(() => parseComponent(entry, json)).toThrow(expect.objectContaining({ code }));
  });
});

describe('createApplyId', () => {
  it('combines the time and a random suffix', () => {
    expect(createApplyId(36 ** 3, () => 0.5)).toBe('1000-80000000');
  });
});
