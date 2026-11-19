/*
 * Scene IR paints and effects → Plugin API values (09 §6 step 8). Every call builds new
 * objects: Figma's paints and effects are immutable (09 §6.2). Variable bindings (`bind`) are
 * the tokens stage (B-60); a bundle that carries them declares feature `tokens`, which this
 * build refuses at import, so they never reach here unapplied.
 */
import type { SceneEffect, ScenePaint } from '@holotype/ir';

/** Figma image hashes by asset sha256; `null` when Figma refused the image (already reported). */
export type ImageHashes = (sha: string) => string | null;

/** One paint, or `null` when it cannot be written (an image Figma refused). */
export function toPaint(paint: ScenePaint, images: ImageHashes): Paint | null {
  switch (paint.type) {
    case 'SOLID':
      return {
        type: 'SOLID',
        color: { r: paint.color.r, g: paint.color.g, b: paint.color.b },
        opacity: paint.opacity,
      };
    case 'IMAGE': {
      const imageHash = images(paint.asset.sha);
      if (imageHash === null) return null;
      return {
        type: 'IMAGE',
        imageHash,
        scaleMode: paint.scaleMode,
        ...(paint.imageTransform === undefined ? {} : { imageTransform: toTransform(paint.imageTransform) }),
        ...(paint.scalingFactor === undefined ? {} : { scalingFactor: paint.scalingFactor }),
        ...(paint.opacity === undefined ? {} : { opacity: paint.opacity }),
      };
    }
    default:
      return {
        type: paint.type,
        gradientTransform: toTransform(paint.gradientTransform),
        gradientStops: paint.gradientStops.map(({ position, color }) => ({
          position,
          color: { r: color.r, g: color.g, b: color.b, a: color.a },
        })),
        ...(paint.opacity === undefined ? {} : { opacity: paint.opacity }),
      };
  }
}

/** A new paint array in Figma order (bottom → top), without the paints that cannot be written. */
export function toPaints(paints: readonly ScenePaint[], images: ImageHashes): Paint[] {
  return paints.flatMap((paint) => toPaint(paint, images) ?? []);
}

export function toEffect(effect: SceneEffect): Effect {
  switch (effect.type) {
    case 'DROP_SHADOW':
    case 'INNER_SHADOW':
      return {
        type: effect.type,
        color: { r: effect.color.r, g: effect.color.g, b: effect.color.b, a: effect.color.a },
        offset: { x: effect.offset.x, y: effect.offset.y },
        radius: effect.radius,
        spread: effect.spread,
        visible: true,
        blendMode: effect.blendMode ?? 'NORMAL',
        ...(effect.showShadowBehindNode === undefined ? {} : { showShadowBehindNode: effect.showShadowBehindNode }),
      } satisfies DropShadowEffect | InnerShadowEffect;
    default:
      return { type: effect.type, blurType: 'NORMAL', radius: effect.radius, visible: true };
  }
}

export const toEffects = (effects: readonly SceneEffect[]): Effect[] => effects.map(toEffect);

/** `Mat2x3` → Figma `Transform` (a fresh, mutable copy). */
export function toTransform(matrix: readonly [readonly number[], readonly number[]]): Transform {
  const [[a = 1, b = 0, c = 0] = [], [d = 0, e = 1, f = 0] = []] = matrix;
  return [
    [a, b, c],
    [d, e, f],
  ];
}

/** Every asset sha256 a paint list needs (IMAGE paints). */
export function paintAssets(paints: readonly ScenePaint[] | undefined): string[] {
  return (paints ?? []).flatMap((paint) => (paint.type === 'IMAGE' ? [paint.asset.sha] : []));
}
