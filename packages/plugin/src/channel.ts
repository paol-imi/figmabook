/*
 * Typed, session-scoped channels over the two ends of `figma.ui` messaging (09 §3.1).
 * Both ends validate what they receive (`parse*`) and drop anything malformed, from an
 * older protocol, or from another session.
 */
import {
  type Envelope,
  type MainToUi,
  type MessageOf,
  PROTOCOL_VERSION,
  parseMainToUi,
  parseUiToMain,
  type UiToMain,
} from './protocol';

/** A raw, untyped message pipe. */
export interface Transport {
  post(message: unknown): void;
  /** Calls `listener` for each incoming message until the returned function is called. */
  subscribe(listener: (message: unknown) => void): () => void;
}

/** A message body without its envelope, distributed over the union. */
export type Body<M> = M extends unknown ? Omit<M, keyof Envelope> : never;

export interface Channel<In extends { readonly t: string }, Out extends { readonly t: string }> {
  /** The session this channel is bound to; `undefined` on the main side before `hello`. */
  readonly sessionId: string | undefined;
  send(body: Body<Out>): void;
  /** Calls `handler` for every incoming message of type `t`. Returns an unsubscribe function. */
  on<T extends In['t']>(t: T, handler: (message: MessageOf<In, T>) => void): () => void;
  /**
   * Resolves with the next incoming message of type `t` that matches `where` (09 §3.3 pull
   * loop). Messages are not buffered: call `next()` before sending the request it answers.
   */
  next<T extends In['t']>(t: T, options?: NextOptions<MessageOf<In, T>>): Promise<MessageOf<In, T>>;
  /** Stops listening; pending `next()` calls reject. */
  close(): void;
}

export interface NextOptions<M> {
  readonly signal?: AbortSignal;
  /** Only a message for which this returns `true` resolves the call; others are skipped. */
  readonly where?: (message: M) => boolean;
}

export type MainChannel = Channel<UiToMain, MainToUi>;
export type UiChannel = Channel<MainToUi, UiToMain>;

/** Thrown by `send()` on the main side before the UI said `hello`, and by `next()` after `close()`. */
export class ChannelError extends Error {
  override readonly name = 'ChannelError';
}

interface SessionPolicy<In> {
  current(): string | undefined;
  /** Whether `message` belongs to this channel; may bind the session. */
  accept(message: In): boolean;
}

function createChannel<In extends { readonly t: string }, Out extends { readonly t: string }>(
  transport: Transport,
  parse: (value: unknown) => In | undefined,
  session: SessionPolicy<In>,
): Channel<In, Out> {
  type Handler = (message: In) => void;
  const handlers = new Map<string, Set<Handler>>();
  const closers = new Set<(error: Error) => void>();

  const unsubscribe = transport.subscribe((raw) => {
    const message = parse(raw);
    if (message === undefined || !session.accept(message)) return;
    for (const handler of [...(handlers.get(message.t) ?? [])]) handler(message);
  });

  const on: Channel<In, Out>['on'] = (t, handler) => {
    const set = handlers.get(t) ?? new Set<Handler>();
    handlers.set(t, set);
    const typed = handler as Handler;
    set.add(typed);
    return () => {
      set.delete(typed);
    };
  };

  return {
    get sessionId() {
      return session.current();
    },
    send(body) {
      const sessionId = session.current();
      if (sessionId === undefined) throw new ChannelError(`Cannot send "${body.t}" before the UI said hello.`);
      transport.post({ v: PROTOCOL_VERSION, sessionId, ...body });
    },
    on,
    next(t, { signal, where } = {}) {
      return new Promise((resolve, reject) => {
        const settle = (error?: Error) => {
          off();
          closers.delete(fail);
          signal?.removeEventListener('abort', abort);
          if (error) reject(error);
        };
        const fail = (error: Error) => settle(error);
        const abort = () => settle(signal?.reason instanceof Error ? signal.reason : new ChannelError('Aborted.'));
        const off = on(t, (message) => {
          if (where && !where(message)) return;
          settle();
          resolve(message);
        });
        if (signal?.aborted) return abort();
        closers.add(fail);
        signal?.addEventListener('abort', abort, { once: true });
      });
    },
    close() {
      unsubscribe();
      handlers.clear();
      for (const fail of [...closers]) fail(new ChannelError('Channel closed.'));
    },
  };
}

/**
 * The main-thread end. It binds to the session of the latest `hello` (a reloaded UI starts
 * a new session) and ignores messages from any other session.
 */
export function createMainChannel(transport: Transport): MainChannel {
  let sessionId: string | undefined;
  return createChannel<UiToMain, MainToUi>(transport, parseUiToMain, {
    current: () => sessionId,
    accept(message) {
      if (message.t === 'hello') sessionId = message.sessionId;
      return message.sessionId === sessionId;
    },
  });
}

/**
 * A random session id. `crypto.randomUUID` needs a secure context, which the plugin iframe
 * (`null` origin) is not guaranteed to be; `getRandomValues` works everywhere.
 */
export function createSessionId(random: Pick<Crypto, 'getRandomValues'> = crypto): string {
  const bytes = random.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The UI end, bound to the `sessionId` it announces in `hello`. */
export function createUiChannel(transport: Transport, sessionId: string): UiChannel {
  return createChannel<MainToUi, UiToMain>(transport, parseMainToUi, {
    current: () => sessionId,
    accept: (message) => message.sessionId === sessionId,
  });
}

/** The part of `figma.ui` that messaging needs. */
export type FigmaUiPort = Pick<UIAPI, 'postMessage' | 'on' | 'off'>;

/** Main-thread transport over `figma.ui`. */
export function figmaUiTransport(ui: FigmaUiPort): Transport {
  return {
    post: (message) => ui.postMessage(message),
    subscribe(listener) {
      const handler = (message: unknown) => listener(message);
      ui.on('message', handler);
      return () => ui.off('message', handler);
    },
  };
}

/** The part of the UI iframe's `window` that messaging needs. */
export interface UiWindowPort {
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void };
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/**
 * UI transport over `window`. Figma wraps main's messages as `{ pluginMessage }` and
 * expects the same wrapper back; the `'*'` target is required because the plugin iframe
 * has a `null` origin (Figma docs, "Creating a user interface").
 */
export function windowTransport(win: UiWindowPort): Transport {
  return {
    post: (message) => win.parent.postMessage({ pluginMessage: message }, '*'),
    subscribe(listener) {
      const handler = (event: MessageEvent) => {
        const data: unknown = event.data;
        if (typeof data === 'object' && data !== null && 'pluginMessage' in data) listener(data.pluginMessage);
      };
      win.addEventListener('message', handler);
      return () => win.removeEventListener('message', handler);
    },
  };
}
