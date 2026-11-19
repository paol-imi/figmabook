import { figmaError, unsupported } from '../errors';
import { parseColor, type Rgba } from './color';
import {
  type Bounds,
  IDENTITY,
  type Matrix,
  multiply,
  parsePath,
  type Segment,
  segmentBounds,
  transformSegments,
} from './path';

/**
 * The SVG reader behind `createNodeFromSvg` (typings:1731-1734; 09 §6.3). It covers what inline
 * icons and illustrations use: `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`,
 * `polygon`; `g` with transforms and inherited presentation attributes (also from `style`);
 * solid colours and linear/radial gradients from `defs`; `viewBox` scaling. Groups are
 * flattened into their shapes (README "Differences"). Text, images, `use`, masks, clip paths,
 * filters, patterns and CSS `<style>` sheets throw `NotImplementedError` (hardening) rather than
 * being dropped.
 */

const API = 'createNodeFromSvg';

/** Elements without geometry or that only hold definitions. */
const SKIPPED = new Set(['title', 'desc', 'metadata', 'defs', 'linearGradient', 'radialGradient', 'stop']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
/** Presentation attributes children inherit (SVG 1.1 §6.4). */
const INHERITED = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'display',
  'visibility',
] as const;

export interface SvgShape {
  readonly name: string;
  /** Geometry in the coordinates of the imported frame. */
  readonly segments: readonly Segment[];
  readonly bounds: Bounds;
  readonly windingRule: WindingRule;
  readonly fills: readonly Paint[];
  readonly strokes: readonly Paint[];
  readonly strokeWeight: number;
  readonly strokeCap: StrokeCap;
  readonly strokeJoin: StrokeJoin;
  readonly opacity: number;
}

export interface ParsedSvg {
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly SvgShape[];
}

interface Tag {
  readonly name: string;
  readonly attrs: Map<string, string>;
  readonly kind: 'open' | 'close' | 'self';
}

function attributes(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of source.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const [, name, , double, single] = match;
    if (name) out.set(name, double ?? single ?? '');
  }
  // `style="fill: red; stroke-width: 2"` overrides presentation attributes (SVG 1.1 §6.4).
  for (const declaration of (out.get('style') ?? '').split(';')) {
    const at = declaration.indexOf(':');
    if (at > 0) out.set(declaration.slice(0, at).trim(), declaration.slice(at + 1).trim());
  }
  return out;
}

function tags(body: string): Tag[] {
  const out: Tag[] = [];
  for (const match of body.matchAll(/<(\/?)([A-Za-z][-A-Za-z0-9:]*)\b([^>]*?)(\/?)>/g)) {
    const [, close, name = '', attrs = '', self] = match;
    out.push({ name, attrs: attributes(attrs), kind: close ? 'close' : self ? 'self' : 'open' });
  }
  return out;
}

function numberAttr(attrs: ReadonlyMap<string, string>, name: string, fallback = 0): number {
  const value = attrs.get(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw figmaError(API, `Failed to import vector: invalid ${name}="${value}"`);
  return parsed;
}

function length(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^\s*([0-9]*\.?[0-9]+)(px)?\s*$/.exec(value);
  return match?.[1] ? Number(match[1]) : null;
}

/** `transform="translate(1 2) rotate(45)"` (SVG 1.1 §7.6). */
export function parseTransform(value: string | undefined): Matrix {
  let m: Matrix = IDENTITY;
  if (!value) return m;
  for (const [, fn = '', list = ''] of value.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const n = list
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = n;
    let next: Matrix;
    switch (fn) {
      case 'matrix':
        next = [a, b, c, d, e, f];
        break;
      case 'translate':
        next = [1, 0, 0, 1, a, n.length > 1 ? b : 0];
        break;
      case 'scale':
        next = [a, 0, 0, n.length > 1 ? b : a, 0, 0];
        break;
      case 'rotate': {
        const r = (a * Math.PI) / 180;
        const rot: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        next = n.length > 1 ? multiply(multiply([1, 0, 0, 1, b, c], rot), [1, 0, 0, 1, -b, -c]) : rot;
        break;
      }
      case 'skewX':
        next = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        next = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        throw figmaError(API, `Failed to import vector: unknown transform "${fn}"`);
    }
    m = multiply(m, next);
  }
  return m;
}

function points(attrs: ReadonlyMap<string, string>): Array<[number, number]> {
  const n = (attrs.get('points') ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i] ?? 0, n[i + 1] ?? 0]);
  return out;
}

