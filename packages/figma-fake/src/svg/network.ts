import { figmaError } from '../errors';
import { deepFreeze } from '../values';
import { type Point, parsePath, type Segment, serializePath } from './path';

/**
 * Vector networks (`VectorNetwork`, typings:5400-5440; `VectorLikeMixin`, typings:9170-9189):
 * vertices, segments with tangents relative to their end vertices, and regions made of closed
 * loops. The fake keeps `vectorPaths` as the source of truth and converts in both directions.
 */

function same(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

/** The network of a set of paths: one region per filled path, one loop per closed subpath. */
export function networkFromPaths(paths: VectorPaths): VectorNetwork {
  const vertices: VectorVertex[] = [];
  const segments: VectorSegment[] = [];
  const regions: VectorRegion[] = [];
  const vertex = (p: Point) => {
    vertices.push({ x: p[0], y: p[1] });
    return vertices.length - 1;
  };
  for (const path of paths) {
    const loops: number[][] = [];
    let start = -1;
    let current = -1;
    let open: number[] = [];
    const point = (index: number): Point => [vertices[index]?.x ?? 0, vertices[index]?.y ?? 0];
    for (const s of parsePath(path.data)) {
      if (s.cmd === 'M') {
        start = vertex(s.p);
        current = start;
        open = [];
        continue;
      }
      if (current < 0) continue;
      if (s.cmd === 'Z') {
        const last = segments[segments.length - 1];
        // A subpath that already ends on its start point closes there.
        if (
          last &&
          open.length > 0 &&
          last.end === current &&
          same(point(current), point(start)) &&
          current !== start
        ) {
          segments[segments.length - 1] = { ...last, end: start };
          vertices.pop();
        } else if (current !== start) {
          segments.push({ start: current, end: start });
          open.push(segments.length - 1);
        }
        if (open.length > 0) loops.push(open);
        current = start;
        open = [];
        continue;
      }
      const from = point(current);
      const end = vertex(s.p);
      if (s.cmd === 'L') segments.push({ start: current, end });
      else {
        const [c1, c2]: [Point, Point] =
          s.cmd === 'C'
            ? [s.c1, s.c2]
            : [
                [from[0] + (2 / 3) * (s.c[0] - from[0]), from[1] + (2 / 3) * (s.c[1] - from[1])],
                [s.p[0] + (2 / 3) * (s.c[0] - s.p[0]), s.p[1] + (2 / 3) * (s.c[1] - s.p[1])],
              ];
        segments.push({
          start: current,
          end,
          tangentStart: { x: c1[0] - from[0], y: c1[1] - from[1] },
          tangentEnd: { x: c2[0] - s.p[0], y: c2[1] - s.p[1] },
        });
      }
      open.push(segments.length - 1);
      current = end;
    }
    if (path.windingRule !== 'NONE' && loops.length > 0) regions.push({ windingRule: path.windingRule, loops });
  }
  return deepFreeze({ vertices, segments, regions });
}

function checkPoint(api: string, value: unknown, what: string): Point {
  if (typeof value !== 'object' || value === null) throw figmaError(api, `Expected ${what} to be an object`);
  const x: unknown = Reflect.get(value, 'x');
  const y: unknown = Reflect.get(value, 'y');
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw figmaError(api, `Expected ${what} to have numeric x and y`);
  }
  return [x, y];
}

/** Segments as path commands, walking `indices` in order and flipping segments that run backwards. */
function chain(network: VectorNetwork, indices: readonly number[], close: boolean, api: string): Segment[] {
  const out: Segment[] = [];
  const vertexAt = (index: number): Point => checkPoint(api, network.vertices[index], `vertex ${index}`);
  let pen: number | null = null;
  for (const index of indices) {
    const segment = network.segments[index];
    if (!segment) throw figmaError(api, `Segment ${index} does not exist`);
    let { start, end } = segment;
    let [t0, t1] = [segment.tangentStart, segment.tangentEnd];
    if (pen !== null && start !== pen && end === pen) {
      [start, end] = [end, start];
      [t0, t1] = [t1, t0];
    }
    if (pen === null || start !== pen) out.push({ cmd: 'M', p: vertexAt(start) });
    const [a, b] = [vertexAt(start), vertexAt(end)];
    const curved = (t0 && (t0.x !== 0 || t0.y !== 0)) || (t1 && (t1.x !== 0 || t1.y !== 0));
    if (curved) {
      out.push({
        cmd: 'C',
        c1: [a[0] + (t0?.x ?? 0), a[1] + (t0?.y ?? 0)],
        c2: [b[0] + (t1?.x ?? 0), b[1] + (t1?.y ?? 0)],
        p: b,
      });
    } else out.push({ cmd: 'L', p: b });
    pen = end;
  }
  if (close && out.length > 0) out.push({ cmd: 'Z' });
  return out;
}

/** Paths of a network: one per region (its loops closed), plus one unfilled path for loose segments. */
export function pathsFromNetwork(api: string, network: VectorNetwork): VectorPaths {
  if (typeof network !== 'object' || network === null) throw figmaError(api, 'Expected a vector network');
  if (!Array.isArray(network.vertices) || !Array.isArray(network.segments)) {
    throw figmaError(api, 'A vector network needs "vertices" and "segments" arrays');
  }
  for (const [i, v] of network.vertices.entries()) checkPoint(api, v, `vertex ${i}`);
  for (const [i, s] of network.segments.entries()) {
    if (
      !Number.isInteger(s?.start) ||
      !Number.isInteger(s.end) ||
      !network.vertices[s.start] ||
      !network.vertices[s.end]
    ) {
      throw figmaError(api, `Segment ${i} refers to a vertex that does not exist`);
    }
  }
  const used = new Set<number>();
  const paths: VectorPath[] = [];
  for (const region of network.regions ?? []) {
    const segments = region.loops.flatMap((loop) => {
      for (const index of loop) used.add(index);
      return chain(network, loop, true, api);
    });
    paths.push({ windingRule: region.windingRule, data: serializePath(segments) });
  }
  const loose = network.segments.map((_, i) => i).filter((i) => !used.has(i));
  if (loose.length > 0) paths.push({ windingRule: 'NONE', data: serializePath(chain(network, loose, false, api)) });
  return deepFreeze(paths);
}
