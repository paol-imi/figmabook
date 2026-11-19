import { HolotypeError } from '@holotype/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJSON, type JsonPath, normalizeNumber } from '../src';

describe('canonicalJSON golden output (06 §5)', () => {
  it.each([
    ['sorts keys and drops undefined', { b: 1, a: [true, null, 'x'], c: undefined }, '{"a":[true,null,"x"],"b":1}'],
    ['sorts recursively', { z: { y: 1, x: [{ b: 2, a: 1 }] } }, '{"z":{"x":[{"a":1,"b":2}],"y":1}}'],
    ['sorts by UTF-16 code unit, not code point', { '～': 1, '😀': 2, é: 3, a: 4, Z: 5, '10': 6, '9': 7 }, '{"10":6,"9":7,"Z":5,"a":4,"é":3,"😀":2,"～":1}'],
    ['rounds lengths to 1/1000 px', { a: 0.1 + 0.2, b: 1.23456, c: -2.5, d: 123456789 }, '{"a":0.3,"b":1.235,"c":-2.5,"d":123456789}'],
    ['normalizes -0 after rounding', { a: -0, b: -0.0001 }, '{"a":0,"b":0}'],
    ['keeps shortest round-trip numbers', { big: 1e21, small: 0.001 }, '{"big":1e+21,"small":0.001}'],
    ['NFC-normalizes strings and keys', { 'café': 'café' }, '{"café":"café"}'],
    ['keeps empty containers', { fills: [], meta: {} }, '{"fills":[],"meta":{}}'],
  ])('%s', (_name, input, expected) => {
    expect(canonicalJSON(input)).toBe(expected);
  });

  it('rounds per number kind', () => {
    expect(canonicalJSON([0.123456789, 0.0000005], { numKind: 'ratio' })).toBe('[0.123457,0.000001]');
    const byPath = (path: JsonPath) => (path.includes('opacity') ? 'ratio' : 'px');
    expect(canonicalJSON({ fills: [{ opacity: 1 / 3 }], width: 31 / 3 }, { numKind: byPath })).toBe(
      '{"fills":[{"opacity":0.333333}],"width":10.333}',
    );
  });

  it('leaves numbers beyond float precision untouched', () => {
    expect(normalizeNumber(Number.MAX_VALUE, 'ratio')).toBe(Number.MAX_VALUE);
  });
});

describe('canonicalJSON rejects non-JSON data', () => {
  it('throws CAP_NONFINITE_VALUE with a JSON pointer for NaN and Infinity', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const run = () => canonicalJSON({ variants: [{ w: bad }] });
      expect(run).toThrow(HolotypeError);
      expect(run).toThrow(/#\/variants\/0\/w/);
      try {
        run();
      } catch (error) {
        expect((error as HolotypeError).code).toBe('CAP_NONFINITE_VALUE');
      }
    }
  });

  it.each([
    ['undefined array items', [1, undefined]],
    ['top-level undefined', undefined],
    ['functions', { f: () => 1 }],
    ['bigints', { n: 1n }],
    ['class instances', { d: new Date(0) }],
    ['keys that collide after NFC', { 'café': 1, café: 2 }],
  ])('throws a TypeError for %s', (_name, input) => {
    expect(() => canonicalJSON(input)).toThrow(TypeError);
  });

  it('throws on cycles but accepts shared references', () => {
    const shared = { a: 1 };
    expect(canonicalJSON({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJSON(cyclic)).toThrow(/circular/);
  });
});

describe('canonicalJSON properties (12 §1.1)', () => {
  const reverseKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  };

  it('is idempotent through a JSON round trip', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const once = canonicalJSON(value);
        expect(canonicalJSON(JSON.parse(once))).toBe(once);
      }),
    );
  });

  it('does not depend on key insertion order', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(canonicalJSON(reverseKeys(value))).toBe(canonicalJSON(value));
      }),
    );
  });

  it('is valid JSON', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(() => JSON.parse(canonicalJSON(value))).not.toThrow();
      }),
    );
  });
});
