import type { Collector } from '../../types';

type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

/** One radius token: `px` as is, a percentage of `basis`; `null` for anything else (`calc()`). */
function length(token: string, basis: number): number | null {
  const value = Number.parseFloat(token);
  if (!Number.isFinite(value)) return null;
  if (token.endsWith('%')) return (value / 100) * basis;
  if (token.endsWith('px') || value === 0) return value;
  return null;
}

/**
 * A computed `border-*-radius` value (`8px`, `50%`, or the elliptical `8px 4px`) as its
 * horizontal and vertical radii in px. Percentages resolve against the border box (`w` for
 * the horizontal radius, `h` for the vertical one). `null` when the value is not a plain
 * length or percentage. The overlap reduction of large radii is the mapper's (07).
 */
export function parseCornerRadius(value: string, w: number, h: number): [number, number] | null {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length === 0 || tokens.length > 2) return null;
  const [first = '', second = first] = tokens;
  const horizontal = length(first, w);
  const vertical = length(second, h);
  return horizontal === null || vertical === null ? null : [horizontal, vertical];
}

/** Corner radii (05 §7.2): the raw `[h, v]` pair of each corner, in CSS order. */
export const radius: Collector = {
  name: 'radius',
  element({ style }, draft, context) {
    const { w = 0, h = 0 } = draft.borderBox ?? {};
    const read = (corner: Corner): [number, number] => {
      const property = `border-${corner}-radius`;
      const value = style.getPropertyValue(property);
      const pair = parseCornerRadius(value, w, h);
      if (pair !== null) return pair;
      context.report({ code: 'CAP_CSS_UNSUPPORTED', nodeId: draft.id, property, value, fallback: '0px' });
      return [0, 0];
    };
    const [tl, tr, br, bl] = [read('top-left'), read('top-right'), read('bottom-right'), read('bottom-left')];
    draft.computed.radius = { h: [tl[0], tr[0], br[0], bl[0]], v: [tl[1], tr[1], br[1], bl[1]] };
  },
};
