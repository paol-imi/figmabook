/**
 * S-06 sandbox probes that run the same way in the plugin main thread and in the UI iframe:
 * code generation (`new Function`, `eval`, a compiled TypeBox validator), Web Crypto and the
 * structured-clone / text-encoding globals. Every probe catches its own errors and records the
 * message, so one missing feature never stops the step.
 */
import { probe } from '../_shared/figma.ts';

export type Globals = Record<string, unknown>;

/**
 * Result of one check. `missing`: the feature is not there. `error`: calling it threw (the
 * message is the evidence). `wrong`: it ran but returned something unexpected.
 */
export type Outcome = { readonly status: 'ok' | 'wrong' | 'missing' | 'error'; readonly error: string | null };

const MISSING: Outcome = { status: 'missing', error: null };

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Runs `run` when `present`, and is `ok` when `accept` holds for its value. */
export async function check<T>(
  present: boolean,
  run: () => T | Promise<T>,
  accept: (value: T) => boolean,
): Promise<Outcome> {
  if (!present) return MISSING;
  const result = await probe(run);
  if (!result.ok) return { status: 'error', error: result.error };
  return accept(result.value)
    ? { status: 'ok', error: null }
    : { status: 'wrong', error: `unexpected result ${stringify(result.value)}` };
}

export const isOk = (outcome: Outcome): boolean => outcome.status === 'ok';

const isFunction = (value: unknown): value is (...args: never[]) => unknown => typeof value === 'function';

/** SHA-256("abc"), FIPS 180-2 test vector. */
export const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type CryptoFacts = {
  readonly available: boolean;
  readonly subtle: boolean;
  /** `crypto.subtle.digest('SHA-256', "abc")` matches the FIPS test vector. */
  readonly digestSha256: Outcome;
  readonly getRandomValues: Outcome;
  readonly randomUUID: Outcome;
};

export async function cryptoFacts(globals: Globals): Promise<CryptoFacts> {
  const crypto = globals.crypto as Partial<Crypto> | undefined;
  const subtle = crypto?.subtle;
  return {
    available: typeof crypto === 'object' && crypto !== null,
    subtle: typeof subtle === 'object' && subtle !== null,
    digestSha256: await check(
      isFunction(subtle?.digest),
      async () => toHex(await (subtle as SubtleCrypto).digest('SHA-256', Uint8Array.of(0x61, 0x62, 0x63))),
      (hex) => hex === SHA256_ABC,
    ),
    getRandomValues: await check(
      isFunction(crypto?.getRandomValues),
      () => (crypto as Crypto).getRandomValues(new Uint8Array(16)).length,
      (length) => length === 16,
    ),
    randomUUID: await check(
      isFunction(crypto?.randomUUID),
      () => (crypto as Crypto).randomUUID(),
      (uuid) => UUID_V4.test(uuid),
    ),
  };
}

/** What the compiled validator answered for a valid and an invalid value. */
export type TypeBoxVerdicts = { readonly valid: boolean; readonly invalid: boolean };

/**
 * Compiles `{ a: number }` with TypeBox's `TypeCompiler` (which builds the validator with
 * `new Function`) and checks `{ a: 1 }` and `{ a: 'one' }`. TypeBox is imported lazily, so its
 * module code only runs inside this probe.
 */
export async function compiledTypeBoxCheck(): Promise<TypeBoxVerdicts> {
  const [{ Type }, { TypeCompiler }] = await Promise.all([
    import('@sinclair/typebox'),
    import('@sinclair/typebox/compiler'),
  ]);
  const validator = TypeCompiler.Compile(Type.Object({ a: Type.Number() }));
  return { valid: validator.Check({ a: 1 }), invalid: validator.Check({ a: 'one' }) };
}

export type CodegenFacts = {
  /** `new Function('return 1')()` returns 1. */
  readonly newFunction: Outcome;
  /** `eval('1')` returns 1 (an indirect call through the global object). */
  readonly eval: Outcome;
  /** A TypeBox `TypeCompiler` validator accepts `{ a: 1 }` (and rejects `{ a: 'one' }`). */
  readonly typeboxCompiled: Outcome;
};

export async function codegenFacts(
  globals: Globals,
  typebox: () => Promise<TypeBoxVerdicts> = compiledTypeBoxCheck,
): Promise<CodegenFacts> {
  const FunctionCtor = globals.Function;
  const evaluate = globals.eval;
  return {
    newFunction: await check(
      isFunction(FunctionCtor),
      () => new (FunctionCtor as FunctionConstructor)('return 1')() as unknown,
      (value) => value === 1,
    ),
    eval: await check(
      isFunction(evaluate),
      () => (evaluate as (code: string) => unknown)('1'),
      (value) => value === 1,
    ),
    typeboxCompiled: await check(true, typebox, (verdicts) => verdicts.valid && !verdicts.invalid),
  };
}

export type RuntimeFacts = {
  /** `structuredClone` copies a nested object. */
  readonly structuredClone: Outcome;
  /** `new TextEncoder().encode('hé')` gives the UTF-8 bytes. */
  readonly textEncoder: Outcome;
  /** `new TextDecoder().decode(...)` gives 'hé' back. */
  readonly textDecoder: Outcome;
};

const HE_UTF8 = [0x68, 0xc3, 0xa9];

export async function runtimeFacts(globals: Globals): Promise<RuntimeFacts> {
  const clone = globals.structuredClone;
  const Encoder = globals.TextEncoder;
  const Decoder = globals.TextDecoder;
  const original = { list: [1, { text: 'x' }], bytes: Uint8Array.of(1, 2) };
  return {
    structuredClone: await check(
      isFunction(clone),
      () => (clone as typeof structuredClone)(original),
      (copy) =>
        copy !== original &&
        copy.list !== original.list &&
        stringify(copy.list) === stringify(original.list) &&
        copy.bytes instanceof Uint8Array &&
        copy.bytes[1] === 2,
    ),
    textEncoder: await check(
      isFunction(Encoder),
      () => Array.from(new (Encoder as typeof TextEncoder)().encode('hé')),
      (bytes) => stringify(bytes) === stringify(HE_UTF8),
    ),
    textDecoder: await check(
      isFunction(Decoder),
      () => new (Decoder as typeof TextDecoder)().decode(Uint8Array.from(HE_UTF8)),
      (text) => text === 'hé',
    ),
  };
}
