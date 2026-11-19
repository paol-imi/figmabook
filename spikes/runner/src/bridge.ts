/**
 * UI side of the protocol: `call(task, input)` returns a promise settled by main's `result`
 * message. Progress messages are routed to the caller's handler.
 */
import type { WireValue } from '../../_shared/spike.ts';
import { type CallMessage, isMainToUi, KIT, type MainToUi } from './protocol.ts';

export interface BridgePort {
  post(message: CallMessage): void;
  /** Subscribes to messages from main; returns an unsubscribe function. */
  listen(handler: (message: unknown) => void): () => void;
}

export interface Bridge {
  call(task: string, input: WireValue, onProgress?: (message: string) => void): Promise<unknown>;
  dispose(): void;
}

/** Thrown when main reports that a task failed; the message is main's error text. */
export class TaskError extends Error {
  constructor(
    readonly task: string,
    message: string,
  ) {
    super(message);
    this.name = 'TaskError';
  }
}

type Pending = {
  readonly task: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress: ((message: string) => void) | undefined;
};

export function createBridge(port: BridgePort): Bridge {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const unsubscribe = port.listen((raw) => {
    if (!isMainToUi(raw)) return;
    const message: MainToUi = raw;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.t === 'progress') {
      entry.onProgress?.(message.message);
      return;
    }
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.output);
    else entry.reject(new TaskError(entry.task, message.error));
  });

  return {
    call(task, input, onProgress) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { task, resolve, reject, onProgress });
        port.post({ kit: KIT, t: 'call', id, task, input });
      });
    },
    dispose() {
      unsubscribe();
      for (const entry of pending.values()) entry.reject(new Error('The plugin window was closed.'));
      pending.clear();
    },
  };
}

/** The port for a Figma plugin iframe: `parent.postMessage({ pluginMessage })`. */
export function iframePort(win: Window): BridgePort {
  return {
    post: (message) => win.parent.postMessage({ pluginMessage: message }, '*'),
    listen(handler) {
      const listener = (event: MessageEvent<{ pluginMessage?: unknown } | null>) => handler(event.data?.pluginMessage);
      win.addEventListener('message', listener);
      return () => win.removeEventListener('message', listener);
    },
  };
}
