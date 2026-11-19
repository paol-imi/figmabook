import { availableParallelism, cpus } from 'node:os';

/** What the worker count depends on; injectable for tests. */
export interface WorkerHost {
  readonly ci: boolean;
  readonly parallelism: number;
  readonly cpus: number;
}

/** The current machine. `CI` is set by every common CI provider. */
export function currentHost(env: NodeJS.ProcessEnv = process.env): WorkerHost {
  const ci = env.CI !== undefined && env.CI !== '' && env.CI !== '0' && env.CI.toLowerCase() !== 'false';
  return { ci, parallelism: availableParallelism(), cpus: cpus().length };
}

/**
 * The number of capture workers (05 §1.1, `capture.workers`, 16 §7): `auto` is
 * `min(8, max(1, availableParallelism − 1))` locally and `min(4, cpus)` in CI; a number is
 * used as given (`--concurrency`).
 */
export function resolveWorkerCount(workers: number | 'auto' = 'auto', host: WorkerHost = currentHost()): number {
  if (workers !== 'auto') {
    if (!Number.isInteger(workers) || workers < 1) {
      throw new RangeError(`capture.workers must be a positive integer or 'auto', got ${workers}.`);
    }
    return workers;
  }
  if (host.ci) return Math.max(1, Math.min(4, host.cpus));
  return Math.min(8, Math.max(1, host.parallelism - 1));
}
