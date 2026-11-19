import type { Color, MapperSettings, Rgb, ScenePaint } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { plainDiagnostic } from './diagnostics';

/*
 * Colors (07 §9). Capture colors are gamma-encoded 0..1 values in their declared space. The
 * Scene carries colors in the target file's profile: sRGB unless `mapper.colorProfile` is
 * `display-p3`. `auto` is treated as sRGB here: the file's profile is only known in the
 * plugin, and an sRGB file is the common case (LEGACY files are sRGB too).
 */

type ColorProfile = MapperSettings['mapper']['colorProfile'];

/** Linear Display P3 → linear sRGB (both D65). */
const P3_TO_SRGB: readonly (readonly [number, number, number])[] = [
  [1.2249401762805598, -0.22494017628055996, 0],
  [-0.042056954709688163, 1.0420569547096881, 0],
  [-0.019637554590334432, -0.07863604555063189, 1.0982736001409663],
];

/** Channels outside 0..1 by more than this count as out of gamut, not rounding noise. */
const GAMUT_EPSILON = 1e-4;

const decode = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const encode = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (c: number): number => Math.min(1, Math.max(0, c));

/** A capture color converted to the target profile; `gamutMapped` when channels had to be clipped. */
export function toTargetRgb(color: Color, profile: ColorProfile): { rgb: Rgb; gamutMapped: boolean } {
  const { r, g, b } = color;
  if (color.space === 'srgb' || profile === 'display-p3') return { rgb: { r, g, b }, gamutMapped: false };
  // Display P3 shares sRGB's transfer function, so only the primaries change.
  const [lr, lg, lb] = [decode(r), decode(g), decode(b)];
  // A negative linear value has no real power; encode it as its mirror so it reads as out of gamut.
  const signedEncode = (c: number): number => Math.sign(c) * encode(Math.abs(c));
  const channels = P3_TO_SRGB.map(([kr, kg, kb]) => signedEncode(kr * lr + kg * lg + kb * lb));
  const gamutMapped = channels.some((c) => c < -GAMUT_EPSILON || c > 1 + GAMUT_EPSILON);
  const [cr = 0, cg = 0, cb = 0] = channels.map(clamp01);
  return { rgb: { r: cr, g: cg, b: cb }, gamutMapped };
}

/**
 * A SOLID paint for a capture color: the color carries the channels and the CSS alpha goes
 * into `opacity` (07 §9). Out-of-gamut colors add `PAINT_COLOR_GAMUT_MAPPED` to `notes`.
 */
export function solidPaint(color: Color, profile: ColorProfile, notes: Diagnostic[], property: string): ScenePaint {
  const { rgb, gamutMapped } = toTargetRgb(color, profile);
  if (gamutMapped) {
    notes.push(
      plainDiagnostic('PAINT_COLOR_GAMUT_MAPPED', {
        property,
        ...(color.original === undefined ? {} : { value: color.original }),
        fallback: 'channels clipped to sRGB',
      }),
    );
  }
  return { type: 'SOLID', color: rgb, opacity: color.a };
}
