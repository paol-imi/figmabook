import { describe, expect, it } from 'vitest';
import { type BridgePort, createBridge, iframePort, TaskError } from '../src/bridge.ts';
import { createMainHost } from '../src/host.ts';
import { type CallMessage, isCallMessage, isMainToUi, KIT, type MainToUi } from '../src/protocol.ts';

function manualPort() {
  const sent: CallMessage[] = [];
  let handler: ((message: unknown) => void) | undefined;
  const port: BridgePort = {
    post: (message) => sent.push(message),
    listen(next) {
      handler = next;
      return () => {
        handler = undefined;
      };
    },
  };
  return { port, sent, deliver: (message: unknown) => handler?.(message) };
}

describe('protocol guards', () => {
  it('accept only kit messages', () => {
    expect(isCallMessage({ kit: KIT, t: 'call', id: 1, task: 'kit/env', input: null })).toBe(true);
    expect(isCallMessage({ kit: 'other', t: 'call', id: 1, task: 'x' })).toBe(false);
    expect(isCallMessage(null)).toBe(false);
    expect(isMainToUi({ kit: KIT, t: 'progress', id: 2, message: 'hi' })).toBe(true);
    expect(isMainToUi({ kit: KIT, t: 'call', id: 2 })).toBe(false);
  });
});

describe('bridge', () => {
  it('resolves a call with main’s output and routes progress to the caller', async () => {
    const { port, sent, deliver } = manualPort();
    const bridge = createBridge(port);
    const progress: string[] = [];
    const pending = bridge.call('S-06/echo', { payload: 'abc' }, (message) => progress.push(message));
    const id = sent[0]?.id ?? -1;
    deliver({ kit: KIT, t: 'progress', id, message: 'working' } satisfies MainToUi);
    deliver({ kit: KIT, t: 'result', id: id + 100, ok: true, output: 'not mine' } satisfies MainToUi);
    deliver({ kit: KIT, t: 'result', id, ok: true, output: { length: 3 } } satisfies MainToUi);
    await expect(pending).resolves.toEqual({ length: 3 });
    expect(progress).toEqual(['working']);
  });

  it('rejects with a TaskError carrying main’s message', async () => {
    const { port, sent, deliver } = manualPort();
    const bridge = createBridge(port);
    const pending = bridge.call('S-02/place', null);
    deliver({ kit: KIT, t: 'result', id: sent[0]?.id ?? -1, ok: false, error: 'Publish the library first' });
    await expect(pending).rejects.toBeInstanceOf(TaskError);
    await expect(pending).rejects.toThrow('Publish the library first');
  });

  it('rejects pending calls when disposed', async () => {
    const { port } = manualPort();
    const bridge = createBridge(port);
    const pending = bridge.call('kit/env', null);
    bridge.dispose();
    await expect(pending).rejects.toThrow(/closed/);
  });

  it('talks to Figma through parent.postMessage({ pluginMessage })', () => {
    const posted: unknown[] = [];
    const listeners: Array<(event: MessageEvent) => void> = [];
    const fakeWindow = {
      parent: { postMessage: (message: unknown) => posted.push(message) },
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.push(listener),
      removeEventListener: () => {},
    } as unknown as Window;
    const port = iframePort(fakeWindow);
    const received: unknown[] = [];
    port.listen((message) => received.push(message));
    port.post({ kit: KIT, t: 'call', id: 1, task: 'kit/env', input: null });
    listeners[0]?.({ data: { pluginMessage: 'hello' } } as MessageEvent);
    listeners[0]?.({ data: null } as MessageEvent);
    expect(posted).toEqual([{ pluginMessage: { kit: KIT, t: 'call', id: 1, task: 'kit/env', input: null } }]);
    expect(received).toEqual(['hello', undefined]);
  });
});

describe('main host', () => {
  function hostWith(tasks: Parameters<typeof createMainHost>[1]) {
    const posted: MainToUi[] = [];
    const ui = {
      onmessage: undefined as ((message: unknown) => Promise<void>) | undefined,
      postMessage: (m: MainToUi) => posted.push(m),
    };
    createMainHost({ ui } as unknown as PluginAPI, tasks);
    return { posted, send: (message: unknown) => ui.onmessage?.(message) };
  }

  it('runs a task and posts its output; progress goes out with the call id', async () => {
    const { posted, send } = hostWith({
      'x/task': async (ctx, input: { n: number }) => {
        ctx.progress('half way');
        return input.n * 2;
      },
    });
    await send({ kit: KIT, t: 'call', id: 7, task: 'x/task', input: { n: 21 } });
    expect(posted).toEqual([
      { kit: KIT, t: 'progress', id: 7, message: 'half way' },
      { kit: KIT, t: 'result', id: 7, ok: true, output: 42 },
    ]);
  });

  it('turns a throwing task and an unknown task into error results', async () => {
    const { posted, send } = hostWith({
      'x/fails': async () => {
        throw new Error('Figma said no');
      },
    });
    await send({ kit: KIT, t: 'call', id: 1, task: 'x/fails', input: null });
    await send({ kit: KIT, t: 'call', id: 2, task: 'x/missing', input: null });
    await send({ something: 'else' });
    expect(posted).toEqual([
      { kit: KIT, t: 'result', id: 1, ok: false, error: 'Figma said no' },
      { kit: KIT, t: 'result', id: 2, ok: false, error: 'Unknown task "x/missing". Is the kit up to date?' },
    ]);
  });
});
