import type { Diagnostic } from './diagnostic';

/** An exception that carries diagnostics, for failures that abort an operation. */
export class HolotypeError extends Error {
  override readonly name = 'HolotypeError';
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: Diagnostic | readonly Diagnostic[], options?: ErrorOptions) {
    const list: readonly Diagnostic[] = Array.isArray(diagnostics) ? diagnostics : [diagnostics];
    const [first] = list;
    super(first ? `[${first.code}] ${first.message}` : 'Unknown Holotype error', options);
    this.diagnostics = list;
  }

  /** Code of the first diagnostic. */
  get code(): string | undefined {
    return this.diagnostics[0]?.code;
  }
}

/** Thrown by public API stubs that a later roadmap phase implements. */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';

  constructor(feature: string, phase: string) {
    super(`${feature} is not implemented yet (roadmap ${phase}).`);
  }
}
