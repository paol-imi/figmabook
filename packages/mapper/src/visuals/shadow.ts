import type { CShadow, MapperSettings, Rgba, SceneEffect } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { toTargetRgb } from '../color';
import { plainDiagnostic } from '../diagnostics';

/*
 * CSS shadows → Figma shadow effects (07 §10.4, §8.2). Blur maps 1:1 to the effect radius;
 * effects carry the color's alpha in `color.a` (07 §9). CSS lists the topmost shadow first,
 * Figma bottom → top, so lists are reversed.
 */

type ColorProfile = MapperSettings['mapper']['colorProfile'];
export type ShadowEffect = Extract<SceneEffect, { type: 'DROP_SHADOW' | 'INNER_SHADOW' }>;

/** A capture color as an effect color in the target profile. */
export function effectColor(shadow: CShadow, profile: ColorProfile, notes: Diagnostic[]): Rgba {
  const { rgb, gamutMapped } = toTargetRgb(shadow.color, profile);
  if (gamutMapped) {
    notes.push(
      plainDiagnostic('PAINT_COLOR_GAMUT_MAPPED', {
        property: 'box-shadow',
        ...(shadow.color.original === undefined ? {} : { value: shadow.color.original }),
        fallback: 'channels clipped to sRGB',
      }),
    );
  }
  return { ...rgb, a: shadow.color.a };
}

/** One CSS shadow as a Figma effect: `inset` → INNER_SHADOW, else DROP_SHADOW. */
export function shadowEffect(shadow: CShadow, profile: ColorProfile, notes: Diagnostic[]): ShadowEffect {
  return {
    type: shadow.inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
    color: effectColor(shadow, profile, notes),
    offset: { x: shadow.x, y: shadow.y },
    radius: Math.max(0, shadow.blur),
    spread: shadow.spread,
  };
}

/** A shadow that draws nothing: fully transparent. */
export const isInvisibleShadow = (shadow: CShadow): boolean => shadow.color.a <= 0;

/**
 * A ring: an outer shadow with no offset and no blur, only spread (`0 0 0 Npx c`, Tailwind
 * `ring-*`). On a frame without fills Figma draws it as nothing (07 §10.4).
 */
export const isRing = (shadow: CShadow): boolean =>
  !shadow.inset && shadow.x === 0 && shadow.y === 0 && shadow.blur === 0 && shadow.spread > 0;
