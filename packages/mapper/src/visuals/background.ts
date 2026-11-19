import type { CBackgroundLayer, CComputed, MapperSettings, Rect, ScenePaint } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { solidPaint } from '../color';
import { isTransparent } from '../css';
import { insetRect, type SideLengths } from '../geometry';
import { cropTransform, resolveImageSize, resolvePosition } from './image-geometry';
import { reportUnsupported } from './unsupported';

/*
 * Backgrounds → fills (07 §10.1). Figma fills run bottom → top and CSS lists the topmost
 * layer first, so fills are `[background-color, ...layers.reverse()]`. A color clipped to
 * the padding or content box cannot be a fill of the border box: it goes to an inner
 * `…/bg` rectangle instead. Gradients are hardening (B-101) and stay unsupported.
 */

type ColorProfile = MapperSettings['mapper']['colorProfile'];

export interface Background {
  /** Fills of the element's own layer, bottom → top. */
  readonly fills: ScenePaint[];
  /** The color, when it is clipped to an inner box: that box (page space) and its paint. */
  readonly inner?: { readonly box: Rect; readonly paint: ScenePaint; readonly inset: SideLengths };
}

const sides = (values: readonly number[]): SideLengths => [
  values[0] ?? 0,
  values[1] ?? 0,
  values[2] ?? 0,
  values[3] ?? 0,
];

/** The inset of a CSS box keyword from the border box: `padding-box` drops the border, `content-box` the padding too. */
export function boxInset(computed: CComputed, keyword: string): SideLengths | undefined {
  const border = sides(computed.border.width);
  const padding = sides(computed.padding);
  switch (keyword) {
    case 'border-box':
      return [0, 0, 0, 0];
    case 'padding-box':
      return border;
    case 'content-box':
      return [border[0] + padding[0], border[1] + padding[1], border[2] + padding[2], border[3] + padding[3]];
    default:
      return undefined;
  }
}

/** Both axes repeat (`repeat`, `repeat repeat`); `undefined` for a mixed or spaced repeat. */
function repeats(value: string): boolean | undefined {
  const [x = 'repeat', y] = value.trim().split(/\s+/);
  const [rx, ry] =
    x === 'repeat-x' ? ['repeat', 'no-repeat'] : x === 'repeat-y' ? ['no-repeat', 'repeat'] : [x, y ?? x];
  if (rx === 'repeat' && ry === 'repeat') return true;
  if (rx === 'no-repeat' && ry === 'no-repeat') return false;
  return undefined;
}

/** One `url()` layer as an IMAGE paint (07 §10.1 table), or `undefined` when it has no Scene form. */
function imageLayer(
  layer: CBackgroundLayer,
  computed: CComputed,
  box: Rect,
  notes: Diagnostic[],
): ScenePaint | undefined {
  const { image } = layer;
  if (image.kind !== 'url') {
    reportUnsupported(notes, 'background-image', image.css);
    return undefined;
  }
  if (layer.attachment === 'fixed') reportUnsupported(notes, 'background-attachment', 'fixed', 'drawn as scroll');
  if (layer.clip !== 'border-box') reportUnsupported(notes, 'background-clip', layer.clip, 'clipped at the border box');
  const asset = image.asset;
  if (layer.size === 'cover') return { type: 'IMAGE', asset, scaleMode: 'FILL' };
  if (layer.size === 'contain') return { type: 'IMAGE', asset, scaleMode: 'FIT' };

  const origin = boxInset(computed, layer.origin) ?? [0, 0, 0, 0];
  const area = insetRect({ x: 0, y: 0, w: box.w, h: box.h }, origin);
  const size = resolveImageSize(layer.size, image.natural, area);
  const repeat = repeats(layer.repeat);
  const at = size && resolvePosition(layer.position, { w: area.w - size.w, h: area.h - size.h });
  if (size === undefined || at === undefined || size.w <= 0 || size.h <= 0) {
    reportUnsupported(notes, 'background-size', `${layer.size} / ${layer.position}`, 'drawn to cover the box');
    return { type: 'IMAGE', asset, scaleMode: 'FILL' };
  }
  if (repeat === true) {
    // Figma tiles from the box's top-left corner at one scale for both axes.
    if (Math.abs(at.x % size.w) > 1e-3 || Math.abs(at.y % size.h) > 1e-3 || area.x !== 0 || area.y !== 0) {
      reportUnsupported(notes, 'background-position', layer.position, 'tiles start at the top-left corner');
    }
    return { type: 'IMAGE', asset, scaleMode: 'TILE', scalingFactor: size.w / image.natural.w };
  }
  if (repeat === undefined) reportUnsupported(notes, 'background-repeat', layer.repeat, 'drawn once');
  const imageTransform = cropTransform({ x: area.x + at.x, y: area.y + at.y, w: size.w, h: size.h }, box);
  return { type: 'IMAGE', asset, scaleMode: 'CROP', imageTransform };
}

/** The element's background as fills and, when the color is clipped inside, an inner box. */
export function background(computed: CComputed, box: Rect, profile: ColorProfile, notes: Diagnostic[]): Background {
  const { color, layers, clip } = computed.background;
  const fills: ScenePaint[] = [];
  let inner: Background['inner'];
  if (!isTransparent(color)) {
    const paint = solidPaint(color, profile, notes, 'background-color');
    // The color is clipped by the bottom layer's `background-clip`.
    const colorClip = clip.at(-1) ?? 'border-box';
    const inset = boxInset(computed, colorClip);
    if (colorClip === 'border-box') fills.push(paint);
    else if (inset !== undefined) inner = { box: insetRect(box, inset), paint, inset };
    else reportUnsupported(notes, 'background-clip', colorClip);
  }
  for (const layer of [...layers].reverse()) {
    const paint = imageLayer(layer, computed, box, notes);
    if (paint) fills.push(paint);
  }
  return inner === undefined ? { fills } : { fills, inner };
}
