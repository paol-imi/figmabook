import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJSON, fnv1a64, h16, hash, sha256Hex } from '../src';
import { utf8Encode } from '../src/utf8';

/** Reference FNV-1a-64 with BigInt, to cross-check the limb implementation. */
function fnv1a64Reference(bytes: Uint8Array): string {
  let h = 0xcbf29ce484222325n;
  for (const byte of bytes) h = ((h ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, '0');
}

const anyUtf16 = fc.string({ unit: fc.nat(0xffff).map((code) => String.fromCharCode(code)) });

describe('golden hashes', () => {
  it('sha256Hex matches the FIPS 180-2 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(sha256Hex('abc'));
  });

  it('h16 is sha256 truncated to 16 hex characters', () => {
    expect(h16('abc')).toBe('ba7816bf8f01cfea');
    expect(h16('holotype')).toBe('14b9d66bb4028150');
  });

  it('fnv1a64 matches the published FNV-1a 64-bit vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
    expect(fnv1a64('{"a":1}')).toBe('9c3e82dd6fcae8b1');
  });

  it('hash() is h16 of the canonical JSON', () => {
    const scene = {
      w: 10.3333333,
      variants: [{ vk: '0123456789abcdef', values: { Size: 'md' } }],
      sid: 'components-button',
      kind: 'holotype/scene-component',
    };
    expect(hash(scene)).toBe('f2e350f00736d8a9');
    // Variant key from the glossary: sha256(canonicalJSON({storyId, args, globals, state, viewport})).
    const variant = {
      storyId: 'components-button--primary',
      args: { label: 'Save' },
      globals: {},
      state: null,
      viewport: { w: 1280, h: 800 },
    };
    expect(hash(variant)).toBe('4e6c1d1c8f394a90');
  });
});

describe('hash properties', () => {
  it('pure-JS UTF-8 matches TextEncoder, including lone surrogates', () => {
    fc.assert(
      fc.property(anyUtf16, (text) => {
        expect(utf8Encode(text)).toEqual(new TextEncoder().encode(text));
      }),
    );
  });

  it('sha256Hex matches node:crypto', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
      }),
    );
  });

  it('fnv1a64 matches a BigInt reference', () => {
    fc.assert(
      fc.property(anyUtf16, (text) => {
        expect(fnv1a64(text)).toBe(fnv1a64Reference(new TextEncoder().encode(text)));
      }),
    );
  });

  it('hash(x) equals hash(roundtrip(x))', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(hash(JSON.parse(canonicalJSON(value)))).toBe(hash(value));
      }),
    );
  });
});
