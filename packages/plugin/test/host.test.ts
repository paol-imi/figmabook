import { APPLY_IR_VERSION_UNSUPPORTED, createDiagnostic, HolotypeError } from '@holotype/shared';
import { describe, expect, it, vi } from 'vitest';
import { createMainChannel, createUiChannel, figmaUiTransport, windowTransport } from '../src/channel';
import { type HostOptions, startHost } from '../src/host';
import { createFigmaUiPair, flush, manifest, SESSION } from './fixtures';

function setup(overrides: Partial<Omit<HostOptions, 'channel'>> = {}) {
  const { figmaUi, window } = createFigmaUiPair();
  const main = createMainChannel(figmaUiTransport(figmaUi));
  const ui = createUiChannel(windowTransport(window), SESSION);
  const host = startHost({
    channel: main,
    pluginVersion: '1.2.3',
    irMajors: [0],
    fileKey: () => 'file-1',
    ...overrides,
  });
  return { host, ui, main };
}

describe('startHost (main side of a session)', () => {
  it('answers hello with ready: versions, IR majors, file key and registry', async () => {
    const { ui } = setup({ registry: () => ({ components: 2, variants: 9 }) });
    const ready = ui.next('ready');
    ui.send({ t: 'hello', uiVersion: '0.0.0' });
    expect(await ready).toMatchObject({
      t: 'ready',
      sessionId: SESSION,
      pluginVersion: '1.2.3',
      irMajors: [0],
      fileKey: 'file-1',
      registry: { components: 2, variants: 9 },
    });
  });

  it('reports no file key and no registry when Figma has none', async () => {
    const { ui } = setup({ fileKey: () => null });
    const ready = ui.next('ready');
    ui.send({ t: 'hello', uiVersion: '0.0.0' });
    expect(await ready).toMatchObject({ fileKey: null, registry: null });
  });

  it('records cancel and clears it when the next session opens', async () => {
    const openSession = vi.fn(async () => {});
    const { host, ui } = setup({ openSession });
    ui.send({ t: 'hello', uiVersion: '0.0.0' });
    ui.send({ t: 'cancel' });
    await flush();
    expect(host.cancelRequested).toBe(true);
    ui.send({ t: 'session.open', manifest, source: 'file', options: {} });
    await flush();
    expect(host.cancelRequested).toBe(false);
    expect(openSession).toHaveBeenCalledWith(expect.objectContaining({ t: 'session.open', source: 'file' }), host);
  });

  it('rejects a bundle whose Scene IR major it cannot apply (APPLY_IR_VERSION_UNSUPPORTED)', async () => {
    const openSession = vi.fn(async () => {});
    const { ui } = setup({ openSession });
    ui.send({ t: 'hello', uiVersion: '0.0.0' });
    const error = ui.next('error');
    ui.send({ t: 'session.open', manifest: { ...manifest, sceneVersion: '3.0.0' }, source: 'file', options: {} });
    expect(await error).toMatchObject({
      code: 'APPLY_IR_VERSION_UNSUPPORTED',
      message: 'Bundle format version 3.0.0 is not supported; supported majors: 0.',
      recoverable: false,
    });
    expect(openSession).not.toHaveBeenCalled();
  });

  it('rejects a bundle whose Scene IR version is not semver', async () => {
    const { ui } = setup();
    ui.send({ t: 'hello', uiVersion: '0.0.0' });
    const error = ui.next('error');
    ui.send({ t: 'session.open', manifest: { ...manifest, sceneVersion: 'latest' }, source: 'file', options: {} });
    expect((await error).code).toBe('APPLY_IR_VERSION_UNSUPPORTED');
  });

  it('reports a HolotypeError thrown by the session as an error message', async () => {
    const diagnostic = createDiagnostic(APPLY_IR_VERSION_UNSUPPORTED, {
      document: 'Tokens',
      found: '9.0.0',
      supported: '0',
    });
    const { ui } = setup({
      openSession: async () => {
        throw new HolotypeError(diagnostic);
      },
    });
    ui.send({ t: 'hello', uiVersion: '0.0.0' });
    const error = ui.next('error');
    ui.send({ t: 'session.open', manifest, source: 'server', options: {} });
    expect(await error).toMatchObject({ code: diagnostic.code, message: diagnostic.message, recoverable: true });
  });

  it('yields with a ping/pong round trip, skipping stale pongs', async () => {
    const { host, ui } = setup();
    ui.send({ t: 'hello', uiVersion: '0.0.0' });
    await flush();
    const pings: number[] = [];
    ui.on('ping', ({ id }) => {
      pings.push(id);
      ui.send({ t: 'pong', id: id + 100 }); // stale
      ui.send({ t: 'pong', id });
    });
    await host.uiRoundTrip();
    await host.uiRoundTrip();
    expect(pings).toEqual([1, 2]);
  });

  it('stops handling messages once disposed', async () => {
    const { host, ui } = setup();
    host.dispose();
    const replies: unknown[] = [];
    ui.on('ready', (message) => replies.push(message));
    ui.send({ t: 'hello', uiVersion: '0.0.0' });
    await flush();
    expect(replies).toEqual([]);
  });
});
