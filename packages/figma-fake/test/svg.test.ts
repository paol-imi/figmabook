import { describe, expect, it } from 'vitest';
import { createFakeFigma } from '../src';

function vectors(svg: string): VectorNode[] {
  const frame = createFakeFigma().createNodeFromSvg(svg);
  return frame.children.map((child) => {
    if (child.type !== 'VECTOR') throw new Error(`expected a vector, got ${child.type}`);
    return child;
  });
}

function only(svg: string): VectorNode {
  const list = vectors(svg);
  if (list.length !== 1 || !list[0]) throw new Error(`expected one vector, got ${list.length}`);
  return list[0];
}

const geometry = (v: VectorNode) => [v.x, v.y, v.width, v.height].map((n) => Math.round(n * 1000) / 1000);

describe('createNodeFromSvg: SVG → vectors (typings:1731-1734, 09 §6.3)', () => {
  it('places each vector at its path bounds, with path data relative to it', () => {
    const v = only('<svg width="24" height="24"><path d="M4 6 h10 v8 h-10 z"/></svg>');
    expect(geometry(v)).toEqual([4, 6, 10, 8]);
    expect(v.vectorPaths).toEqual([{ windingRule: 'NONZERO', data: 'M 0 0 L 10 0 L 10 8 L 0 8 Z' }]);
  });

  it('includes curve extrema in the bounds and turns arcs into cubics', () => {
    const curve = only('<svg width="10" height="10"><path d="M0 0 C 0 10 10 10 10 0"/></svg>');
    expect(geometry(curve)).toEqual([0, 0, 10, 7.5]);
    const arc = only('<svg width="10" height="10"><path d="M0 5 A5 5 0 0 1 10 5"/></svg>');
    expect(geometry(arc)).toEqual([0, 0, 10, 5]);
    expect(arc.vectorPaths[0]?.data).toMatch(/^M 0 5 C .* C .* 10 5$/);
  });

  it('reads rect, circle, ellipse, line, polyline and polygon', () => {
    const list = vectors(
      '<svg width="100" height="100"><rect x="1" y="2" width="10" height="5" rx="2"/><circle cx="50" cy="50" r="5"/><ellipse cx="20" cy="80" rx="4" ry="2"/><line x1="0" y1="0" x2="30" y2="40" stroke="#000"/><polyline points="0,0 10,10 20,0"/><polygon points="60,60 70,60 65,70"/></svg>',
    );
    expect(list.map(geometry)).toEqual([
      [1, 2, 10, 5],
      [45, 45, 10, 10],
      [16, 78, 8, 4],
      [0, 0, 30, 40],
      [0, 0, 20, 10],
      [60, 60, 10, 10],
    ]);
    // Lines and polylines have no area: no fill.
    expect(list[3]?.fills).toEqual([]);
    expect(list[4]?.fills).toEqual([]);
  });

  it('applies group transforms and inherited paint attributes, and the viewBox scale', () => {
    const v = only(
      '<svg width="48" height="48" viewBox="0 0 24 24"><g transform="translate(2 2)" fill="#00ff00" style="stroke: red; stroke-width: 1.5"><rect width="4" height="4"/></g></svg>',
    );
    expect(geometry(v)).toEqual([4, 4, 8, 8]);
    expect(v.fills).toEqual([expect.objectContaining({ type: 'SOLID', color: { r: 0, g: 1, b: 0 } })]);
    expect(v.strokes).toEqual([expect.objectContaining({ color: { r: 1, g: 0, b: 0 } })]);
    expect(v.strokeWeight).toBe(3);
    expect(v.strokeAlign).toBe('CENTER');
  });

  it('centres a viewBox that does not match the aspect ratio (xMidYMid meet)', () => {
    const v = only('<svg width="40" height="20" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    expect(geometry(v)).toEqual([10, 0, 20, 20]);
  });

  it('reads colours, opacity, stroke caps and joins; skips hidden shapes', () => {
    const list = vectors(
      '<svg width="10" height="10"><path d="M0 0H5V5Z" fill="rgba(255, 0, 0, 0.5)" opacity="0.4" fill-rule="evenodd"/><path d="M0 0H5" fill="none" stroke="#00f8" stroke-linecap="round" stroke-linejoin="bevel"/><path d="M0 0H1V1Z" display="none"/></svg>',
    );
    expect(list).toHaveLength(2);
    const [solid, stroke] = list as [VectorNode, VectorNode];
    expect(solid.fills).toEqual([expect.objectContaining({ color: { r: 1, g: 0, b: 0 }, opacity: 0.5 })]);
    expect([solid.opacity, solid.vectorPaths[0]?.windingRule]).toEqual([0.4, 'EVENODD']);
    expect(stroke.fills).toEqual([]);
    expect([stroke.strokeCap, stroke.strokeJoin]).toEqual(['ROUND', 'BEVEL']);
    expect((stroke.strokes[0] as SolidPaint).opacity).toBeCloseTo(0x88 / 255);
  });

  it('reads linear and radial gradients from defs', () => {
    const [linear, radial] = vectors(
      '<svg width="10" height="10"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="100%" stop-color="#000" stop-opacity="0.5"/></linearGradient><radialGradient id="b"><stop offset="0.5" stop-color="red"/></radialGradient></defs><rect width="10" height="10" fill="url(#a)"/><rect width="10" height="10" fill="url(#b)"/></svg>',
    ) as [VectorNode, VectorNode];
    expect((linear.fills as Paint[])[0]).toMatchObject({
      type: 'GRADIENT_LINEAR',
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0.5],
      ],
      gradientStops: [
        { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 0, a: 0.5 } },
      ],
    });
    expect((radial.fills as Paint[])[0]).toMatchObject({ type: 'GRADIENT_RADIAL', gradientStops: [{ position: 0.5 }] });
  });

  it('rejects malformed path data and unknown paint servers', () => {
    const figma = createFakeFigma();
    expect(() => figma.createNodeFromSvg('<svg width="1" height="1"><path d="M0 0 L"/></svg>')).toThrow(
      /Failed to import/,
    );
    expect(() => figma.createNodeFromSvg('<svg width="1" height="1"><path d="0 0"/></svg>')).toThrow(/command/);
    expect(() =>
      figma.createNodeFromSvg('<svg width="1" height="1"><path d="M0 0H1V1Z" fill="url(#x)"/></svg>'),
    ).toThrow(/paint server/);
  });

  it('records one createNodeFromSvg op, after the layers exist', () => {
    const figma = createFakeFigma();
    const frame = figma.createNodeFromSvg('<svg width="2" height="2"><path d="M0 0H2V2Z"/></svg>');
    expect(figma.ops()).toEqual([{ method: 'createNodeFromSvg', nodeId: frame.id, property: null, value: null }]);
  });
});

