import { useCallback, useEffect, useReducer, useState } from 'preact/hooks';
import type { UiChannel } from '../channel';
import type { MainToUi, MessageOf } from '../protocol';
import { IDLE, RUN_MESSAGE_TYPES, type RunMessage, type RunState, reduceRun } from './run-state';

/** How long the UI waits for main's `ready` before it shows the start-up error. */
export const HANDSHAKE_TIMEOUT_MS = 5000;

export type ReadyInfo = Omit<MessageOf<MainToUi, 'ready'>, 'v' | 'sessionId' | 't'>;

export type Handshake =
  | { readonly status: 'starting' }
  | { readonly status: 'ready'; readonly info: ReadyInfo }
  | { readonly status: 'failed' };

/**
 * Says `hello` and waits for `ready` (09 §3.2). Returns the handshake state and a `retry`
 * that says `hello` again after a timeout.
 */
export function useHandshake(
  channel: UiChannel,
  uiVersion: string,
  timeoutMs = HANDSHAKE_TIMEOUT_MS,
): [Handshake, () => void] {
  const [state, setState] = useState<Handshake>({ status: 'starting' });
  const [attempt, setAttempt] = useState(0);

  // `attempt` is a dependency so that `retry` re-runs the handshake.
  useEffect(() => {
    setState({ status: 'starting' });
    const timer = setTimeout(() => setState({ status: 'failed' }), timeoutMs);
    const off = channel.on('ready', ({ pluginVersion, irMajors, fileKey, registry }) => {
      clearTimeout(timer);
      setState({ status: 'ready', info: { pluginVersion, irMajors, fileKey, registry } });
    });
    channel.send({ t: 'hello', uiVersion });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [channel, uiVersion, timeoutMs, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [state, retry];
}

/** Folds main's run messages into a {@link RunState}. */
export function useRun(channel: UiChannel): RunState {
  const [state, dispatch] = useReducer<RunState, RunMessage>(reduceRun, IDLE);
  useEffect(() => {
    const offs = RUN_MESSAGE_TYPES.map((t) => channel.on(t, dispatch));
    return () => {
      for (const off of offs) off();
    };
  }, [channel]);
  return state;
}

/** Answers main's yield `ping`s for as long as the UI is mounted (09 §12). */
export function usePong(channel: UiChannel): void {
  useEffect(() => channel.on('ping', ({ id }) => channel.send({ t: 'pong', id })), [channel]);
}
