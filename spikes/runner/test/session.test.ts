import { describe, expect, it } from 'vitest';
import type { SpikeDefinition } from '../../_shared/spike.ts';
import { storageKey } from '../src/kit-tasks.ts';
import { createStepIO, runStep, type StepRecord, stepRecordKey } from '../src/session.ts';
import { connect, TEST_ENV } from './support/harness.ts';

const spike: SpikeDefinition = {
  id: 'S-99',
  title: 'Sample',
  question: 'Does the runner work?',
  userTime: '1 min',
  steps: [
    {
      id: 'ok',
      label: 'Run',
      where: 'any file',
      run: async (io) => {
        await io.state.set('counter', 3);
        const { apiVersion } = (await io.call('kit/env', null)) as { apiVersion: string };
        return { results: { apiVersion, counter: (await io.state.get<number>('counter')) ?? 0 }, notes: ['note'] };
      },
    },
    {
      id: 'bad',
      label: 'Fail',
      where: 'any file',
      run: async (io) => {
        await io.call('kit/does-not-exist', null);
        return { results: {} };
      },
    },
  ],
};

const io = (connected: ReturnType<typeof connect>) =>
  createStepIO(connected.bridge, spike.id, TEST_ENV, {
    onProgress: () => {},
    onAsk: async () => ({ choice: 'continue', note: '' }),
  });

describe('runStep', () => {
  it('wraps a finished step in a done envelope and remembers it', async () => {
    const connected = connect();
    const [step] = spike.steps;
    if (!step) throw new Error('no step');
    const run = await runStep(spike, step, io(connected), '9.9.9');
    expect(run.envelope).toEqual({
      format: 'holotype-spike-result/1',
      spike: 'S-99',
      kitVersion: '9.9.9',
      step: 'ok',
      status: 'done',
      env: TEST_ENV,
      results: { apiVersion: '1.0.0', counter: 3 },
    });
    expect(run.notes).toEqual(['note']);
    const stored = (await connected.figma.clientStorage.getAsync(
      storageKey('S-99', stepRecordKey('ok')),
    )) as StepRecord;
    expect(stored.status).toBe('done');
  });

  it('turns a thrown error into a failed envelope with the message only', async () => {
    const connected = connect();
    const step = spike.steps[1];
    if (!step) throw new Error('no step');
    const run = await runStep(spike, step, io(connected), '9.9.9');
    expect(run.envelope.status).toBe('failed');
    expect(run.envelope.results).toEqual({ error: 'Unknown task "kit/does-not-exist". Is the kit up to date?' });
  });
});

describe('kit tasks', () => {
  it('keeps state per spike and clears only that spike', async () => {
    const connected = connect();
    await connected.bridge.call('kit/state.set', { spike: 'S-02', key: 'a', value: { n: 1 } });
    await connected.bridge.call('kit/state.set', { spike: 'S-12', key: 'a', value: 2 });
    expect(await connected.bridge.call('kit/state.get', { spike: 'S-02', key: 'a' })).toEqual({ value: { n: 1 } });
    expect(await connected.bridge.call('kit/state.get', { spike: 'S-02', key: 'missing' })).toEqual({ value: null });
    expect(await connected.bridge.call('kit/state.clear', { spike: 'S-02' })).toEqual({ removed: 1 });
    expect(await connected.bridge.call('kit/state.get', { spike: 'S-02', key: 'a' })).toEqual({ value: null });
    expect(await connected.bridge.call('kit/state.get', { spike: 'S-12', key: 'a' })).toEqual({ value: 2 });
  });

  it('reports the API version and editor type', async () => {
    expect(await connect().bridge.call('kit/env', null)).toEqual({ apiVersion: '1.0.0', editorType: 'figma' });
  });
});
