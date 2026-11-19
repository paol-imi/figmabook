/**
 * Which longhands of a node become Scene fields that a designer can change (15 §5.2), so they
 * need provenance: non-zero padding and gaps, visible fills and borders, non-zero radii, and the
 * typography of text. Default values (0 padding, no border, transparent fill) produce no Scene
 * field and are skipped; B-45 reads the same set from the Capture IR.
 */
import type { ComputedStyle } from './cdp.ts';
import type { MappedLonghand } from './longhands.ts';

export type NodeKind = 'element' | 'text';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
const TEXT_FIELDS: readonly MappedLonghand[] = ['color', 'font-family', 'font-size', 'font-weight', 'line-height'];

const isZero = (value: string | undefined) => value === undefined || /^0(?:px)?(?: 0(?:px)?)?$/.test(value.trim());
const isTransparent = (value: string | undefined) =>
  value === undefined || value === 'transparent' || /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(value);

/** The mapped longhands of a node that carry a non-default value, in a fixed order. */
export function relevantFields(kind: NodeKind, computed: ComputedStyle): MappedLonghand[] {
  if (kind === 'text') {
    const fields = [...TEXT_FIELDS];
    const spacing = computed['letter-spacing'];
    if (spacing !== undefined && spacing !== 'normal' && !isZero(spacing)) fields.push('letter-spacing');
    return fields;
  }
  const fields: MappedLonghand[] = [];
  for (const side of SIDES) if (!isZero(computed[`padding-${side}`])) fields.push(`padding-${side}`);
  if (/(?:^|-)(?:flex|grid)$/.test(computed.display ?? '')) {
    for (const gap of ['row-gap', 'column-gap'] as const) {
      const value = computed[gap];
      if (value !== undefined && value !== 'normal' && !isZero(value)) fields.push(gap);
    }
  }
  if (!isTransparent(computed['background-color'])) fields.push('background-color');
  for (const side of SIDES) {
    const style = computed[`border-${side}-style`];
    if (style === undefined || style === 'none' || style === 'hidden' || isZero(computed[`border-${side}-width`])) {
      continue;
    }
    fields.push(`border-${side}-width`);
    if (!isTransparent(computed[`border-${side}-color`])) fields.push(`border-${side}-color`);
  }
  for (const corner of CORNERS) {
    if (!isZero(computed[`border-${corner}-radius`])) fields.push(`border-${corner}-radius`);
  }
  return fields;
}

/** Field group, for coverage tables. */
export function fieldGroup(property: string): 'padding' | 'gap' | 'fill' | 'border' | 'radius' | 'text' {
  if (property.startsWith('padding-')) return 'padding';
  if (property.endsWith('-gap')) return 'gap';
  if (property === 'background-color') return 'fill';
  if (property.endsWith('-radius')) return 'radius';
  if (property.startsWith('border-')) return 'border';
  return 'text';
}
