import { describe, expect, it } from 'vitest';
import {
  diagnosticBatches,
  MAIN_TO_UI_TYPES,
  MAX_DIAGNOSTICS_PER_MESSAGE,
  PROTOCOL_VERSION,
  parseMainToUi,
  parseUiToMain,
  UI_TO_MAIN_TYPES,
} from '../src/protocol';
import { envelope, mainToUiBodies, uiToMainBodies } from './fixtures';

const uiMessages = Object.values(uiToMainBodies).flatMap((bodies) => bodies.map((body) => ({ ...envelope, ...body })));
const mainMessages = Object.values(mainToUiBodies).flatMap((bodies) =>
  bodies.map((body) => ({ ...envelope, ...body })),
);

describe('main ↔ UI protocol (09 §3.2)', () => {
  it('is version 1 and covers the slice subset of message types', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect([...UI_TO_MAIN_TYPES].sort()).toEqual(['cancel', 'hello', 'pong', 'session.open', 'unit']);
    expect([...MAIN_TO_UI_TYPES].sort()).toEqual(['diagnostics', 'done', 'error', 'need', 'ping', 'progress', 'ready']);
  });

  it.each(uiMessages.map((message) => [message.t, message] as const))('accepts UI → main %s', (_t, message) => {
    expect(parseUiToMain(message)).toBe(message);
    expect(parseMainToUi(message)).toBeUndefined();
  });

  it.each(mainMessages.map((message) => [message.t, message] as const))('accepts main → UI %s', (_t, message) => {
    expect(parseMainToUi(message)).toBe(message);
    expect(parseUiToMain(message)).toBeUndefined();
  });

  const hello = { ...envelope, t: 'hello', uiVersion: '0.0.0' };
  it.each([
    ['null', null],
    ['a string', 'hello'],
    ['another protocol version', { ...hello, v: 2 }],
    ['no session', { ...hello, sessionId: undefined }],
    ['an empty session', { ...hello, sessionId: '' }],
    ['an unknown type', { ...hello, t: 'explode' }],
    ['an inherited type name', { ...hello, t: 'toString' }],
    ['a missing field', { ...envelope, t: 'hello' }],
    [
      'a session.open that is not a bundle',
      { ...envelope, t: 'session.open', manifest: {}, source: 'file', options: {} },
    ],
    ['an unknown bundle source', { ...envelope, ...uiToMainBodies['session.open'][0], source: 'email' }],
    ['bad apply options', { ...envelope, ...uiToMainBodies['session.open'][0], options: { undo: 'never' } }],
    [
      'a part past the end',
      {
        ...envelope,
        t: 'unit',
        seq: 0,
        last: true,
        unit: { kind: 'component', sid: 'a', json: '', part: 2, parts: 2 },
      },
    ],
    [
      'asset bytes that are not bytes',
      {
        ...envelope,
        t: 'unit',
        seq: 0,
        last: true,
        unit: { kind: 'asset', sha256: 'a', mime: 'image/png', bytes: [1] },
      },
    ],
    ['an unknown unit kind', { ...envelope, t: 'unit', seq: 0, last: true, unit: { kind: 'font' } }],
    ['a negative pong id', { ...envelope, t: 'pong', id: -1 }],
  ])('rejects %s from the UI', (_label, message) => {
    expect(parseUiToMain(message)).toBeUndefined();
  });

  it.each([
    ['an unknown stage', { ...envelope, t: 'progress', stage: 'dance', done: 0, total: 1 }],
    ['progress past the total', { ...envelope, t: 'progress', stage: 'apply', done: 2, total: 1 }],
    ['a fractional count', { ...envelope, t: 'progress', stage: 'apply', done: 0.5, total: 1 }],
    ['a bad diagnostic', { ...envelope, t: 'diagnostics', items: [{ code: 'X', severity: 'loud', message: '' }] }],
    [
      'too many diagnostics',
      {
        ...envelope,
        t: 'diagnostics',
        items: Array.from({ length: MAX_DIAGNOSTICS_PER_MESSAGE + 1 }, () => ({
          code: 'X',
          severity: 'info',
          message: '',
        })),
      },
    ],
    ['a ready without registry', { ...envelope, t: 'ready', pluginVersion: '0', irMajors: [0], fileKey: null }],
    [
      'a ready with bad majors',
      { ...envelope, t: 'ready', pluginVersion: '0', irMajors: ['0'], fileKey: null, registry: null },
    ],
    ['an unknown need', { ...envelope, t: 'need', unit: { kind: 'component' } }],
    ['an incomplete summary', { ...envelope, t: 'done', summary: { componentsOk: 1 } }],
    [
      'a done with another document as report',
      {
        ...envelope,
        t: 'done',
        summary: { componentsOk: 1, componentsFailed: 0, variants: 1, durationMs: 1, cancelled: false },
        report: { kind: 'holotype/report', components: [], diagnostics: [] },
      },
    ],
    ['an error without code', { ...envelope, t: 'error', message: 'x', recoverable: true }],
  ])('rejects %s from main', (_label, message) => {
    expect(parseMainToUi(message)).toBeUndefined();
  });
});

describe('diagnosticBatches', () => {
  const item = (n: number) => ({ code: `APPLY_TEST_${n}`, severity: 'info' as const, message: `#${n}` });

  it('splits diagnostics into messages of at most 200 items, in order', () => {
    const items = Array.from({ length: 450 }, (_, n) => item(n));
    const batches = diagnosticBatches(items);
    expect(batches.map((batch) => batch.items.length)).toEqual([200, 200, 50]);
    expect(batches.flatMap((batch) => batch.items)).toEqual(items);
    for (const batch of batches) expect(parseMainToUi({ ...envelope, ...batch })).toBeDefined();
  });

  it('sends nothing for no diagnostics', () => {
    expect(diagnosticBatches([])).toEqual([]);
  });
});
