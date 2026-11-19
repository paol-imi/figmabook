/**
 * Which declarations can set a physical longhand (05 §6.2 winner selection). CDP lists authored
 * declarations with a `range` and the longhands it expanded without one; when the shorthand holds a
 * `var()` the expanded longhands have an empty value. So the resolver matches the authored
 * declaration by name through this table instead of trusting the expansion.
 *
 * Logical properties map for `horizontal-tb` writing mode; `direction` picks inline start/end.
 * Other writing modes are out of scope (the capture reports them, 05 §3).
 */

export type Direction = 'ltr' | 'rtl';

/** The physical longhands the resolver maps (15 §5.2 fields: padding, gap, colors, border, radius, font). */
export const MAPPED_LONGHANDS = [
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'row-gap',
  'column-gap',
  'background-color',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
] as const;

export type MappedLonghand = (typeof MAPPED_LONGHANDS)[number];

type Side = 'top' | 'right' | 'bottom' | 'left';

/** Logical names of a physical side in horizontal-tb. */
function logicalSide(side: Side, direction: Direction): { axis: 'block' | 'inline'; edge: 'start' | 'end' } {
  if (side === 'top') return { axis: 'block', edge: 'start' };
  if (side === 'bottom') return { axis: 'block', edge: 'end' };
  const start = direction === 'ltr' ? 'left' : 'right';
  return { axis: 'inline', edge: side === start ? 'start' : 'end' };
}

function paddingSources(side: Side, direction: Direction): string[] {
  const { axis, edge } = logicalSide(side, direction);
  return ['padding', `padding-${axis}`, `padding-${axis}-${edge}`, `padding-${side}`];
}

function borderSources(side: Side, part: 'width' | 'color', direction: Direction): string[] {
  const { axis, edge } = logicalSide(side, direction);
  return [
    'border',
    `border-${part}`,
    `border-${side}`,
    `border-${axis}`,
    `border-${axis}-${part}`,
    `border-${axis}-${edge}`,
    `border-${axis}-${edge}-${part}`,
    `border-${side}-${part}`,
  ];
}

function radiusSources(vertical: 'top' | 'bottom', horizontal: 'left' | 'right', direction: Direction): string[] {
  const block = vertical === 'top' ? 'start' : 'end';
  const start = direction === 'ltr' ? 'left' : 'right';
  const inline = horizontal === start ? 'start' : 'end';
  return ['border-radius', `border-${block}-${inline}-radius`, `border-${vertical}-${horizontal}-radius`];
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
const CORNERS = [
  ['top', 'left'],
  ['top', 'right'],
  ['bottom', 'right'],
  ['bottom', 'left'],
] as const;

function buildTable(direction: Direction): ReadonlyMap<string, readonly string[]> {
  const table = new Map<string, readonly string[]>();
  for (const side of SIDES) {
    table.set(`padding-${side}`, paddingSources(side, direction));
    table.set(`border-${side}-width`, borderSources(side, 'width', direction));
    table.set(`border-${side}-color`, borderSources(side, 'color', direction));
  }
  for (const [vertical, horizontal] of CORNERS) {
    table.set(`border-${vertical}-${horizontal}-radius`, radiusSources(vertical, horizontal, direction));
  }
  table.set('row-gap', ['gap', 'grid-gap', 'grid-row-gap', 'row-gap']);
  table.set('column-gap', ['gap', 'grid-gap', 'grid-column-gap', 'column-gap']);
  table.set('background-color', ['background', 'background-color']);
  for (const longhand of ['font-family', 'font-size', 'font-weight', 'line-height']) {
    table.set(longhand, ['font', longhand]);
  }
  return table;
}

const TABLES: Readonly<Record<Direction, ReadonlyMap<string, readonly string[]>>> = {
  ltr: buildTable('ltr'),
  rtl: buildTable('rtl'),
};

/**
 * Declared property names that set `longhand`, including the longhand itself. A property not in
 * the table (e.g. `color`, `letter-spacing`, a custom property) is only set by itself.
 */
export function declaringProperties(longhand: string, direction: Direction = 'ltr'): readonly string[] {
  return TABLES[direction].get(longhand) ?? [longhand];
}

/** Properties that inherit by default (CSS 2.2 / Fonts 4), among the mapped ones. */
const INHERITED = new Set<string>([
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
]);

export function isInheritedProperty(property: string): boolean {
  return property.startsWith('--') || INHERITED.has(property);
}
