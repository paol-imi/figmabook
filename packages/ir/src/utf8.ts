/**
 * UTF-8 encoding without `TextEncoder`, which the Figma main thread does not provide.
 * Lone surrogates become U+FFFD, exactly like `TextEncoder`.
 */
export function utf8Encode(input: string): Uint8Array {
  // At most 3 bytes per UTF-16 code unit (a surrogate pair is 2 units and 4 bytes).
  const out = new Uint8Array(input.length * 3);
  let n = 0;
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code < 0x80) {
      out[n++] = code;
      continue;
    }
    if (code < 0x800) {
      out[n++] = 0xc0 | (code >> 6);
      out[n++] = 0x80 | (code & 0x3f);
      continue;
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      const next = input.charCodeAt(i + 1);
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        const point = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        out[n++] = 0xf0 | (point >> 18);
        out[n++] = 0x80 | ((point >> 12) & 0x3f);
        out[n++] = 0x80 | ((point >> 6) & 0x3f);
        out[n++] = 0x80 | (point & 0x3f);
        i++;
        continue;
      }
      code = 0xfffd;
    }
    out[n++] = 0xe0 | (code >> 12);
    out[n++] = 0x80 | ((code >> 6) & 0x3f);
    out[n++] = 0x80 | (code & 0x3f);
  }
  return out.slice(0, n);
}
