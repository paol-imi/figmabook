import { AffinityScheduler, SerialQueue } from './scheduler';
import { CaptureWorker, type SessionLike, type WorkerBackend, type WorkerJob, type WorkerOptions } from './worker';

export interface PoolOptions extends WorkerOptions {
  /** Number of workers (contexts), each with one page. */
  readonly size: number;
}

/**
 * The worker pool (05 §1.1): N workers over one backend (one Chromium). Jobs with the same
 * affinity key (the component id) run on the same worker, in order; workers open their
 * context lazily, on their first job.
 */
export class CapturePool<S extends SessionLike> {
  private readonly scheduler: AffinityScheduler<string>;
  private readonly workers: CaptureWorker<S>[];
  private readonly queues: SerialQueue[];
  private closing: Promise<void> | undefined;

  constructor(backend: WorkerBackend<S>, options: PoolOptions) {
    this.scheduler = new AffinityScheduler(options.size);
    this.workers = Array.from({ length: options.size }, () => new CaptureWorker(backend, options));
    this.queues = Array.from({ length: options.size }, () => new SerialQueue());
  }

  get size(): number {
    return this.workers.length;
  }

  /** Runs `job` on the worker of `key`, after the jobs already queued there. */
  run<T>(key: string, job: WorkerJob<S, T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('The capture pool is closed.'));
    const slot = this.scheduler.acquire(key);
    const worker = this.workers[slot];
    const queue = this.queues[slot];
    if (worker === undefined || queue === undefined) throw new Error(`No worker in slot ${slot}.`);
    return queue.run(() => worker.run(job)).finally(() => this.scheduler.release(slot));
  }

  /** Waits for queued jobs, then closes every worker. Idempotent. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      await Promise.all(this.queues.map((queue) => queue.drain()));
      await Promise.all(this.workers.map((worker) => worker.close()));
    })();
    return this.closing;
  }
}
