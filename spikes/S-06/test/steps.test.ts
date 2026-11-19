import { describe, expect, it } from 'vitest';
import { cryptoFacts, SHA256_ABC } from '../plugin.ts';
import { measureSeries, withTimeout } from '../steps.ts';

let clock = 0;
const now = () => (clock += 5);
const options = { sizes: [10, 20, 30, 40], timeoutMs: 50, now };

describe('measureSeries (postMessage size test)', () => {
  it('records every size until one fails, then stops', async () => {
    const series = await measureSeries(
      'string',
      'uiToMain',
      async (bytes) => {
        if (bytes === 30) throw new Error('out of memory');
        return bytes;
      },
      options,
    );
    expect(series.trials.map((trial) => [trial.bytes, trial.ok])).toEqual([
      [10, true],
      [20, true],
      [30, false],
    ]);
    expect(series.trials[2]?.error).toBe('out of memory');
    expect(series.maxOkBytes).toBe(20);
  });

  it('treats a truncated payload as a failure', async () => {
    const series = await measureSeries('bytes', 'mainToUi', async (bytes) => (bytes > 10 ? 5 : bytes), options);
    expect(series.maxOkBytes).toBe(10);
    expect(series.trials[1]?.error).toBe('arrived with 5 bytes');
  });

  it('gives up on a payload that never arrives', async () => {
    const series = await measureSeries('string', 'uiToMain', () => new Promise<number>(() => {}), {
      ...options,
      sizes: [10],
    });
    expect(series.trials[0]?.error).toMatch(/no answer after 50 ms/);
  });
});

describe('withTimeout', () => {
  it('passes values and errors through', async () => {
    await expect(withTimeout(Promise.resolve(1), 10, 'x')).resolves.toBe(1);
    await expect(withTimeout(Promise.reject(new Error('nope')), 10, 'x')).rejects.toThrow('nope');
  });
});

describe('cryptoFacts', () => {
  it('checks SHA-256 against the FIPS test vector', async () => {
    const facts = await cryptoFacts(globalThis as unknown as Record<string, unknown>);
    expect(facts).toMatchObject({ available: true, subtle: true, digestSha256: 'ok', getRandomValues: true });
  });

  it('reports a missing crypto object', async () => {
    expect(await cryptoFacts({})).toEqual({
      available: false,
      subtle: false,
      digestSha256: 'missing',
      digestError: null,
      getRandomValues: false,
      randomUUID: false,
    });
    expect(SHA256_ABC).toHaveLength(64);
  });

  it('reports a wrong digest', async () => {
    const subtle = { digest: async () => new Uint8Array(32).buffer };
    expect((await cryptoFacts({ crypto: { subtle } })).digestSha256).toBe('wrong');
  });
});
