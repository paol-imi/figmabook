import { NotImplementedError } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { createFakeFigma, MAX_IMAGE_SIZE } from '../src';

/** The first bytes of a PNG: signature and IHDR with the given size. */
function png(width: number, height: number, salt = 0): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[32] = salt;
  return bytes;
}

function gif(width: number, height: number): Uint8Array {
  return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 0xff, width >> 8, height & 0xff, height >> 8]);
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment of length 4, then SOF0 with height and width.
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
  ]);
}

describe('createImage / getImageByHash (typings:1735-1782)', () => {
  it('accepts PNG, GIF and JPEG and reports their size', async () => {
    const figma = createFakeFigma();
    for (const [bytes, size] of [
      [png(64, 32), { width: 64, height: 32 }],
      [gif(10, 20), { width: 10, height: 20 }],
      [jpeg(300, 200), { width: 300, height: 200 }],
    ] as const) {
      const image = figma.createImage(bytes);
      expect(image.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(await image.getSizeAsync()).toEqual(size);
      expect(await image.getBytesAsync()).toEqual(bytes);
      expect(figma.getImageByHash(image.hash)).toBe(image);
    }
  });

  it('equal bytes give the same image; unknown hashes give null', () => {
    const figma = createFakeFigma();
    const a = figma.createImage(png(1, 1));
    const b = figma.createImage(png(1, 1));
    expect(b).toBe(a);
    expect(figma.createImage(png(1, 1, 1)).hash).not.toBe(a.hash);
    expect(figma.getImageByHash('0'.repeat(40))).toBeNull();
    expect(figma.snapshot().images).toHaveLength(2);
  });

  it('rejects other formats and images over 4096 px', () => {
    const figma = createFakeFigma();
    expect(() => figma.createImage(new TextEncoder().encode('<svg/>'))).toThrow(/unsupported/);
    expect(() => figma.createImage(png(MAX_IMAGE_SIZE + 1, 10))).toThrow(/too large/);
    expect(() => figma.createImage(png(MAX_IMAGE_SIZE, MAX_IMAGE_SIZE))).not.toThrow();
  });

  it('records image creation in the op log', () => {
    const figma = createFakeFigma();
    const image = figma.createImage(png(2, 2));
    expect(figma.ops()).toEqual([{ method: 'createImage', nodeId: null, property: null, value: { hash: image.hash } }]);
  });
});

describe('createNodeFromSvg (typings:1731-1734)', () => {
  const icon =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0L24 24" fill="#ff0000" fill-rule="evenodd"/><path d="M1 1"/></svg>';

  it('returns a frame of the SVG size with one vector per drawn path', () => {
    const figma = createFakeFigma();
    const frame = figma.createNodeFromSvg(icon);
    expect(frame.type).toBe('FRAME');
    expect(frame.parent).toBe(figma.currentPage);
    expect([frame.width, frame.height]).toEqual([24, 24]);
    expect(frame.fills).toEqual([]);
    // `M1 1` draws nothing, so it gives no layer.
    expect(frame.children).toHaveLength(1);
    const [first] = frame.children;
    if (first?.type !== 'VECTOR') throw new Error('expected a vector');
    expect(first.vectorPaths).toEqual([{ windingRule: 'EVENODD', data: 'M 0 0 L 24 24' }]);
    expect(first.fills).toEqual([expect.objectContaining({ color: { r: 1, g: 0, b: 0 } })]);
  });

  it('uses the viewBox when width and height are absent', () => {
    const frame = createFakeFigma().createNodeFromSvg('<svg viewBox="0 0 16 8"><path d="M0 0"/></svg>');
    expect([frame.width, frame.height]).toEqual([16, 8]);
  });

  it('throws for strings that are not SVG', () => {
    const figma = createFakeFigma();
    expect(() => figma.createNodeFromSvg('<div></div>')).toThrow(/not an SVG/);
    expect(() => figma.createNodeFromSvg('<svg width="1"><path d="M0 0"/>')).toThrow(/well formed/);
  });

  it('fails loudly on SVG elements the fake does not import (hardening)', () => {
    const figma = createFakeFigma();
    for (const element of ['<text>Hi</text>', '<image href="a.png"/>', '<use href="#a"/>', '<style>.a{}</style>']) {
      expect(() => figma.createNodeFromSvg(`<svg width="4" height="4">${element}</svg>`)).toThrow(NotImplementedError);
    }
    expect(() =>
      figma.createNodeFromSvg('<svg width="4" height="4"><path d="M0 0H4V4Z" clip-path="url(#c)"/></svg>'),
    ).toThrow(/hardening/);
  });
});
