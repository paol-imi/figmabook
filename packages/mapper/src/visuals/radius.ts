import type { CComputed, Rect, SceneNode } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { plainDiagnostic } from '../diagnostics';
import { px } from '../geometry';

type SceneRadius = NonNullable<SceneNode['radius']>;

/**
 * Corner radii (07 §10.3): the CSS overlap reduction `f = min(1, w/(tl+tr), w/(bl+br),
 * h/(tl+bl), h/(tr+br))` applied to each corner. Elliptical corners (h ≠ v) use the smaller
 * radius with `PAINT_ELLIPTICAL_RADIUS_APPROX` until vector corners exist (B-48).
 */
export function cornerRadius(computed: CComputed, box: Rect, notes: Diagnostic[]): SceneRadius | undefined {
  const { h, v } = computed.radius;
  let elliptical = false;
  const corners = h.map((horizontal, i) => {
    const vertical = v[i] ?? horizontal;
    if (Math.abs(horizontal - vertical) > 1e-6) elliptical = true;
    return Math.max(0, Math.min(horizontal, vertical));
  });
  const [tl = 0, tr = 0, br = 0, bl = 0] = corners;
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) return undefined;
  if (elliptical) {
    notes.push(
      plainDiagnostic('PAINT_ELLIPTICAL_RADIUS_APPROX', { property: 'border-radius', fallback: 'the smaller radius' }),
    );
  }
  const ratio = (length: number, sum: number): number => (sum > 0 ? length / sum : 1);
  const f = Math.min(1, ratio(box.w, tl + tr), ratio(box.w, bl + br), ratio(box.h, tl + bl), ratio(box.h, tr + br));
  return { tl: px(tl * f), tr: px(tr * f), br: px(br * f), bl: px(bl * f) };
}
