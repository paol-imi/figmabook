/*
 * One capture worker (05 §1.1): a browser context with one long-lived page, recovered after a
 * crash and recycled after a number of variants (memory hygiene).
 */

/** What a worker needs of a page session. */
export interface SessionLike {
  /** The page crashed or closed, or the browser went away, since the session opened. */
  readonly broken: boolean;
  close(): Promise<void>;
}

/** An isolated browser context that opens page sessions. */
export interface ContextLike<S extends SessionLike> {
  openSession(): Promise<S>;
  close(): Promise<void>;
}

/** Opens browser contexts; relaunches the browser when it went away. */
export interface WorkerBackend<S extends SessionLike> {
  openContext(): Promise<ContextLike<S>>;
}

export interface WorkerOptions {
  /** Recycle the page after this many jobs. Default 500 (05 §1.1). */
  readonly recycleAfter?: number;
}

/** What a job learns about the attempt it runs in. */
export interface JobAttempt {
  /** 0 for the first attempt, 1 for the retry after a crash. */
  readonly attempt: number;
}

export type WorkerJob<S, T> = (session: S, attempt: JobAttempt) => Promise<T>;

export const DEFAULT_RECYCLE_AFTER = 500;

/**
 * Runs jobs on its session, one at a time (callers serialize; see `CapturePool`). A job whose
 * page crashed, or whose browser went away, is retried once on a fresh page; a second crash
 * on the same worker also replaces the context (05 §1.1 crash recovery).
 */
export class CaptureWorker<S extends SessionLike> {
  private context: ContextLike<S> | undefined;
  private session: S | undefined;
  private jobsOnPage = 0;
  private crashes = 0;
  private readonly recycleAfter: number;

  constructor(
    private readonly backend: WorkerBackend<S>,
    options: WorkerOptions = {},
  ) {
    this.recycleAfter = options.recycleAfter ?? DEFAULT_RECYCLE_AFTER;
    if (!Number.isInteger(this.recycleAfter) || this.recycleAfter < 1) {
      throw new RangeError(`recycleAfter must be a positive integer, got ${this.recycleAfter}.`);
    }
  }

  /** Crashes recovered so far. */
  get crashCount(): number {
    return this.crashes;
  }

  async run<T>(job: WorkerJob<S, T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const session = await this.openSession();
      let result: T;
      try {
        result = await job(session, { attempt });
      } catch (error) {
        if (!session.broken || attempt > 0) throw error;
        await this.recover();
        continue;
      }
      if (session.broken) {
        if (attempt > 0) return result;
        await this.recover();
        continue;
      }
      this.jobsOnPage += 1;
      if (this.jobsOnPage >= this.recycleAfter) await this.closeSession();
      return result;
    }
  }

  async close(): Promise<void> {
    await this.closeSession();
    const context = this.context;
    this.context = undefined;
    await context?.close();
  }

  private async openSession(): Promise<S> {
    if (this.session !== undefined && !this.session.broken) return this.session;
    if (this.session !== undefined) await this.closeSession();
    this.context ??= await this.backend.openContext();
    this.session = await this.context.openSession();
    this.jobsOnPage = 0;
    return this.session;
  }

  private async closeSession(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    await session?.close().catch(() => undefined);
  }

  /** A fresh page after a crash; from the second crash on, a fresh context too. */
  private async recover(): Promise<void> {
    this.crashes += 1;
    await this.closeSession();
    if (this.crashes >= 2) {
      const context = this.context;
      this.context = undefined;
      await context?.close().catch(() => undefined);
    }
  }
}
