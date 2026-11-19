import { figmaError, unsupported } from './errors';

/** One `<path>` of an imported SVG. */
export interface SvgPath {
  readonly data: string;
  readonly windingRule: WindingRule;
  readonly fill: RGB | null;
}

export interface ParsedSvg {
  readonly width: number;
  readonly height: number;
  readonly paths: readonly SvgPath[];
}

/** Elements that carry no geometry: skipped. Every other drawing element is B-54. */
const IGNORED = new Set(['svg', 'g', 'title', 'desc', 'defs', 'metadata']);

function attributes(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of source.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const [, name, , double, single] = match;
    if (name) out.set(name, double ?? single ?? '');
  }
  return out;
}

function length(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^\s*([0-9]*\.?[0-9]+)(px)?\s*$/.exec(value);
  return match?.[1] ? Number(match[1]) : null;
}

function hexColor(value: string | undefined): RGB | null | undefined {
  if (value === undefined) return undefined;
  if (value === 'none') return null;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  const parts = short ? short.slice(1).map((c) => c + c) : long?.slice(1);
  if (!parts) return unsupported(`createNodeFromSvg fill "${value}"`);
  const [r, g, b] = parts.map((p) => Number.parseInt(p, 16) / 255);
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
}

/**
 * A deliberately small SVG reader for B-06: the root size (`width`/`height`, else `viewBox`)
 * and `<path>` elements with solid hex fills. Figma's importer handles all of SVG
 * (typings:1731-1734); shapes, groups with transforms, strokes and gradients arrive with
 * B-54 and throw `NotImplementedError` here instead of being dropped.
 */
export function parseSvg(svg: string): ParsedSvg {
  const api = 'createNodeFromSvg';
  if (typeof svg !== 'string') throw figmaError(api, 'Expected an SVG string');
  const body = svg.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const root = /^\s*(?:<!DOCTYPE[^>]*>\s*)?<svg\b([^>]*)>/i.exec(body);
  if (!root) throw figmaError(api, 'Failed to import vector: the string is not an SVG document');
  if (!/<\/svg>\s*$/i.test(body) && !/\/>\s*$/.test(root[0])) {
    throw figmaError(api, 'Failed to import vector: the SVG is not well formed');
  }
  const rootAttrs = attributes(root[1] ?? '');
  const viewBox = rootAttrs
    .get('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = length(rootAttrs.get('width')) ?? viewBox?.[2] ?? 100;
  const height = length(rootAttrs.get('height')) ?? viewBox?.[3] ?? 100;
  const paths: SvgPath[] = [];
  for (const element of body.matchAll(/<([A-Za-z][-A-Za-z0-9]*)\b([^>]*)>/g)) {
    const [, tag = '', attrSource = ''] = element;
    if (IGNORED.has(tag)) continue;
    if (tag !== 'path') unsupported(`createNodeFromSvg <${tag}>`);
    const attrs = attributes(attrSource);
    const data = attrs.get('d');
    if (!data) continue;
    const fill = hexColor(attrs.get('fill'));
    paths.push({
      data,
      windingRule: attrs.get('fill-rule') === 'evenodd' ? 'EVENODD' : 'NONZERO',
      fill: fill === undefined ? { r: 0, g: 0, b: 0 } : fill,
    });
  }
  return { width: Math.max(width, 0.01), height: Math.max(height, 0.01), paths };
}
