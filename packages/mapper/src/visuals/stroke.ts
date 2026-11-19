import type { CComputed, Color, MapperSettings, SceneStroke } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { solidPaint } from '../color';
import { borderSideVisible, SIDES, sameColor } from '../css';
import { plainDiagnostic } from '../diagnostics';

/*
 * Borders → an INSIDE stroke with per-side weights (07 §10.3, D-16). Per-side colors or
 * styles have no single-stroke form; until decomposition (B-48) they use the dominant side.
 */

type ColorProfile = MapperSettings['mapper']['colorProfile'];

interface VisibleSide {
  readonly index: number;
  readonly width: number;
  readonly style: string;
  readonly color: Color;
}

const APPROXIMATED_STYLES = new Set(['double', 'groove', 'ridge', 'inset', 'outset']);

/** The side whose color and style cover the most border width; ties go to the first side (top first). */
function dominantSide(sides: readonly VisibleSide[]): VisibleSide | undefined {
  let best: { side: VisibleSide; weight: number } | undefined;
  for (const side of sides) {
    const weight = sides
      .filter((other) => other.style === side.style && sameColor(other.color, side.color))
      .reduce((total, other) => total + other.width, 0);
    if (best === undefined || weight > best.weight) best = { side, weight };
  }
  return best?.side;
}

/** The stroke for an element's border, or `undefined` when no side draws. */
export function borderStroke(computed: CComputed, profile: ColorProfile, notes: Diagnostic[]): SceneStroke | undefined {
  const sides: VisibleSide[] = [];
  SIDES.forEach((_, index) => {
    const color = computed.border.color[index];
    if (!borderSideVisible(computed, index) || color === undefined) return;
    sides.push({
      index,
      width: computed.border.width[index] ?? 0,
      style: computed.border.style[index] ?? 'solid',
      color,
    });
  });
  const dominant = dominantSide(sides);
  if (dominant === undefined) return undefined;

  if (sides.some((side) => side.style !== dominant.style || !sameColor(side.color, dominant.color))) {
    notes.push(plainDiagnostic('PAINT_BORDER_DOMINANT', { property: 'border-color', fallback: 'dominant side color' }));
  }
  const weightOf = (index: number): number => sides.find((side) => side.index === index)?.width ?? 0;
  const stroke: SceneStroke = {
    paints: [solidPaint(dominant.color, profile, notes, 'border-color')],
    align: 'INSIDE',
    weight: { t: weightOf(0), r: weightOf(1), b: weightOf(2), l: weightOf(3) },
  };
  const width = Math.max(...sides.map((side) => side.width));
  switch (dominant.style) {
    case 'dashed':
      // Chrome draws dashes about twice as long as the border is wide.
      notes.push(plainDiagnostic('PAINT_DASH_APPROX', { property: 'border-style', value: 'dashed' }));
      return { ...stroke, dashPattern: [2 * width, width] };
    case 'dotted':
      return { ...stroke, dashPattern: [0, 2 * width], cap: 'ROUND' };
    default:
      if (APPROXIMATED_STYLES.has(dominant.style)) {
        notes.push(
          plainDiagnostic('PAINT_BORDER_STYLE_APPROX', {
            property: 'border-style',
            value: dominant.style,
            fallback: 'solid stroke',
          }),
        );
      }
      return stroke;
  }
}
