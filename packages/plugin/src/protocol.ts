/*
 * Plugin main ↔ UI messages (09 §3.2). Every message is a plain, structured-clone-safe
 * object carrying `{ v, sessionId }` and a discriminant `t`. Phase 0 ships the handshake.
 */

export const PROTOCOL_VERSION = 1;

interface Envelope {
  readonly v: typeof PROTOCOL_VERSION;
  readonly sessionId: string;
}

export type UiToMain = Envelope & { readonly t: 'hello'; readonly uiVersion: string };

export type MainToUi = Envelope & {
  readonly t: 'ready';
  readonly pluginVersion: string;
  /** Scene IR majors this build can apply. */
  readonly irMajors: readonly number[];
  readonly fileKey: string | null;
};

/** Narrows an incoming message to the current protocol; anything else is ignored. */
export function isProtocolMessage<T extends UiToMain | MainToUi>(value: unknown, t: T['t']): value is T {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<Envelope & { t: unknown }>;
  return message.v === PROTOCOL_VERSION && typeof message.sessionId === 'string' && message.t === t;
}
