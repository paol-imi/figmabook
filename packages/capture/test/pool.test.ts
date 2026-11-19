import { describe, expect, it } from 'vitest';
import { CapturePool } from '../src/pool/pool';
import { AffinityScheduler, SerialQueue } from '../src/pool/scheduler';
import { CaptureWorker, type ContextLike, type SessionLike, type WorkerBackend } from '../src/pool/worker';

/** A fake page session; `crash()` marks it broken like a crashed page. */
class FakeSession implements SessionLike {
  broken = false;
  closed = false;
  constructor(
    readonly id: number,
    readonly contextId: number,
  ) {}
  crash(): void {
    this.broken = true;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeBackend implements WorkerBackend<FakeSession> {
  contexts = 0;
  sessions: FakeSession[] = [];
  closedContexts: number[] = [];
  async openContext(): Promise<ContextLike<FakeSession>> {
    const contextId = this.contexts++;
    return {
      openSession: async () => {
        const session = new FakeSession(this.sessions.length, contextId);
        this.sessions.push(session);
        return session;
      },
      close: async () => {
        this.closedContexts.push(contextId);
      },
    };
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('AffinityScheduler', () => {
  it('keeps a key on its slot and gives new keys the least loaded slot', () => {
    const scheduler = new AffinityScheduler<string>(3);
    expect(scheduler.acquire('button')).toBe(0);
    expect(scheduler.acquire('badge')).toBe(1);
    expect(scheduler.acquire('button')).toBe(0);
    expect(scheduler.acquire('card')).toBe(2);
    expect(scheduler.load()).toEqual([2, 1, 1]);
    scheduler.release(0);
    scheduler.release(0);
    // Slot 0 is idle again, so the next new key goes there; old keys stay put.
    expect(scheduler.acquire('input')).toBe(0);
    expect(scheduler.acquire('badge')).toBe(1);
  });

  it('rejects an empty pool and releasing an idle slot', () => {
    expect(() => new AffinityScheduler(0)).toThrow(RangeError);
    expect(() => new AffinityScheduler(1).release(0)).toThrow(RangeError);
  });
});

describe('SerialQueue', () => {
  it('runs tasks one at a time, in order, past failures', async () => {
    const queue = new SerialQueue();
    const log: string[] = [];
    const task =
      (name: string, fail = false) =>
      async () => {
        log.push(`start ${name}`);
        await tick();
        log.push(`end ${name}`);
        if (fail) throw new Error(name);
        return name;
      };
    const results = await Promise.allSettled([queue.run(task('a')), queue.run(task('b', true)), queue.run(task('c'))]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    await queue.drain();
  });
});

describe('CaptureWorker', () => {
  it('opens its context and page lazily and reuses the page', async () => {
    const backend = new FakeBackend();
    const worker = new CaptureWorker(backend);
    expect(backend.contexts).toBe(0);
    const ids = [await worker.run(async (session) => session.id), await worker.run(async (session) => session.id)];
    expect(ids).toEqual([0, 0]);
    expect(backend.contexts).toBe(1);
  });

  it('retries once on a fresh page after a crash, then replaces the context on the second crash', async () => {
    const backend = new FakeBackend();
    const worker = new CaptureWorker(backend);
    const attempts: number[] = [];
    const result = await worker.run(async (session, { attempt }) => {
      attempts.push(attempt);
      if (attempt === 0) session.crash();
      return `${session.contextId}/${session.id}`;
    });
    expect(attempts).toEqual([0, 1]);
    expect(result).toBe('0/1');
    expect(backend.sessions[0]?.closed).toBe(true);
    expect(worker.crashCount).toBe(1);

    await worker.run(async (session, { attempt }) => {
      if (attempt === 0) session.crash();
    });
    expect(worker.crashCount).toBe(2);
    expect(backend.closedContexts).toEqual([0]);
    expect(backend.sessions.at(-1)?.contextId).toBe(1);
  });

  it('retries a job that threw because its page crashed', async () => {
    const worker = new CaptureWorker(new FakeBackend());
    const result = await worker.run(async (session, { attempt }) => {
      if (attempt === 0) {
        session.crash();
        throw new Error('Target crashed');
      }
      return 'ok';
    });
    expect(result).toBe('ok');
  });

  it('does not retry ordinary errors, nor a second crash', async () => {
    const worker = new CaptureWorker(new FakeBackend());
    let calls = 0;
    await expect(
      worker.run(async () => {
        calls += 1;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);

    const attempts: number[] = [];
    const result = await worker.run(async (session, { attempt }) => {
      attempts.push(attempt);
      session.crash();
      return attempt;
    });
    expect(attempts).toEqual([0, 1]);
    expect(result).toBe(1);
  });

  it('recycles the page after `recycleAfter` jobs', async () => {
    const backend = new FakeBackend();
    const worker = new CaptureWorker(backend, { recycleAfter: 2 });
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push(await worker.run(async (session) => session.id));
    expect(ids).toEqual([0, 0, 1, 1, 2]);
    expect(backend.contexts).toBe(1);
    expect(() => new CaptureWorker(backend, { recycleAfter: 0 })).toThrow(RangeError);
  });

  it('closes its page and context', async () => {
    const backend = new FakeBackend();
    const worker = new CaptureWorker(backend);
    await worker.run(async () => undefined);
    await worker.close();
    expect(backend.sessions[0]?.closed).toBe(true);
    expect(backend.closedContexts).toEqual([0]);
  });
});

describe('CapturePool', () => {
  it('runs one component per worker in order, and components in parallel', async () => {
    const backend = new FakeBackend();
    const pool = new CapturePool(backend, { size: 2 });
    const log: string[] = [];
    const job = (name: string) => async (session: FakeSession) => {
      log.push(`start ${name}@${session.contextId}`);
      await tick();
      log.push(`end ${name}`);
      return session.contextId;
    };
    const slots = await Promise.all([
      pool.run('button', job('button-1')),
      pool.run('badge', job('badge-1')),
      pool.run('button', job('button-2')),
    ]);
    expect(slots).toEqual([0, 1, 0]);
    // Both workers started before either finished; button-2 waited for button-1.
    expect(log.slice(0, 2)).toEqual(['start button-1@0', 'start badge-1@1']);
    expect(log.indexOf('start button-2@0')).toBeGreaterThan(log.indexOf('end button-1'));
    expect(pool.size).toBe(2);
    await pool.close();
    expect(backend.closedContexts.sort()).toEqual([0, 1]);
  });

  it('opens only the contexts it needs', async () => {
    const backend = new FakeBackend();
    const pool = new CapturePool(backend, { size: 4 });
    await pool.run('button', async () => undefined);
    expect(backend.contexts).toBe(1);
    await pool.close();
  });

  it('waits for queued jobs on close and refuses new ones', async () => {
    const pool = new CapturePool(new FakeBackend(), { size: 1 });
    let done = false;
    const running = pool.run('button', async () => {
      await tick();
      done = true;
    });
    await pool.close();
    expect(done).toBe(true);
    await running;
    await expect(pool.run('button', async () => undefined)).rejects.toThrow(/closed/);
    await expect(pool.close()).resolves.toBeUndefined();
  });
});