describe('vector networks (typings:9170-9189, 5400-5440)', () => {
  it('derives vertices, segments with tangents, and regions from the paths', () => {
    const vector = createFakeFigma().createVector();
    vector.vectorPaths = [{ windingRule: 'EVENODD', data: 'M 0 0 L 10 0 C 10 5 5 10 0 10 Z' }];
    expect(vector.vectorNetwork).toEqual({
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      segments: [
        { start: 0, end: 1 },
        { start: 1, end: 2, tangentStart: { x: 0, y: 5 }, tangentEnd: { x: 5, y: 0 } },
        { start: 2, end: 0 },
      ],
      regions: [{ windingRule: 'EVENODD', loops: [[0, 1, 2]] }],
    });
  });

  it('setVectorNetworkAsync stores a network as paths that read back the same network', async () => {
    const figma = createFakeFigma();
    const vector = figma.createVector();
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 8 },
        { x: 20, y: 20 },
      ],
      segments: [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
        { start: 2, end: 0 },
        { start: 2, end: 3 },
      ],
      regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2]] }],
    };
    await vector.setVectorNetworkAsync(network);
    expect(vector.vectorPaths).toEqual([
      { windingRule: 'NONZERO', data: 'M 0 0 L 8 0 L 8 8 L 0 0 Z' },
      { windingRule: 'NONE', data: 'M 8 8 L 20 20' },
    ]);
    expect(figma.ops().at(-1)).toMatchObject({ method: 'setVectorNetworkAsync', nodeId: vector.id });
    await expect(
      vector.setVectorNetworkAsync({ vertices: [{ x: 0, y: 0 }], segments: [{ start: 0, end: 4 }] }),
    ).rejects.toThrow(/does not exist/);
  });
});
