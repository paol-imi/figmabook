import type { CComputed, Color, MapperSettings, Rect, SceneNode, SceneStroke } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { solidPaint } from '../color';
import { borderSideVisible, SIDES, type Side, sameColor } from '../css';
import { plainDiagnostic } from '../diagnostics';
import { px } from '../geometry';

/*
 * Borders (07 §10.3, D-16). One color and style on every visible side → an INSIDE stroke
 * with per-side weights. Per-side colors or styles on a box without radius → four mitred
 * trapezoid vectors (`…/border-{t,r,b,l}`), drawn above the background and below the
 * content. On a rounded box they use the dominant side (rounded-path decomposition is
 * `mapper.exactBorders`, hardening B-115).
 */

type ColorProfile = MapperSettings['mapper']['colorProfile'];
type SceneRadius = NonNullable<SceneNode['radius']>;

interface VisibleSide {
  readonly index: number;
  readonly width: number;
  readonly style: string;
  readonly color: Color;
}

/** Styles drawn as a solid line, with `PAINT_BORDER_STYLE_APPROX`. */
const APPROXIMATED_STYLES = new Set(['double', 'groove', 'ridge', 'inset', 'outset', 'auto']);

/** The stroke fields for a line style: dash pattern and cap. */
export function lineStyle(
  style: string,
  width: number,
  property: string,
  notes: Diagnostic[],
): Pick<SceneStroke, 'dashPattern' | 'cap'> {
  switch (style) {
    case 'dashed':
      // Chrome draws dashes about twice as long as the line is wide.
      notes.push(plainDiagnostic('PAINT_DASH_APPROX', { property, value: 'dashed' }));
      return { dashPattern: [2 * width, width] };
    case 'dotted':
      return { dashPattern: [0, 2 * width], cap: 'ROUND' };
    default:
      if (APPROXIMATED_STYLES.has(style)) {
        notes.push(plainDiagnostic('PAINT_BORDER_STYLE_APPROX', { property, value: style, fallback: 'solid stroke' }));
      }
      return {};
  }
}

function visibleSides(computed: CComputed): VisibleSide[] {
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
  return sides;
}

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

/** One decomposed border side: a filled trapezoid in page space. */
export interface BorderSideShape {
  readonly side: Side;
  readonly box: Rect;
  /** SVG path data relative to `box`. */
  readonly path: string;
  readonly color: Color;
}

export type BorderVisual =
  | { readonly kind: 'stroke'; readonly stroke: SceneStroke }
  | { readonly kind: 'sides'; readonly sides: readonly BorderSideShape[] };

const isSolidLike = (style: string): boolean => style === 'solid' || APPROXIMATED_STYLES.has(style);

/**
 * The mitred trapezoid of each visible side, from the four border widths (invisible sides
 * still mitre their neighbours, as in CSS).
 */
export function borderTrapezoids(computed: CComputed, box: Rect): BorderSideShape[] {
  const [t = 0, r = 0, b = 0, l = 0] = computed.border.width;
  const { w, h } = box;
  // The inner (padding) edge; widths larger than the box meet in the middle.
  const x0 = Math.min(l, w);
  const x1 = Math.max(x0, w - r);
  const y0 = Math.min(t, h);
  const y1 = Math.max(y0, h - b);
  const corners: Readonly<Record<Side, readonly (readonly [number, number])[]>> = {
    t: [
      [0, 0],
      [w, 0],
      [x1, y0],
      [x0, y0],
    ],
    r: [
      [w, 0],
      [w, h],
      [x1, y1],
      [x1, y0],
    ],
    b: [
      [w, h],
      [0, h],
      [x0, y1],
      [x1, y1],
    ],
    l: [
      [0, h],
      [0, 0],
      [x0, y0],
      [x0, y1],
    ],
  };
  return visibleSides(computed).flatMap(({ index, color }) => {
    const side = SIDES[index];
    if (side === undefined) return [];
    const points = corners[side];
    const minX = Math.min(...points.map(([x]) => x));
    const minY = Math.min(...points.map(([, y]) => y));
    const maxX = Math.max(...points.map(([x]) => x));
    const maxY = Math.max(...points.map(([, y]) => y));
    const path = `${points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${px(x - minX)} ${px(y - minY)}`).join(' ')} Z`;
    return [{ side, box: { x: box.x + minX, y: box.y + minY, w: maxX - minX, h: maxY - minY }, path, color }];
  });
}

const hasRadius = (radius: SceneRadius | undefined): boolean =>
  radius !== undefined && (radius.tl > 0 || radius.tr > 0 || radius.br > 0 || radius.bl > 0);

/**
 * How an element's border is drawn: a stroke, decomposed sides (only when the layer can hold
 * children, `canDecompose`), or nothing (`undefined`) when no side draws.
 */
export function borderVisual(
  computed: CComputed,
  box: Rect,
  radius: SceneRadius | undefined,
  canDecompose: boolean,
  profile: ColorProfile,
  notes: Diagnostic[],
): BorderVisual | undefined {
  const sides = visibleSides(computed);
  const dominant = dominantSide(sides);
  if (dominant === undefined) return undefined;
  const differs = sides.some((side) => side.style !== dominant.style || !sameColor(side.color, dominant.color));

  if (differs && canDecompose && !hasRadius(radius) && sides.every((side) => isSolidLike(side.style))) {
    notes.push(
      plainDiagnostic('PAINT_BORDER_DECOMPOSED', { property: 'border-color', fallback: 'one vector per side' }),
    );
    for (const style of new Set(sides.map((side) => side.style))) {
      if (style !== 'solid') {
        notes.push(
          plainDiagnostic('PAINT_BORDER_STYLE_APPROX', { property: 'border-style', value: style, fallback: 'solid' }),
        );
      }
    }
    return { kind: 'sides', sides: borderTrapezoids(computed, box) };
  }
  if (differs) {
    notes.push(plainDiagnostic('PAINT_BORDER_DOMINANT', { property: 'border-color', fallback: 'dominant side color' }));
  }
  const weightOf = (index: number): number => sides.find((side) => side.index === index)?.width ?? 0;
  const width = Math.max(...sides.map((side) => side.width));
  return {
    kind: 'stroke',
    stroke: {
      paints: [solidPaint(dominant.color, profile, notes, 'border-color')],
      align: 'INSIDE',
      weight: { t: weightOf(0), r: weightOf(1), b: weightOf(2), l: weightOf(3) },
      ...lineStyle(dominant.style, width, 'border-style', notes),
    },
  };
}
