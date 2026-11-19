import { describe, expect, it } from 'vitest';
import {
  check,
  codegenFacts,
  compiledTypeBoxCheck,
  cryptoFacts,
  type Globals,
  runtimeFacts,
  SHA256_ABC,
} from '../sandbox.ts';

const real = globalThis as unknown as Globals;
const OK = { status: 'ok', error: null };
const MISSING = { status: 'missing', error: null };

describe('check', () => {
  it('reports missing, ok, wrong and thrown outcomes', async () => {
    expect(
      await check(
        false,
        () => 1,
        () => true,
      ),
    ).toEqual(MISSING);
    expect(
      await check(
        true,
        () => 1,
        (value) => value === 1,
      ),
    ).toEqual(OK);
    expect(
      await check(
        true,
        () => ({ got: 2 }),
        () => false,
      ),
    ).toEqual({
      status: 'wrong',
      error: 'unexpected result {"got":2}',
    });
    const thrown = await check(
      true,
      () => {
        throw new EvalError('Code generation from strings disallowed');
      },
      () => true,
    );
    expect(thrown).toEqual({ status: 'error', error: 'Code generation from strings disallowed' });
  });

  it('records a rejected promise', async () => {
    expect(
      await check(
        true,
        () => Promise.reject(new Error('denied')),
        () => true,
      ),
    ).toEqual({
      status: 'error',
      error: 'denied',
    });
  });
});

describe('cryptoFacts', () => {
  it('checks SHA-256 against the FIPS test vector, random values and UUIDs', async () => {
    expect(await cryptoFacts(real)).toEqual({
      available: true,
      subtle: true,
      digestSha256: OK,
      getRandomValues: OK,
      randomUUID: OK,
    });
    expect(SHA256_ABC).toHaveLength(64);
  });

  it('reports a missing crypto object', async () => {
    expect(await cryptoFacts({})).toEqual({
      available: false,
      subtle: false,
      digestSha256: MISSING,
      getRandomValues: MISSING,
      randomUUID: MISSING,
    });
  });

  it('reports a wrong digest, a throwing getRandomValues and a malformed UUID', async () => {
    const crypto = {
      subtle: { digest: async () => new Uint8Array(32).buffer },
      getRandomValues: () => {
        throw new Error('getRandomValues is not allowed');
      },
      randomUUID: () => 'not-a-uuid',
    };
    const facts = await cryptoFacts({ crypto });
    expect(facts.digestSha256.status).toBe('wrong');
    expect(facts.getRandomValues).toEqual({ status: 'error', error: 'getRandomValues is not allowed' });
    expect(facts.randomUUID).toEqual({ status: 'wrong', error: 'unexpected result "not-a-uuid"' });
  });
});

describe('codegenFacts', () => {
  it('runs new Function, eval and a compiled TypeBox validator', async () => {
    expect(await codegenFacts(real)).toEqual({ newFunction: OK, eval: OK, typeboxCompiled: OK });
  });

  it('compiles a TypeBox validator that accepts { a: 1 } and rejects { a: "one" }', async () => {
    expect(await compiledTypeBoxCheck()).toEqual({ valid: true, invalid: false });
  });

  it('records a sandbox that blocks code generation, without stopping', async () => {
    // A plain function, so `new` reaches the throw like a blocked `Function` constructor.
    function blocked(): never {
      throw new EvalError('Code generation from strings disallowed for this context');
    }
    const facts = await codegenFacts({ Function: blocked }, async () => blocked());
    expect(facts).toEqual({
      newFunction: { status: 'error', error: 'Code generation from strings disallowed for this context' },
      eval: MISSING,
      typeboxCompiled: { status: 'error', error: 'Code generation from strings disallowed for this context' },
    });
  });

  it('treats a validator that accepts everything as wrong', async () => {
    const facts = await codegenFacts(real, async () => ({ valid: true, invalid: true }));
    expect(facts.typeboxCompiled).toEqual({
      status: 'wrong',
      error: 'unexpected result {"valid":true,"invalid":true}',
    });
  });
});

describe('runtimeFacts', () => {
  it('round-trips structuredClone, TextEncoder and TextDecoder', async () => {
    expect(await runtimeFacts(real)).toEqual({ structuredClone: OK, textEncoder: OK, textDecoder: OK });
  });

  it('reports missing globals and a throwing structuredClone', async () => {
    expect(await runtimeFacts({})).toEqual({ structuredClone: MISSING, textEncoder: MISSING, textDecoder: MISSING });
    const facts = await runtimeFacts({
      structuredClone: () => {
        throw new Error('DataCloneError');
      },
    });
    expect(facts.structuredClone).toEqual({ status: 'error', error: 'DataCloneError' });
  });
});
