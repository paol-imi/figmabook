/** A Playwright-style timeout error, so callers can tell a deadline from other failures. */
export function timeoutError(ms: number): Error {
  const error = new Error(`Timed out after ${ms} ms`);
  error.name = 'TimeoutError';
  return error;
}

/** Whether `error` is a Playwright `TimeoutError` or one made by {@link timeoutError}. */
export const isTimeout = (error: unknown): boolean => error instanceof Error && error.name === 'TimeoutError';

/** The time budget of one render attempt (`T.render`, 03 §5.3). */
export class Deadline {
  private readonly end: number;
  constructor(readonly timeoutMs: number) {
    this.end = Date.now() + timeoutMs;
  }

  /** Milliseconds left, at least 1 so Playwright never reads 0 as "no timeout". */
  remaining(): number {
    return Math.max(1, this.end - Date.now());
  }

  /** Races `work` against the deadline; rejects with a `TimeoutError` when it passes. */
  async race<T>(work: Promise<T>, graceMs = 0): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(this.timeoutMs)), this.remaining() + graceMs);
    });
    try {
      return await Promise.race([work, expired]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Validates a timeout option. */
export function checkTimeout(timeoutMs: number, name = 'renderTimeoutMs'): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`${name} must be a positive number of milliseconds, got ${timeoutMs}.`);
  }
  return timeoutMs;
}
