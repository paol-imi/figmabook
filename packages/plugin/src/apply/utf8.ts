/**
 * UTF-8 decoding without `TextDecoder`, which the Figma main thread does not provide (09 §3.1).
 * Malformed sequences become U+FFFD, like `new TextDecoder()` (WHATWG "replacement" mode).
 */
export function utf8Decode(bytes: Uint8Array): string {
  const units: number[] = [];
  let out = '';
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0; // BOM
  while (i < bytes.length) {
    const [point, length] = decodePoint(bytes, i);
    i += length;
    if (point > 0xffff) {
      const offset = point - 0x10000;
      units.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    } else {
      units.push(point);
    }
    // Flush in blocks: `String.fromCharCode(...units)` has an argument-count limit.
    if (units.length >= 8192) out += String.fromCharCode(...units.splice(0));
  }
  return out + String.fromCharCode(...units);
}

const REPLACEMENT = 0xfffd;

/** The code point at `at` and the number of bytes it used (a bad sequence uses its valid prefix). */
function decodePoint(bytes: Uint8Array, at: number): readonly [number, number] {
  const lead = bytes[at] ?? 0;
  if (lead < 0x80) return [lead, 1];
  const [length, min, initial] =
    lead >= 0xc2 && lead <= 0xdf
      ? [2, 0x80, lead & 0x1f]
      : lead >= 0xe0 && lead <= 0xef
        ? [3, 0x800, lead & 0x0f]
        : lead >= 0xf0 && lead <= 0xf4
          ? [4, 0x10000, lead & 0x07]
          : [0, 0, 0];
  if (length === 0) return [REPLACEMENT, 1];
  let point = initial;
  for (let k = 1; k < length; k++) {
    const byte = bytes[at + k];
    if (byte === undefined || (byte & 0xc0) !== 0x80) return [REPLACEMENT, k];
    point = (point << 6) | (byte & 0x3f);
    // Reject overlong forms, surrogates and points past U+10FFFF as early as the second byte.
    if (k === 1 && !secondByteValid(lead, byte)) return [REPLACEMENT, 1];
  }
  return point < min ? [REPLACEMENT, length] : [point, length];
}

function secondByteValid(lead: number, byte: number): boolean {
  if (lead === 0xe0) return byte >= 0xa0;
  if (lead === 0xed) return byte <= 0x9f;
  if (lead === 0xf0) return byte >= 0x90;
  if (lead === 0xf4) return byte <= 0x8f;
  return true;
}
