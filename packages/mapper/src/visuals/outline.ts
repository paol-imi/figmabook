import type { CComputed, MapperSettings, Rect, SceneNode, SceneStroke } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { solidPaint } from '../color';
import { outlineVisible } from '../css';
import { inflateRect, px } from '../geometry';
import { lineStyle } from './stroke';

/*
 * `outline` (07 §10.3). Without a border and with `outline-offset: 0` it is the element's
 * OUTSIDE stroke. Otherwise it is an absolute frame without fill (`…/outline`), inflated by
 * `offset + width`, with an INSIDE stroke and the radius grown to match.
 */

type ColorProfile = MapperSettings['mapper']['colorProfile'];
type SceneRadius = NonNullable<SceneNode['radius']>;

export type OutlineVisual =
  | { readonly kind: 'stroke'; readonly stroke: SceneStroke }
  | { readonly kind: 'frame'; readonly box: Rect; readonly stroke: SceneStroke; readonly radius?: SceneRadius };

/** How an element's outline is drawn, or `undefined` when it draws nothing. */
export function outlineVisual(
  computed: CComputed,
  box: Rect,
  radius: SceneRadius | undefined,
  stroked: boolean,
  profile: ColorProfile,
  notes: Diagnostic[],
): OutlineVisual | undefined {
  const { outline } = computed;
  if (outline === undefined || !outlineVisible(computed)) return undefined;
  const { width, offset } = outline;
  const stroke = (align: SceneStroke['align']): SceneStroke => ({
    paints: [solidPaint(outline.color, profile, notes, 'outline-color')],
    align,
    weight: { t: width, r: width, b: width, l: width },
    ...lineStyle(outline.style, width, 'outline-style', notes),
  });
  if (!stroked && offset === 0) return { kind: 'stroke', stroke: stroke('OUTSIDE') };
  const grow = offset + width;
  const frame = { kind: 'frame' as const, box: inflateRect(box, grow), stroke: stroke('INSIDE') };
  if (radius === undefined) return frame;
  // A rounded box's outline follows its corners (Chrome ≥ 94): its outer edge is grown too.
  const corner = (r: number): number => (r > 0 ? px(Math.max(0, r + grow)) : 0);
  return {
    ...frame,
    radius: { tl: corner(radius.tl), tr: corner(radius.tr), br: corner(radius.br), bl: corner(radius.bl) },
  };
}
