import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { disposeBounded } from '../src';

const never = () => new Promise<never>(() => {});

interface FakeOptions {
  readonly evaluate?: () => Promise<unknown>;
  readonly close?: () => Promise<void>;
  readonly contextClose?: () => Promise<void>;
  readonly closed?: boolean;
}

function fakePage(options: FakeOptions = {}) {
  const calls: string[] = [];
  let closed = options.closed ?? false;
  const page = {
    isClosed: () => closed,
    evaluate: () => {
      calls.push('evaluate');
      return (options.evaluate ?? (async () => true))();
    },
    close: async () => {
      calls.push('close');
      await (options.close ?? (async () => {}))();
      closed = true;
    },
    context: () => ({
      close: async () => {
        calls.push('context.close');
        await (options.contextClose ?? (async () => {}))();
      },
    }),
  } as unknown as Page;
  return { page, calls };
}

async function timed<T>(work: Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await work;
  return { value, ms: Date.now() - started };
}

describe('disposeBounded', () => {
  it('leaves an answering page open', async () => {
    const { page, calls } = fakePage();
    expect(await disposeBounded(page, undefined, 50)).toEqual({ forced: 'none' });
    expect(calls).toEqual(['evaluate']);
  });

  it('waits for a render in flight that finishes, even one that failed', async () => {
    const { page } = fakePage();
    const failing = new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), 10));
    expect(await disposeBounded(page, failing, 200)).toEqual({ forced: 'none' });
  });

  it('does nothing for a page that is already closed', async () => {
    const { page, calls } = fakePage({ closed: true });
    expect(await disposeBounded(page, never(), 50)).toEqual({ forced: 'none' });
    expect(calls).toEqual([]);
  });

  it('closes a page that stops answering, within the bound', async () => {
    const { page, calls } = fakePage({ evaluate: never });
    const { value, ms } = await timed(disposeBounded(page, undefined, 50));
    expect(value).toEqual({ forced: 'page', reason: 'the page did not answer within 50 ms of dispose()' });
    expect(calls).toEqual(['evaluate', 'close']);
    expect(ms).toBeLessThan(1000);
  });

  it('closes the page when a render is still running after the bound', async () => {
    const { page } = fakePage();
    const { value } = await timed(disposeBounded(page, never(), 50));
    expect(value).toEqual({ forced: 'page', reason: 'a render was still running 50 ms after dispose()' });
  });

  it('closes the context when closing the page hangs too', async () => {
    const { page, calls } = fakePage({ evaluate: never, close: never });
    const { value, ms } = await timed(disposeBounded(page, undefined, 30));
    expect(value.forced).toBe('context');
    expect(calls).toEqual(['evaluate', 'close', 'context.close']);
    expect(ms).toBeLessThan(1000);
  });

  it('reports a page whose context does not close either, and still returns', async () => {
    const { page } = fakePage({ evaluate: never, close: never, contextClose: never });
    const { value, ms } = await timed(disposeBounded(page, undefined, 30));
    expect(value).toEqual({
      forced: 'stuck',
      reason: 'the page did not answer within 30 ms of dispose(); closing its page and context did not return either',
    });
    expect(ms).toBeLessThan(1000);
  });
});
