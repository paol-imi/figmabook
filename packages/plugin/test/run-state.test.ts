import { describe, expect, it } from 'vitest';
import { IDLE, type RunMessage, type RunState, reduceRun } from '../src/ui/run-state';
import { envelope } from './fixtures';

const warn = { code: 'FONT_MISSING', severity: 'warn', message: 'Acme Sans is missing.' } as const;
const summary = { componentsOk: 2, componentsFailed: 0, variants: 8, durationMs: 900, cancelled: false };
const fold = (messages: RunMessage[], from: RunState = IDLE) => messages.reduce(reduceRun, from);

describe('reduceRun', () => {
  it('starts idle and runs on progress, keeping optional fields only when present', () => {
    expect(fold([{ ...envelope, t: 'progress', stage: 'apply', done: 1, total: 4 }])).toEqual({
      status: 'running',
      progress: { stage: 'apply', done: 1, total: 4 },
      diagnostics: [],
    });
    expect(
      fold([{ ...envelope, t: 'progress', stage: 'apply', done: 1, total: 4, current: 'Button', etaMs: 30 }]),
    ).toEqual(
      expect.objectContaining({ progress: { stage: 'apply', done: 1, total: 4, current: 'Button', etaMs: 30 } }),
    );
  });

  it('accumulates diagnostics through progress and into done', () => {
    const state = fold([
      { ...envelope, t: 'diagnostics', items: [warn] },
      { ...envelope, t: 'progress', stage: 'apply', done: 1, total: 2 },
      { ...envelope, t: 'diagnostics', items: [warn, warn] },
      { ...envelope, t: 'done', summary },
    ]);
    expect(state).toEqual({ status: 'done', summary, diagnostics: [warn, warn, warn] });
  });

  it('fails on error, keeping the diagnostics so far', () => {
    const state = fold([
      { ...envelope, t: 'diagnostics', items: [warn] },
      { ...envelope, t: 'error', code: 'APPLY_IR_VERSION_UNSUPPORTED', message: 'Too new.', recoverable: false },
    ]);
    expect(state).toEqual({
      status: 'failed',
      error: { code: 'APPLY_IR_VERSION_UNSUPPORTED', message: 'Too new.', recoverable: false },
      diagnostics: [warn],
    });
  });

  it('starts a new run with no diagnostics after a finished one', () => {
    const finished: RunState = { status: 'done', summary, diagnostics: [warn] };
    expect(fold([{ ...envelope, t: 'progress', stage: 'preflight', done: 0, total: 1 }], finished)).toMatchObject({
      status: 'running',
      diagnostics: [],
    });
  });

  it('adds late diagnostics to a finished run', () => {
    const finished: RunState = { status: 'done', summary, diagnostics: [] };
    expect(fold([{ ...envelope, t: 'diagnostics', items: [warn] }], finished)).toEqual({
      ...finished,
      diagnostics: [warn],
    });
  });
});
