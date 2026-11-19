import { figmaError } from '../errors';

/**
 * SVG path geometry for `createNodeFromSvg` and vector networks: parsing (SVG 1.1 §8.3 path
 * data, https://www.w3.org/TR/SVG11/paths.html#PathData), conversion to absolute
 * move/line/cubic/quadratic/close commands (arcs become cubics, F.6), affine transforms, exact
 * bounds and serialisation in Figma's `vectorPaths` form (`M 0 100 L 100 100 L 50 0 Z`,
 * typings:9062-9070).
 */

export type Point = readonly [number, number];

export type Segment =
  | { readonly cmd: 'M'; readonly p: Point }
  | { readonly cmd: 'L'; readonly p: Point }
  | { readonly cmd: 'Q'; readonly c: Point; readonly p: Point }
  | { readonly cmd: 'C'; readonly c1: Point; readonly c2: Point; readonly p: Point }
  | { readonly cmd: 'Z' };

/** A 2×3 affine matrix `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f (SVG order). */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [g, h, i, j, k, l] = n;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

export function apply(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/** Splits path data into commands and their numbers; arc flags may be written without separators. */
function tokenize(data: string): Array<{ cmd: string; args: number[] }> {
  const api = 'createNodeFromSvg';
  const out: Array<{ cmd: string; args: number[] }> = [];
  let rest = data.trim();
  let current: { cmd: string; args: number[] } | null = null;
  while (rest.length > 0) {
    rest = rest.replace(/^[\s,]+/, '');
    if (rest.length === 0) break;
    const ch = rest[0] ?? '';
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      current = { cmd: ch, args: [] };
      out.push(current);
      rest = rest.slice(1);
      continue;
    }
    if (!current) throw figmaError(api, `Failed to import vector: path data must start with a command ("${data}")`);
    // Arc flags (4th and 5th argument of each arc) are single digits.
    const isFlag = (current.cmd === 'A' || current.cmd === 'a') && [3, 4].includes(current.args.length % 7);
    const match = isFlag ? /^[01]/.exec(rest) : NUMBER.exec(rest);
    if (!match) throw figmaError(api, `Failed to import vector: invalid path data near "${rest.slice(0, 12)}"`);
    current.args.push(Number(match[0]));
    rest = rest.slice(match[0].length);
  }
  return out;
}

const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Converts one SVG arc to cubic segments (SVG 1.1 F.6.5 and F.6.6). */
function arcToCubics(from: Point, args: readonly number[], to: Point): Segment[] {
  let [rx, ry] = [Math.abs(args[0] ?? 0), Math.abs(args[1] ?? 0)];
  const phi = ((args[2] ?? 0) * Math.PI) / 180;
  const [large, sweep] = [args[3] === 1, args[4] === 1];
  if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) return [{ cmd: 'L', p: to }];
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) [rx, ry] = [rx * Math.sqrt(lambda), ry * Math.sqrt(lambda)];
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = sign * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const parts = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const step = delta / parts;
  const t = (4 / 3) * Math.tan(step / 4);
  const point = (a: number): Point => [
    cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin,
    cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos,
  ];
  const derivative = (a: number): Point => [
    -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin,
    -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos,
  ];
  const out: Segment[] = [];
  for (let i = 0; i < parts; i++) {
    const a0 = theta + i * step;
    const a1 = a0 + step;
    const [p0, p1] = [point(a0), i === parts - 1 ? to : point(a1)];
    const [d0, d1] = [derivative(a0), derivative(a1)];
    out.push({
      cmd: 'C',
      c1: [p0[0] + t * d0[0], p0[1] + t * d0[1]],
      c2: [p1[0] - t * d1[0], p1[1] - t * d1[1]],
      p: p1,
    });
  }
  return out;
}

