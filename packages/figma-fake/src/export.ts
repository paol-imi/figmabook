import { crc32, deflateSync } from 'node:zlib';
import { boundingBox, renderBounds } from './bounds';
import { figmaError, unsupported } from './errors';
import { checkLoaded } from './nodes/children';
import type { NodeState } from './state';

/**
 * `exportAsync` (typings:9044-9132) as a deterministic placeholder (BUILD §8.1 "Export":
 * `exportAsync({ format: 'PNG', constraint })` → deterministic placeholder PNG; 09 §14).
 *
 * The fake does not render. A PNG export is a valid, fully transparent RGBA PNG with the pixel
 * size Figma would produce: the node's bounds (render bounds, or the bounding box with
 * `useAbsoluteBounds`) times the constraint. SVG exports are an empty `<svg>` of the same size.
 * JPG, PDF, JSON_REST_V1 and the video formats are hardening.
 */

type AnySettings =
  | ExportSettings
  | ExportSettingsSVGString
  | ExportSettingsREST
  | ExportSettingsMP4
  | ExportSettingsGIF
  | ExportSettingsWEBM;

/** The export format that returns a string (typings:5178-5221). */
const SVG_STRING = 'SVG_STRING'; // diag-check-ignore: a Figma export format, not a diagnostic

/** Largest side of a placeholder, in pixels, so a huge scale cannot exhaust memory in tests. */
const MAX_EXPORT_SIDE = 16_384;

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(new TextEncoder().encode(type), 0);
  typeAndData.set(data, 4);
  out.set(typeAndData, 4);
  view.setUint32(8 + data.length, crc32(typeAndData));
  return out;
}

/** A transparent RGBA PNG of `width` × `height` pixels. */
export function placeholderPng(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, deflate, adaptive filter, no interlace
  // Each row: filter byte 0 and transparent pixels.
  const raw = new Uint8Array(height * (1 + width * 4));
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Pixel size of an export of a `width` × `height` box (`ExportSettingsConstraints`, typings:5123-5129). */
function pixelSize(width: number, height: number, constraint: ExportSettingsConstraints | undefined): [number, number] {
  let scale = 1;
  if (constraint?.type === 'SCALE') scale = constraint.value;
  else if (constraint?.type === 'WIDTH') scale = width > 0 ? constraint.value / width : 1;
  else if (constraint?.type === 'HEIGHT') scale = height > 0 ? constraint.value / height : 1;
  if (!Number.isFinite(scale) || scale <= 0) throw figmaError('exportAsync', 'Invalid export constraint');
  const side = (length: number) => Math.min(MAX_EXPORT_SIDE, Math.max(1, Math.round(length * scale)));
  return [side(width), side(height)];
}

/** The box an export covers: render bounds by default, the bounding box with `useAbsoluteBounds`. */
function exportBox(state: NodeState, useAbsoluteBounds: boolean): { width: number; height: number } {
  if (state.type === 'PAGE') {
    const boxes = state.children.map(boundingBox);
    if (boxes.length === 0) return { width: 0, height: 0 };
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    return {
      width: Math.max(...boxes.map((b) => b.x + b.width)) - x0,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y0,
    };
  }
  const box = useAbsoluteBounds ? boundingBox(state) : (renderBounds(state) ?? boundingBox(state));
  return { width: box.width, height: box.height };
}

export function exportNode(state: NodeState, settings: AnySettings | undefined): Uint8Array | string | object {
  // A page must be loaded first under dynamic-page (typings:9047).
  checkLoaded('exportAsync', state);
  const format = settings?.format ?? 'PNG';
  const absolute = settings !== undefined && 'useAbsoluteBounds' in settings && settings.useAbsoluteBounds === true;
  const box = exportBox(state, absolute);
  const constraint = settings && 'constraint' in settings ? settings.constraint : undefined;
  switch (format) {
    case 'PNG': {
      const [width, height] = pixelSize(box.width, box.height, constraint);
      return placeholderPng(width, height);
    }
    case 'SVG':
    case SVG_STRING: {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}" data-figma-fake-node="${state.id}"/>`;
      return format === 'SVG' ? new TextEncoder().encode(svg) : svg;
    }
    default:
      return unsupported(`exportAsync({ format: '${format}' })`, 'hardening');
  }
}
