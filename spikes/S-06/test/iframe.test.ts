import { unzip, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { blobWorkerFacts, contextFacts, fflateFacts, type ZipLib } from '../iframe.ts';

type Listener = ((event: { data: unknown }) => void) | null;

/** A Worker stand-in: echoes, stays silent, or fails to start. */
function fakeWorker(mode: 'echo' | 'silent' | 'throws') {
  const created: FakeWorker[] = [];
  class FakeWorker {
    onmessage: Listener = null;
    onerror: ((event: { message: string }) => void) | null = null;
    terminated = false;
    constructor(readonly url: string) {
      if (mode === 'throws') throw new Error(`Failed to construct 'Worker': access to ${url} denied`);
      created.push(this);
    }
    postMessage(data: unknown) {
      if (mode === 'echo') queueMicrotask(() => this.onmessage?.({ data }));
    }
    terminate() {
      this.terminated = true;
    }
  }
  const revoked: string[] = [];
  const urls = { createObjectURL: () => 'blob:fake-1', revokeObjectURL: (url: string) => revoked.push(url) };
  return { globals: { Worker: FakeWorker, Blob, URL: urls }, created, revoked };
}

let clock = 0;
const options = { timeoutMs: 30, now: () => (clock += 4) };

describe('contextFacts', () => {
  it('reads isSecureContext and the origin', async () => {
    expect(await contextFacts({ isSecureContext: false, location: { origin: 'null' } })).toEqual({
      isSecureContext: false,
      origin: 'null',
      error: null,
    });
  });

  it('records a location that throws, and a missing isSecureContext', async () => {
    const location = {
      get origin(): string {
        throw new Error('Blocked a frame from accessing location');
      },
    };
    expect(await contextFacts({ location })).toEqual({
      isSecureContext: null,
      origin: null,
      error: 'Blocked a frame from accessing location',
    });
  });
});

describe('blobWorkerFacts', () => {
  it('starts a worker from a Blob URL, waits for the echo, then cleans up', async () => {
    const fake = fakeWorker('echo');
    const facts = await blobWorkerFacts(fake.globals, options);
    expect(facts).toMatchObject({ status: 'ok', error: null });
    expect(facts.ms).toBeTypeOf('number');
    expect(fake.created[0]?.url).toBe('blob:fake-1');
    expect(fake.created[0]?.terminated).toBe(true);
    expect(fake.revoked).toEqual(['blob:fake-1']);
  });

  it('gives up when the worker never answers', async () => {
    const fake = fakeWorker('silent');
    const facts = await blobWorkerFacts(fake.globals, options);
    expect(facts).toEqual({ status: 'error', error: 'Blob URL worker echo: no answer after 30 ms', ms: null });
    expect(fake.created[0]?.terminated).toBe(true);
  });

  it('records a worker that cannot start', async () => {
    const fake = fakeWorker('throws');
    expect(await blobWorkerFacts(fake.globals, options)).toEqual({
      status: 'error',
      error: "Failed to construct 'Worker': access to blob:fake-1 denied",
      ms: null,
    });
    expect(fake.revoked).toEqual(['blob:fake-1']);
  });

  it('reports a missing Worker', async () => {
    expect(await blobWorkerFacts({ Blob, URL }, options)).toEqual({ status: 'missing', error: null, ms: null });
  });
});

describe('fflateFacts', () => {
  const lib: ZipLib = { zipSync, unzip, unzipSync };

  it('unzips small and large entries asynchronously with the real fflate', async () => {
    const facts = await fflateFacts();
    expect(facts.asyncUnzipSmall.status).toBe('ok');
    expect(facts.unzipSync.status).toBe('ok');
    expect(facts.asyncUnzipLarge).toEqual({ status: 'ok', error: null });
    expect(facts.path).toBe('async-worker');
  }, 20_000);

  it('falls back to the inline path when the worker path fails', async () => {
    const noWorkers: ZipLib = {
      ...lib,
      unzip: ((data: Uint8Array, cb: Parameters<typeof unzip>[1]) => {
        if (data.length > 0 && unzipSync(data)['large.bin']) throw new Error('Worker is not defined');
        return unzip(data, cb);
      }) as typeof unzip,
    };
    const facts = await fflateFacts(async () => noWorkers);
    expect(facts.asyncUnzipLarge).toEqual({ status: 'error', error: 'Worker is not defined' });
    expect(facts.path).toBe('async-inline');
  });

  it('falls back to unzipSync when async unzip never calls back', async () => {
    const silent: ZipLib = { ...lib, unzip: (() => () => {}) as typeof unzip };
    const facts = await fflateFacts(async () => silent, 20);
    expect(facts.asyncUnzipSmall).toEqual({ status: 'error', error: 'fflate unzip: no answer after 20 ms' });
    expect(facts.path).toBe('sync');
  });

  it('records a library that fails to load', async () => {
    const facts = await fflateFacts(async () => {
      throw new Error('import failed');
    });
    const failed = { status: 'error', error: 'import failed' };
    expect(facts).toEqual({ asyncUnzipSmall: failed, asyncUnzipLarge: failed, unzipSync: failed, path: 'none' });
  });
});