/** Parses path data into absolute M/L/Q/C/Z segments. */
export function parsePath(data: string): Segment[] {
  const out: Segment[] = [];
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  let lastControl: Point | null = null;
  let lastCmd = '';
  for (const { cmd, args } of tokenize(data)) {
    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;
    const arity = ARITY[upper] ?? 0;
    if (arity === 0) {
      if (args.length > 0) throw figmaError('createNodeFromSvg', 'Failed to import vector: Z takes no arguments');
      out.push({ cmd: 'Z' });
      pen = start;
      lastCmd = 'Z';
      lastControl = null;
      continue;
    }
    if (args.length === 0 || args.length % arity !== 0) {
      throw figmaError('createNodeFromSvg', `Failed to import vector: "${cmd}" needs ${arity} numbers per segment`);
    }
    for (let i = 0; i < args.length; i += arity) {
      const a = args.slice(i, i + arity);
      const abs = (x: number, y: number): Point => (relative ? [pen[0] + x, pen[1] + y] : [x, y]);
      const n = (k: number) => a[k] ?? 0;
      // A moveto followed by more pairs continues as lineto (SVG 1.1 §8.3.2).
      const kind = upper === 'M' && i > 0 ? 'L' : upper;
      let control: Point | null = null;
      switch (kind) {
        case 'M':
          pen = abs(n(0), n(1));
          start = pen;
          out.push({ cmd: 'M', p: pen });
          break;
        case 'L':
          pen = abs(n(0), n(1));
          out.push({ cmd: 'L', p: pen });
          break;
        case 'H':
          pen = [relative ? pen[0] + n(0) : n(0), pen[1]];
          out.push({ cmd: 'L', p: pen });
          break;
        case 'V':
          pen = [pen[0], relative ? pen[1] + n(0) : n(0)];
          out.push({ cmd: 'L', p: pen });
          break;
        case 'C': {
          const c1 = abs(n(0), n(1));
          control = abs(n(2), n(3));
          pen = abs(n(4), n(5));
          out.push({ cmd: 'C', c1, c2: control, p: pen });
          break;
        }
        case 'S': {
          const c1: Point =
            lastControl && 'CS'.includes(lastCmd) ? [2 * pen[0] - lastControl[0], 2 * pen[1] - lastControl[1]] : pen;
          control = abs(n(0), n(1));
          pen = abs(n(2), n(3));
          out.push({ cmd: 'C', c1, c2: control, p: pen });
          break;
        }
        case 'Q':
          control = abs(n(0), n(1));
          pen = abs(n(2), n(3));
          out.push({ cmd: 'Q', c: control, p: pen });
          break;
        case 'T': {
          control =
            lastControl && 'QT'.includes(lastCmd) ? [2 * pen[0] - lastControl[0], 2 * pen[1] - lastControl[1]] : pen;
          pen = abs(n(0), n(1));
          out.push({ cmd: 'Q', c: control, p: pen });
          break;
        }
        case 'A': {
          const to = abs(n(5), n(6));
          out.push(...arcToCubics(pen, a, to));
          pen = to;
          break;
        }
      }
      lastControl = control;
      lastCmd = kind === 'M' ? 'M' : kind;
    }
  }
  return out;
}

export function transformSegments(segments: readonly Segment[], m: Matrix): Segment[] {
  return segments.map((s): Segment => {
    switch (s.cmd) {
      case 'Z':
        return s;
      case 'M':
      case 'L':
        return { cmd: s.cmd, p: apply(m, s.p) };
      case 'Q':
        return { cmd: 'Q', c: apply(m, s.c), p: apply(m, s.p) };
      default:
        return { cmd: 'C', c1: apply(m, s.c1), c2: apply(m, s.c2), p: apply(m, s.p) };
    }
  });
}

/** Parameters in (0, 1) where a quadratic or cubic Bézier coordinate has an extremum. */
function extrema(p0: number, p1: number, p2: number, p3?: number): number[] {
  if (p3 === undefined) {
    const den = p0 - 2 * p1 + p2;
    return den === 0 ? [] : [(p0 - p1) / den];
  }
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
}

function bezier(t: number, p: readonly number[]): number {
  const u = 1 - t;
  if (p.length === 3) return u * u * (p[0] ?? 0) + 2 * u * t * (p[1] ?? 0) + t * t * (p[2] ?? 0);
  return u * u * u * (p[0] ?? 0) + 3 * u * u * t * (p[1] ?? 0) + 3 * u * t * t * (p[2] ?? 0) + t * t * t * (p[3] ?? 0);
}

export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Exact bounds of the drawn segments (curve extrema included), or `null` when nothing is drawn. */
export function segmentBounds(segments: readonly Segment[]): Bounds | null {
  const xs: number[] = [];
  const ys: number[] = [];
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  let drawn = false;
  for (const s of segments) {
    if (s.cmd === 'M') {
      pen = s.p;
      start = s.p;
      continue;
    }
    if (s.cmd === 'Z') {
      pen = start;
      continue;
    }
    drawn = true;
    const curve = s.cmd === 'L' ? [pen, s.p] : s.cmd === 'Q' ? [pen, s.c, s.p] : [pen, s.c1, s.c2, s.p];
    for (const point of [pen, s.p]) {
      xs.push(point[0]);
      ys.push(point[1]);
    }
    if (curve.length > 2) {
      const px = curve.map((p) => p[0]);
      const py = curve.map((p) => p[1]);
      for (const t of extrema(px[0] ?? 0, px[1] ?? 0, px[2] ?? 0, px[3])) if (t > 0 && t < 1) xs.push(bezier(t, px));
      for (const t of extrema(py[0] ?? 0, py[1] ?? 0, py[2] ?? 0, py[3])) if (t > 0 && t < 1) ys.push(bezier(t, py));
    }
    pen = s.p;
  }
  if (!drawn) return null;
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** A number as Figma writes it in path data: at most 4 decimals, no `-0`. */
function num(value: number): string {
  const rounded = Math.round(value * 1e4) / 1e4;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** `M 0 0 L 10 0 C … Z`: absolute commands separated by spaces (typings:9062-9070). */
export function serializePath(segments: readonly Segment[]): string {
  return segments
    .map((s) => {
      switch (s.cmd) {
        case 'Z':
          return 'Z';
        case 'M':
        case 'L':
          return `${s.cmd} ${num(s.p[0])} ${num(s.p[1])}`;
        case 'Q':
          return `Q ${num(s.c[0])} ${num(s.c[1])} ${num(s.p[0])} ${num(s.p[1])}`;
        default:
          return `C ${num(s.c1[0])} ${num(s.c1[1])} ${num(s.c2[0])} ${num(s.c2[1])} ${num(s.p[0])} ${num(s.p[1])}`;
      }
    })
    .join(' ');
}
