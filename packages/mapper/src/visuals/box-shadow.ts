import type { CShadow, MapperSettings, SceneEffect, ScenePaint, SceneStroke } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { solidPaint } from '../color';
import { plainDiagnostic } from '../diagnostics';
import { isInvisibleShadow, isRing, type ShadowEffect, shadowEffect } from './shadow';

/*
 * `box-shadow` → effects (07 §10.4). Figma honours a shadow's spread only on rectangles and
 * on frames with a visible fill that clip their content, and draws a fill-less frame's
 * shadow from its content rather than from its box. So:
 *
 * - a filled frame keeps its shadows; with a spread it clips its content when nothing
 *   overflows it (that changes nothing visible);
 * - otherwise the shadows move to an absolute backing RECTANGLE (`…/shadow`), the first
 *   child, with the box's size and radius (`PAINT_SPREAD_BACKING_RECT`);
 * - a ring (`0 0 0 Npx`) on a fill-less box without a border becomes an OUTSIDE stroke
 *   (`PAINT_RING_PROMOTED`).
 *
 * Shadows are cut out under the box in CSS; `showShadowBehindNode: false` does the same in
 * Figma where the box is not opaque (S-03 confirms the convention).
 */

type ColorProfile = MapperSettings['mapper']['colorProfile'];

export interface ShadowInput {
  readonly shadows: readonly CShadow[];
  /** The fills of the element's own layer. */
  readonly fills: readonly ScenePaint[];
  /** Whether the element already has a stroke (border or outline), so no ring can take it. */
  readonly stroked: boolean;
  /** Whether the layer can hold children (a frame); rectangles and images honour spread. */
  readonly container: boolean;
  /** Whether the frame clips its content. */
  readonly clips: boolean;
  /** Whether every descendant lies within the box. */
  readonly contentInside: boolean;
  readonly profile: ColorProfile;
}

export interface ShadowPlan {
  /** Effects on the element's own layer, bottom → top. */
  readonly effects?: SceneEffect[];
  /** Set when the frame must clip its content for the spread to draw. */
  readonly clipsContent?: true;
  /** A backing rectangle under the content that carries the shadows instead. */
  readonly backing?: { readonly fills: ScenePaint[]; readonly effects: SceneEffect[] };
  /** The widest ring as an OUTSIDE stroke. */
  readonly ring?: SceneStroke;
}

/** A barely visible fill so Figma has a shape to cast the shadow from (07 §10.4). */
const SHADOW_CASTER: ScenePaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.01 };

const paintsVisibly = (paint: ScenePaint): boolean => (paint.type === 'SOLID' ? paint.opacity > 0 : true);
const isOpaqueSolid = (paint: ScenePaint): boolean => paint.type === 'SOLID' && paint.opacity >= 1;

/** Drop shadows with `showShadowBehindNode: false`, for a layer that is not opaque. */
const cutOut = (effects: readonly ShadowEffect[]): ShadowEffect[] =>
  effects.map((effect) => (effect.type === 'DROP_SHADOW' ? { ...effect, showShadowBehindNode: false } : effect));

/** The widest ring; ties go to the topmost (first in CSS order). */
function widestRing(shadows: readonly CShadow[]): CShadow | undefined {
  let widest: CShadow | undefined;
  for (const shadow of shadows)
    if (isRing(shadow) && (widest === undefined || shadow.spread > widest.spread)) widest = shadow;
  return widest;
}

export function boxShadows(input: ShadowInput, notes: Diagnostic[]): ShadowPlan {
  const visible = input.shadows.filter((shadow) => !isInvisibleShadow(shadow));
  if (visible.length === 0) return {};
  const filled = input.fills.some(paintsVisibly);

  let ring: SceneStroke | undefined;
  let rest = visible;
  const widest = !filled && !input.stroked ? widestRing(visible) : undefined;
  if (widest !== undefined) {
    ring = {
      paints: [solidPaint(widest.color, input.profile, notes, 'box-shadow')],
      align: 'OUTSIDE',
      weight: { t: widest.spread, r: widest.spread, b: widest.spread, l: widest.spread },
    };
    rest = visible.filter((shadow) => shadow !== widest);
    notes.push(plainDiagnostic('PAINT_RING_PROMOTED', { property: 'box-shadow', fallback: 'outside stroke' }));
  }
  const withRing = ring === undefined ? {} : { ring };
  if (rest.length === 0) return withRing;

  const effects = [...rest].reverse().map((shadow) => shadowEffect(shadow, input.profile, notes));
  const spread = effects.some((effect) => effect.spread !== 0);
  const opaque = input.fills.some(isOpaqueSolid);
  const own = opaque ? effects : cutOut(effects);
  if (!input.container || (filled && (!spread || input.clips))) return { ...withRing, effects: own };
  if (filled && input.contentInside) return { ...withRing, effects: own, clipsContent: true };
  notes.push(plainDiagnostic('PAINT_SPREAD_BACKING_RECT', { property: 'box-shadow', fallback: 'backing rectangle' }));
  const caster = input.fills.find(isOpaqueSolid);
  return {
    ...withRing,
    backing: caster ? { fills: [caster], effects } : { fills: [SHADOW_CASTER], effects: cutOut(effects) },
  };
}
