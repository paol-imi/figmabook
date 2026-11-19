import { createHash } from 'node:crypto';
import { figmaError } from './errors';

/** Images larger than 4096 px on either side are rejected (typings:1739-1741). */
export const MAX_IMAGE_SIZE = 4096;

interface ImageInfo {
  readonly format: 'PNG' | 'JPEG' | 'GIF';
  readonly width: number;
  readonly height: number;
}

function readU16BE(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function readU32BE(bytes: Uint8Array, at: number): number {
  return readU16BE(bytes, at) * 0x10000 + readU16BE(bytes, at + 2);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

/** JPEG size from the first start-of-frame marker (SOF0…SOF15 except DHT/JPG/DAC). */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    const length = readU16BE(bytes, at + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: readU16BE(bytes, at + 5), width: readU16BE(bytes, at + 7) };
    at += 2 + length;
  }
  return null;
}

/**
 * Reads the format and pixel size of PNG, JPEG or GIF bytes, the only formats `createImage`
 * accepts (typings:1736-1742). Returns `null` for anything else.
 */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && bytes.length >= 24) {
    return { format: 'PNG', width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && bytes.length >= 10) {
    const width = (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8);
    const height = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
    return { format: 'GIF', width, height };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    const size = jpegSize(bytes);
    return size ? { format: 'JPEG', ...size } : null;
  }
  return null;
}

/**
 * The fake's `Image` handle (typings:12742-12760): not a node, identified by a hash of the
 * file contents. Figma's image hashes are 40 hex characters; the fake uses SHA-1 of the bytes,
 * so equal bytes always give the same hash.
 */
export class FakeImage implements Image {
  readonly hash: string;
  readonly #bytes: Uint8Array;
  readonly #info: ImageInfo;

  constructor(bytes: Uint8Array) {
    const info = sniffImage(bytes);
    if (info === null) throw figmaError('createImage', 'Image type is unsupported: expected PNG, JPEG or GIF');
    if (info.width > MAX_IMAGE_SIZE || info.height > MAX_IMAGE_SIZE || info.width < 1 || info.height < 1) {
      throw figmaError('createImage', `Image is too large: ${info.width}x${info.height} (maximum ${MAX_IMAGE_SIZE}px)`);
    }
    this.#bytes = bytes.slice();
    this.#info = info;
    this.hash = createHash('sha1').update(this.#bytes).digest('hex');
  }

  get format(): ImageInfo['format'] {
    return this.#info.format;
  }

  async getBytesAsync(): Promise<Uint8Array> {
    return this.#bytes.slice();
  }

  async getSizeAsync(): Promise<{ width: number; height: number }> {
    return { width: this.#info.width, height: this.#info.height };
  }
}
