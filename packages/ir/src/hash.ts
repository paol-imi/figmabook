import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { type CanonicalOptions, canonicalJSON } from './canonical';
import { utf8Encode } from './utf8';

/*
 * Hashing is pure JS on every side (02 §6.2, D-31): the Figma main thread has no
 * `crypto.subtle` and no `TextEncoder`. Strings are hashed as their UTF-8 bytes.
 */

const toBytes = (input: string | Uint8Array): Uint8Array => (typeof input === 'string' ? utf8Encode(input) : input);

/** Full sha256 as 64 lowercase hex characters (asset `sha`). */
export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256(toBytes(input)));
}

/** sha256 truncated to 16 hex characters (64 bits): `vk`, `irh`, DCR ids (06 §6). */
export function h16(input: string | Uint8Array): string {
  return sha256Hex(input).slice(0, 16);
}

/** `h16` of a value's canonical JSON. */
export function hash(value: unknown, options?: CanonicalOptions): string {
  return h16(canonicalJSON(value, options));
}

// FNV-1a 64-bit, in four 16-bit limbs (least significant first) so it needs neither
// BigInt nor 64-bit integers. Offset basis 0xcbf29ce484222325, prime 0x100000001b3.
const OFFSET_BASIS: readonly [number, number, number, number] = [0x2325, 0x8422, 0x9ce4, 0xcbf2];

/**
 * FNV-1a-64 as 16 lowercase hex characters. Used only for the applied hash `ah`, which
 * the plugin computes in its main thread; it is not a cryptographic hash (D-31).
 */
export function fnv1a64(input: string | Uint8Array): string {
  let [h0, h1, h2, h3] = OFFSET_BASIS;
  for (const byte of toBytes(input)) {
    h0 ^= byte;
    // h × prime mod 2^64. The prime's limbs are [0x1b3, 0, 0x100, 0] (2^40 + 0x1b3).
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    const t2 = h2 * 0x1b3 + h0 * 0x100 + (t1 >>> 16);
    const t3 = h3 * 0x1b3 + h1 * 0x100 + (t2 >>> 16);
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  }
  return [h3, h2, h1, h0].map((limb) => limb.toString(16).padStart(4, '0')).join('');
}
