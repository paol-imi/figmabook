/**
 * Severity of an emitted diagnostic (02 §9):
 * - `info`: an approximation with no visible effect;
 * - `warn`: a visible approximation or fallback;
 * - `error`: the node, variant or component was not produced as requested;
 * - `fatal`: the run aborted.
 */
export type Severity = 'info' | 'warn' | 'error' | 'fatal';

/** The severity a code is registered with. `fatal` is only ever raised by an emitter. */
export type DefaultSeverity = Exclude<Severity, 'fatal'>;

const RANK: Readonly<Record<Severity, number>> = { info: 0, warn: 1, error: 2, fatal: 3 };

/** Orders severities: negative when `a` is less severe than `b`, `0` when equal. */
export function compareSeverity(a: Severity, b: Severity): number {
  return RANK[a] - RANK[b];
}

/** The highest severity in `items`, or `undefined` when there are none. */
export function maxSeverity(items: Iterable<{ readonly severity: Severity }>): Severity | undefined {
  let max: Severity | undefined;
  for (const { severity } of items) {
    if (max === undefined || compareSeverity(severity, max) > 0) max = severity;
  }
  return max;
}
