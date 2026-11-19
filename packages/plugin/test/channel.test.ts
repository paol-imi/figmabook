import { describe, expect, it } from 'vitest';
import {
  ChannelError,
  createMainChannel,
  createSessionId,
  createUiChannel,
  figmaUiTransport,
  type MainChannel,
  type UiChannel,
  windowTransport,
} from '../src/channel';
import { PROTOCOL_VERSION } from '../src/protocol';
import {
  createFigmaUiPair,
  createRecordingTransport,
  envelope,
  flush,
  mainToUiBodies,
  SESSION,
  uiToMainBodies,
} from './fixtures';

/** Main and UI channels connected through a mocked `figma.ui`, after the handshake. */
async function connected(): Promise<{
  main: MainChannel;
  ui: UiChannel;
  figmaUi: ReturnType<typeof createFigmaUiPair>['figmaUi'];
}> {
  const { figmaUi, window } = createFigmaUiPair();
  const main = createMainChannel(figmaUiTransport(figmaUi));
  const ui = createUiChannel(windowTransport(window), SESSION);
  ui.send({ t: 'hello', uiVersion: '0.0.0' });
  await main.next('hello');
  return { main, ui, figmaUi };
}

describe('channels over a mocked figma.ui (09 §18 protocol tests)', () => {
  const uiCases = Object.values(uiToMainBodies).flatMap((bodies) => bodies.map((body) => [body.t, body] as const));
  it.each(uiCases)('round-trips UI → main %s', async (t, body) => {
    const { main, ui } = await connected();
    const received = main.next(t);
    ui.send(body);
    expect(await received).toEqual({ ...envelope, ...body });
  });

  const mainCases = Object.values(mainToUiBodies).flatMap((bodies) => bodies.map((body) => [body.t, body] as const));
  it.each(mainCases)('round-trips main → UI %s', async (t, body) => {
    const { main, ui } = await connected();
    const received = ui.next(t);
    main.send(body);
    expect(await received).toEqual({ ...envelope, ...body });
  });

  it('keeps asset bytes as a Uint8Array across the boundary', async () => {
    const { main, ui } = await connected();
    const received = main.next('unit');
    const body = uiToMainBodies.unit[2];
    if (body?.t !== 'unit') throw new Error('fixture');
    ui.send(body);
    const { unit } = await received;
    expect(unit.kind === 'asset' && unit.bytes).toBeInstanceOf(Uint8Array);
  });

  it('binds main to the session of the latest hello and ignores other sessions', async () => {
    const { figmaUi, window } = createFigmaUiPair();
    const main = createMainChannel(figmaUiTransport(figmaUi));
    expect(main.sessionId).toBeUndefined();
    const first = createUiChannel(windowTransport(window), 'first');
    first.send({ t: 'hello', uiVersion: '0.0.0' });
    await main.next('hello');
    expect(main.sessionId).toBe('first');

    const reloaded = createUiChannel(windowTransport(window), 'second');
    reloaded.send({ t: 'hello', uiVersion: '0.0.0' });
    await main.next('hello');
    expect(main.sessionId).toBe('second');

    const cancels: string[] = [];
    main.on('cancel', (message) => cancels.push(message.sessionId));
    first.send({ t: 'cancel' });
    reloaded.send({ t: 'cancel' });
    await flush();
    expect(cancels).toEqual(['second']);
  });

  it('drops messages from another session on the UI side', async () => {
    const { transport, receive } = createRecordingTransport();
    const ui = createUiChannel(transport, SESSION);
    const pings: number[] = [];
    ui.on('ping', ({ id }) => pings.push(id));
    receive({ v: PROTOCOL_VERSION, sessionId: 'other', t: 'ping', id: 1 });
    receive({ v: PROTOCOL_VERSION, sessionId: SESSION, t: 'ping', id: 2 });
    receive({ v: PROTOCOL_VERSION, sessionId: SESSION, t: 'ping', id: 'three' });
    expect(pings).toEqual([2]);
  });

  it('refuses to send from main before the UI said hello', () => {
    const { transport, posted } = createRecordingTransport();
    const main = createMainChannel(transport);
    expect(() => main.send({ t: 'ping', id: 1 })).toThrow(ChannelError);
    expect(posted).toEqual([]);
  });

  it('wraps UI messages as { pluginMessage } for Figma, with target "*"', () => {
    const calls: [unknown, string][] = [];
    const transport = windowTransport({
      parent: { postMessage: (message, target) => calls.push([message, target]) },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    transport.post({ a: 1 });
    expect(calls).toEqual([[{ pluginMessage: { a: 1 } }, '*']]);
  });

  it('ignores window messages that are not plugin messages', () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const transport = windowTransport({
      parent: { postMessage: () => {} },
      addEventListener: (_type, l) => {
        listener = l;
      },
      removeEventListener: () => {},
    });
    const seen: unknown[] = [];
    transport.subscribe((message) => seen.push(message));
    listener?.(new MessageEvent('message', { data: 'devtools noise' }));
    listener?.(new MessageEvent('message', { data: { pluginMessage: 1 } }));
    expect(seen).toEqual([1]);
  });

  it('removes its figma.ui listener on close and rejects pending next()', async () => {
    const { main, figmaUi } = await connected();
    expect(figmaUi.listenerCount()).toBe(1);
    const pending = main.next('pong');
    main.close();
    await expect(pending).rejects.toThrow('Channel closed.');
    expect(figmaUi.listenerCount()).toBe(0);
  });

  it('rejects next() when its signal aborts, before or while waiting', async () => {
    const { main } = await connected();
    const controller = new AbortController();
    const pending = main.next('pong', { signal: controller.signal });
    controller.abort(new Error('timed out'));
    await expect(pending).rejects.toThrow('timed out');
    await expect(main.next('pong', { signal: AbortSignal.abort() })).rejects.toThrow();
  });

  it('resolves next() only with a message that matches where', async () => {
    const { transport, receive } = createRecordingTransport();
    const ui = createUiChannel(transport, SESSION);
    const pending = ui.next('ping', { where: ({ id }) => id === 2 });
    receive({ ...envelope, t: 'ping', id: 1 });
    receive({ ...envelope, t: 'ping', id: 2 });
    expect((await pending).id).toBe(2);
  });

  it('stops calling a handler once unsubscribed', () => {
    const { transport, receive } = createRecordingTransport();
    const ui = createUiChannel(transport, SESSION);
    const ids: number[] = [];
    const off = ui.on('ping', ({ id }) => ids.push(id));
    receive({ ...envelope, t: 'ping', id: 1 });
    off();
    receive({ ...envelope, t: 'ping', id: 2 });
    expect(ids).toEqual([1]);
  });
});

describe('createSessionId', () => {
  it('is 32 hex characters from getRandomValues, without needing a secure context', () => {
    const id = createSessionId({ getRandomValues: <T extends ArrayBufferView | null>(array: T) => array });
    expect(id).toBe('0'.repeat(32));
    expect(createSessionId()).toMatch(/^[0-9a-f]{32}$/);
    expect(createSessionId()).not.toBe(createSessionId());
  });
});
