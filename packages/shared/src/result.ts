import type { Diagnostic } from './diagnostic';
import { HolotypeError } from './errors';

/**
 * Outcome of an operation that can fail in an expected way (02 §9). Expected failures
 * are diagnostics; exceptions are reserved for programmer errors and infrastructure failures.
 */
export type Result<T, E = readonly Diagnostic[]> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Returns the value of an `Ok`, or throws the diagnostics of an `Err` as a {@link HolotypeError}. */
export function unwrap<T>(result: Result<T, readonly Diagnostic[]>): T {
  if (result.ok) return result.value;
  throw new HolotypeError(result.error);
}
