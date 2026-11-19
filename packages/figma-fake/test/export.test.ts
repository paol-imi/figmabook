import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createFakeFigma } from '../src';

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

/** The decompressed IDAT data of a single-IDAT PNG. */
function pixels(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(bytes.slice(at + 4, at + 8));
    if (type === 'IDAT') return inflateSync(bytes.slice(at + 8, at + 8 + length));
    at += 12 + length;
  }
  throw new Error('no IDAT');
}

describe('exportAsync placeholder (BUILD §8.1 "Export", typings:9044-9132)', () => {
  it('exports a valid, transparent PNG at 1x by default', async () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    frame.resize(30, 20);
    const bytes = await frame.exportAsync();
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngSize(bytes)).toEqual([30, 20]);
    const data = pixels(bytes);
    expect(data.length).toBe(20 * (1 + 30 * 4));
    expect(data.every((byte) => byte === 0)).toBe(true);
    // Placeholders are valid images for createImage.
    expect(figma.createImage(bytes).hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('follows the SCALE, WIDTH and HEIGHT constraints (typings:5123-5129)', async () => {
    const frame = createFakeFigma().createFrame();
    frame.resize(30, 20);
    expect(pngSize(await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } }))).toEqual([
      60, 40,
    ]);
    expect(pngSize(await frame.exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: 15 } }))).toEqual([
      15, 10,
    ]);
    expect(pngSize(await frame.exportAsync({ format: 'PNG', constraint: { type: 'HEIGHT', value: 50 } }))).toEqual([
      75, 50,
    ]);
    await expect(frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 0 } })).rejects.toThrow(
      /constraint/,
    );
  });

  it('is deterministic and records no write', async () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    const before = figma.ops().length;
    expect(await frame.exportAsync()).toEqual(await frame.exportAsync());
    expect(figma.ops()).toHaveLength(before);
  });

  it('covers the render bounds unless useAbsoluteBounds (09 §14)', async () => {
    const rect = createFakeFigma().createRectangle();
    rect.resize(10, 10);
    rect.effects = [
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 1 },
        offset: { x: 0, y: 4 },
        radius: 2,
        visible: true,
        blendMode: 'NORMAL',
      },
    ];
    expect(pngSize(await rect.exportAsync())).toEqual([14, 16]);
    expect(pngSize(await rect.exportAsync({ format: 'PNG', useAbsoluteBounds: true }))).toEqual([10, 10]);
  });

  it('exports SVG as bytes or a string', async () => {
    const frame = createFakeFigma().createFrame();
    const text = await frame.exportAsync({ format: 'SVG_STRING' });
    expect(text).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="100" height="100"/);
    expect(new TextDecoder().decode(await frame.exportAsync({ format: 'SVG' }))).toBe(text);
  });

  it('a page must be loaded first (typings:9047)', async () => {
    const figma = createFakeFigma({ pages: ['A', 'B'] });
    const other = figma.root.children[1];
    if (!other) throw new Error('page missing');
    await expect(other.exportAsync()).rejects.toThrow(/loadAsync/);
    await other.loadAsync();
    expect(pngSize(await other.exportAsync())).toEqual([1, 1]);
  });
});

describe('absoluteRenderBounds (typings:7398-7400)', () => {
  it('is null for invisible nodes and grows with strokes, shadows, blur and unclipped children', () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    frame.x = 10;
    frame.resize(20, 20);
    expect(frame.absoluteRenderBounds).toEqual({ x: 10, y: 0, width: 20, height: 20 });
    frame.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    frame.strokeWeight = 2;
    frame.strokeAlign = 'OUTSIDE';
    expect(frame.absoluteRenderBounds).toEqual({ x: 8, y: -2, width: 24, height: 24 });
    frame.strokeAlign = 'CENTER';
    expect(frame.absoluteRenderBounds).toEqual({ x: 9, y: -1, width: 22, height: 22 });
    frame.strokeAlign = 'INSIDE';
    frame.effects = [{ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 3, visible: true }];
    expect(frame.absoluteRenderBounds).toEqual({ x: 7, y: -3, width: 26, height: 26 });
    frame.effects = [];
    const child = figma.createRectangle();
    frame.appendChild(child);
    child.x = 15;
    expect(frame.absoluteRenderBounds).toEqual({ x: 10, y: 0, width: 20, height: 20 });
    frame.clipsContent = false;
    // The 100 × 100 child sits at x = 10 + 15 on the page.
    expect(frame.absoluteRenderBounds).toEqual({ x: 10, y: 0, width: 115, height: 100 });
    frame.visible = false;
    expect(frame.absoluteRenderBounds).toBeNull();
  });
});
