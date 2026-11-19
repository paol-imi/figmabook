import { describe, expect, it } from 'vitest';
import { isProtocolMessage, type MainToUi, PROTOCOL_VERSION, type UiToMain } from '../src/protocol';

describe('main ↔ UI protocol (09 §3.2)', () => {
  const hello: UiToMain = { v: PROTOCOL_VERSION, sessionId: 's1', t: 'hello', uiVersion: '0.0.0' };

  it('accepts current-version messages of the expected type', () => {
    expect(isProtocolMessage<UiToMain>(hello, 'hello')).toBe(true);
    expect(isProtocolMessage<MainToUi>(hello, 'ready')).toBe(false);
  });

  it.each([null, 'hello', { ...hello, v: 2 }, { ...hello, sessionId: undefined }])('ignores %j', (message) => {
    expect(isProtocolMessage<UiToMain>(message, 'hello')).toBe(false);
  });
});