/** The geometry of one shape element as path segments (SVG 1.1 §9). */
function shapeSegments(tag: Tag): Segment[] {
  const a = tag.attrs;
  const v = (name: string, fallback = 0) => numberAttr(a, name, fallback);
  switch (tag.name) {
    case 'path':
      return parsePath(a.get('d') ?? '');
    case 'rect': {
      const [x, y, w, h] = [v('x'), v('y'), v('width'), v('height')];
      if (w <= 0 || h <= 0) return [];
      let rx = a.has('rx') ? v('rx') : a.has('ry') ? v('ry') : 0;
      let ry = a.has('ry') ? v('ry') : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx === 0 || ry === 0) return parsePath(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
      return parsePath(
        `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
      );
    }
    case 'circle':
    case 'ellipse': {
      const [cx, cy] = [v('cx'), v('cy')];
      const rx = tag.name === 'circle' ? v('r') : v('rx');
      const ry = tag.name === 'circle' ? v('r') : v('ry');
      if (rx <= 0 || ry <= 0) return [];
      return parsePath(`M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`);
    }
    case 'line':
      return parsePath(`M${v('x1')} ${v('y1')}L${v('x2')} ${v('y2')}`);
    case 'polyline':
    case 'polygon': {
      const list = points(a);
      if (list.length < 2) return [];
      const d = list.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join('');
      return parsePath(tag.name === 'polygon' ? `${d}Z` : d);
    }
    default:
      return [];
  }
}

interface Gradient {
  readonly kind: 'linear' | 'radial';
  readonly attrs: Map<string, string>;
  readonly stops: Array<{ position: number; color: Rgba }>;
}

function offset(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number.parseFloat(value);
  return Math.min(1, Math.max(0, value.trim().endsWith('%') ? n / 100 : n));
}

/** A gradient coordinate in bounding-box units (`0.5`, `50%`). */
function unitValue(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseFloat(value);
  return value.trim().endsWith('%') ? n / 100 : n;
}

/** Collects `<linearGradient>` and `<radialGradient>` definitions by id. */
function gradients(list: readonly Tag[]): Map<string, Gradient> {
  const out = new Map<string, Gradient>();
  let current: Gradient | null = null;
  for (const tag of list) {
    if (tag.name === 'linearGradient' || tag.name === 'radialGradient') {
      if (tag.kind === 'close') {
        current = null;
        continue;
      }
      const gradient: Gradient = {
        kind: tag.name === 'linearGradient' ? 'linear' : 'radial',
        attrs: tag.attrs,
        stops: [],
      };
      const id = tag.attrs.get('id');
      if (id) out.set(id, gradient);
      current = tag.kind === 'open' ? gradient : null;
    } else if (tag.name === 'stop' && current && tag.kind !== 'close') {
      const color = parseColor(tag.attrs.get('stop-color') ?? 'black') ?? { r: 0, g: 0, b: 0, a: 0 };
      const alpha = color.a * offset(tag.attrs.get('stop-opacity') ?? '1');
      current.stops.push({ position: offset(tag.attrs.get('offset')), color: { ...color, a: alpha } });
    }
  }
  return out;
}

/**
 * A gradient paint for a shape with `bounds` (in frame coordinates, `elementMatrix` maps element
 * user space there). Figma's `gradientTransform` maps the layer's unit square to gradient space,
 * where a linear gradient runs from (0, 0.5) to (1, 0.5) and a radial one is centred at
 * (0.5, 0.5) with radius 0.5 (https://developers.figma.com/docs/plugins/api/Paint/#gradientpaint).
 */
function gradientPaint(gradient: Gradient, bounds: Bounds, elementMatrix: Matrix, opacity: number): GradientPaint {
  const a = gradient.attrs;
  if (a.has('gradientTransform') || a.has('href') || a.has('xlink:href')) {
    return unsupported('createNodeFromSvg gradientTransform / href', 'hardening');
  }
  const user = a.get('gradientUnits') === 'userSpaceOnUse';
  // Gradient points in the layer's unit square.
  const toUnit = (x: number, y: number): [number, number] => {
    if (!user) return [x, y];
    const [m0, m1, m2, m3, m4, m5] = elementMatrix;
    const [fx, fy] = [m0 * x + m2 * y + m4, m1 * x + m3 * y + m5];
    return [(fx - bounds.x) / (bounds.width || 1), (fy - bounds.y) / (bounds.height || 1)];
  };
  const stops = gradient.stops.map((stop) => ({ position: stop.position, color: { ...stop.color } }));
  if (gradient.kind === 'linear') {
    // Defaults: x1 = y1 = y2 = 0 %, x2 = 100 % (SVG 1.1 §13.2.2).
    const [x1, y1] = toUnit(unitValue(a.get('x1'), 0), unitValue(a.get('y1'), 0));
    const [x2, y2] = toUnit(unitValue(a.get('x2'), 1), unitValue(a.get('y2'), 0));
    const [dx, dy] = [x2 - x1, y2 - y1];
    const l2 = dx * dx + dy * dy || 1;
    // `+ 0` turns -0 into 0, so equal gradients compare equal.
    return {
      type: 'GRADIENT_LINEAR',
      gradientTransform: [
        [dx / l2 + 0, dy / l2 + 0, -(x1 * dx + y1 * dy) / l2 + 0],
        [-dy / l2 + 0, dx / l2 + 0, (x1 * dy - y1 * dx) / l2 + 0.5],
      ],
      gradientStops: stops,
      opacity,
    };
  }
  const [cx, cy] = toUnit(unitValue(a.get('cx'), 0.5), unitValue(a.get('cy'), 0.5));
  const r = Math.max(unitValue(a.get('r'), 0.5), 1e-6) / (user ? bounds.width || 1 : 1);
  return {
    type: 'GRADIENT_RADIAL',
    gradientTransform: [
      [0.5 / r, 0, 0.5 - (0.5 * cx) / r],
      [0, 0.5 / r, 0.5 - (0.5 * cy) / r],
    ],
    gradientStops: stops,
    opacity,
  };
}

type Style = Map<string, string>;

function paintOf(
  value: string | undefined,
  opacity: number,
  defs: ReadonlyMap<string, Gradient>,
  bounds: Bounds,
  matrix: Matrix,
): Paint[] {
  if (value === undefined || value.trim() === 'none') return [];
  const ref = /^url\(\s*#([^)\s]+)\s*\)/.exec(value.trim())?.[1];
  if (ref) {
    const gradient = defs.get(ref);
    if (!gradient) return unsupported(`createNodeFromSvg paint server "${value}"`, 'hardening');
    return [gradientPaint(gradient, bounds, matrix, opacity)];
  }
  const color = parseColor(value);
  if (!color) return [];
  return [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a * opacity }];
}

const CAPS: Readonly<Record<string, StrokeCap>> = { butt: 'NONE', round: 'ROUND', square: 'SQUARE' };
const JOINS: Readonly<Record<string, StrokeJoin>> = { miter: 'MITER', round: 'ROUND', bevel: 'BEVEL' };

/** Elements whose content Figma imports but the fake does not model yet. */
const HARDENING = new Set([
  'text',
  'tspan',
  'textPath',
  'image',
  'use',
  'symbol',
  'foreignObject',
  'pattern',
  'filter',
  'style',
  'switch',
  'a',
  'marker',
]);

/** Parses an SVG document into shapes in the coordinates of the frame `createNodeFromSvg` returns. */
export function parseSvg(svg: string): ParsedSvg {
  if (typeof svg !== 'string') throw figmaError(API, 'Expected an SVG string');
  const body = svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const root = /^\s*(?:<!DOCTYPE[^>]*>\s*)?<svg\b([^>]*)>/i.exec(body);
  if (!root) throw figmaError(API, 'Failed to import vector: the string is not an SVG document');
  if (!/<\/svg>\s*$/i.test(body) && !/\/>\s*$/.test(root[0])) {
    throw figmaError(API, 'Failed to import vector: the SVG is not well formed');
  }
  const list = tags(body);
  const rootAttrs = list[0]?.attrs ?? new Map<string, string>();
  const viewBox = rootAttrs
    .get('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const [vx = 0, vy = 0, vw, vh] = viewBox ?? [];
  const width = Math.max(length(rootAttrs.get('width')) ?? vw ?? 100, 0.01);
  const height = Math.max(length(rootAttrs.get('height')) ?? vh ?? 100, 0.01);
  // viewBox → viewport (SVG 1.1 §7.7–7.8), `xMidYMid meet` unless `none`.
  let viewport: Matrix = IDENTITY;
  if (vw !== undefined && vh !== undefined && vw > 0 && vh > 0) {
    if (rootAttrs.get('preserveAspectRatio')?.trim() === 'none')
      viewport = [width / vw, 0, 0, height / vh, -vx * (width / vw), -vy * (height / vh)];
    else {
      const s = Math.min(width / vw, height / vh);
      viewport = [s, 0, 0, s, (width - vw * s) / 2 - vx * s, (height - vh * s) / 2 - vy * s];
    }
  }
  const defs = gradients(list);
  const shapes: SvgShape[] = [];
  // Stack of open containers: their matrix, inherited style and opacity.
  const stack: Array<{ name: string; matrix: Matrix; style: Style; opacity: number; hidden: boolean }> = [
    { name: 'svg', matrix: viewport, style: new Map(), opacity: 1, hidden: false },
  ];
  let defsDepth = 0;
  for (const tag of list.slice(1)) {
    if (tag.kind === 'close') {
      if (tag.name === 'defs' || tag.name === 'clipPath' || tag.name === 'mask') defsDepth = Math.max(0, defsDepth - 1);
      else if (tag.name === 'g' || tag.name === 'svg') stack.pop();
      continue;
    }
    if (tag.name === 'defs' || tag.name === 'clipPath' || tag.name === 'mask') {
      if (tag.kind === 'open') defsDepth += 1;
      continue;
    }
    if (defsDepth > 0 || SKIPPED.has(tag.name)) continue;
    if (HARDENING.has(tag.name)) unsupported(`createNodeFromSvg <${tag.name}>`, 'hardening');
    for (const attr of ['clip-path', 'mask', 'filter']) {
      const value = tag.attrs.get(attr);
      if (value && value !== 'none') unsupported(`createNodeFromSvg ${attr}`, 'hardening');
    }
    const parent = stack[stack.length - 1] ?? {
      name: 'svg',
      matrix: viewport,
      style: new Map(),
      opacity: 1,
      hidden: false,
    };
    const style: Style = new Map(parent.style);
    for (const key of INHERITED) {
      const value = tag.attrs.get(key);
      if (value !== undefined && value !== 'inherit') style.set(key, value);
    }
    const matrix = multiply(parent.matrix, parseTransform(tag.attrs.get('transform')));
    const opacity = parent.opacity * numberAttr(tag.attrs, 'opacity', 1);
    const hidden = parent.hidden || style.get('display') === 'none' || style.get('visibility') === 'hidden';
    if (tag.name === 'g' || tag.name === 'svg') {
      if (tag.kind === 'open') stack.push({ name: tag.name, matrix, style, opacity, hidden });
      continue;
    }
    if (!SHAPES.has(tag.name)) unsupported(`createNodeFromSvg <${tag.name}>`, 'hardening');
    if (hidden) continue;
    const segments = transformSegments(shapeSegments(tag), matrix);
    const bounds = segmentBounds(segments);
    if (!bounds) continue;
    const isLine = tag.name === 'line' || tag.name === 'polyline';
    const scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
    const fillOpacity = Number.parseFloat(style.get('fill-opacity') ?? '1');
    const strokeOpacity = Number.parseFloat(style.get('stroke-opacity') ?? '1');
    shapes.push({
      name: tag.attrs.get('id') ?? 'Vector',
      segments,
      bounds,
      windingRule: style.get('fill-rule') === 'evenodd' ? 'EVENODD' : 'NONZERO',
      // The SVG default fill is black; lines and polylines have no area to fill.
      fills: isLine ? [] : paintOf(style.get('fill') ?? 'black', fillOpacity, defs, bounds, matrix),
      strokes: paintOf(style.get('stroke'), strokeOpacity, defs, bounds, matrix),
      strokeWeight: Number.parseFloat(style.get('stroke-width') ?? '1') * scale,
      strokeCap: CAPS[style.get('stroke-linecap') ?? 'butt'] ?? 'NONE',
      strokeJoin: JOINS[style.get('stroke-linejoin') ?? 'miter'] ?? 'MITER',
      opacity,
    });
  }
  return { width, height, shapes };
}
