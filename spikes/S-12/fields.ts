/**
 * S-12 test tokens and the binding table: every field of 08 §8 with the Plugin API call the
 * applier would use and the token it is bound to.
 */

export type TokenType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export type TokenSpec = {
  readonly name: string;
  readonly collection: 'primitives' | 'tokens';
  readonly type: TokenType;
  /** Default mode value; `alias:<name>` points at another token. */
  readonly value: string | number | boolean;
  /** Value in the second ("Dark") mode, when it differs. */
  readonly dark?: string | number | boolean;
};

export const TOKENS: readonly TokenSpec[] = [
  { name: 'blue/500', collection: 'primitives', type: 'COLOR', value: '#3b82f6' },
  { name: 'blue/300', collection: 'primitives', type: 'COLOR', value: '#93c5fd' },
  { name: 'color/brand', collection: 'tokens', type: 'COLOR', value: 'alias:blue/500', dark: 'alias:blue/300' },
  { name: 'color/text', collection: 'tokens', type: 'COLOR', value: '#111827', dark: '#f9fafb' },
  { name: 'space/4', collection: 'tokens', type: 'FLOAT', value: 16 },
  { name: 'space/2', collection: 'tokens', type: 'FLOAT', value: 8 },
  { name: 'radius/md', collection: 'tokens', type: 'FLOAT', value: 6 },
  { name: 'size/control', collection: 'tokens', type: 'FLOAT', value: 120 },
  { name: 'opacity/muted', collection: 'tokens', type: 'FLOAT', value: 0.5 },
  { name: 'border/width', collection: 'tokens', type: 'FLOAT', value: 2 },
  { name: 'font/family', collection: 'tokens', type: 'STRING', value: 'Inter' },
  { name: 'font/style', collection: 'tokens', type: 'STRING', value: 'Bold' },
  { name: 'font/weight', collection: 'tokens', type: 'FLOAT', value: 700 },
  { name: 'font/size', collection: 'tokens', type: 'FLOAT', value: 14 },
  { name: 'line/height', collection: 'tokens', type: 'FLOAT', value: 20 },
  { name: 'letter/spacing', collection: 'tokens', type: 'FLOAT', value: 0.5 },
  { name: 'paragraph/spacing', collection: 'tokens', type: 'FLOAT', value: 8 },
  { name: 'paragraph/indent', collection: 'tokens', type: 'FLOAT', value: 4 },
  { name: 'shadow/color', collection: 'tokens', type: 'COLOR', value: '#0f172a' },
  { name: 'shadow/blur', collection: 'tokens', type: 'FLOAT', value: 8 },
  { name: 'text/label', collection: 'tokens', type: 'STRING', value: 'Bound text' },
  { name: 'flag/visible', collection: 'tokens', type: 'BOOLEAN', value: true },
];

/** `color/brand` → `var(--color-brand)`, the form the mapper matches (D-18). */
export function webSyntax(name: string): string {
  return `var(--${name.replaceAll('/', '-')})`;
}

/** Normalizes `var(--x)`, `--x` and ` var( --x ) ` to `--x` for matching. */
export function normalizeWeb(value: string): string {
  const trimmed = value.trim();
  const match = /^var\(\s*(--[^\s,)]+)\s*(?:,[^)]*)?\)$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/** How a field is bound (08 §8 "Plugin API call" column). */
export type BindKind =
  | 'node' // node.setBoundVariable(field, v)
  | 'text-range' // text.setRangeBoundVariable(0, n, field, v)
  | 'fill' // fills = [setBoundVariableForPaint(paint, 'color', v)]
  | 'stroke'
  | 'text-range-fill' // setRangeFills(0, n, [setBoundVariableForPaint(...)])
  | 'gradient-stop' // gradientStops[i].boundVariables = { color: alias }
  | 'effect' // effects = [setBoundVariableForEffect(effect, field, v)]
  | 'text-style'; // textStyle.setBoundVariable(field, v)

/** Node prepared for the binding: plain auto-layout frame, wrapping frame, grid frame or text. */
export type BindTarget = 'frame' | 'wrap' | 'grid' | 'text' | 'style';

export type BindingSpec = {
  readonly field: string;
  readonly kind: BindKind;
  readonly target: BindTarget;
  readonly token: string;
};

const node = (field: string, token: string, target: BindTarget = 'frame'): BindingSpec => ({
  field,
  kind: 'node',
  target,
  token,
});
const range = (field: string, token: string): BindingSpec => ({ field, kind: 'text-range', target: 'text', token });

export const BINDINGS: readonly BindingSpec[] = [
  { field: 'fills.color', kind: 'fill', target: 'frame', token: 'color/brand' },
  { field: 'strokes.color', kind: 'stroke', target: 'frame', token: 'color/text' },
  { field: 'gradientStops.color', kind: 'gradient-stop', target: 'frame', token: 'color/brand' },
  { field: 'textRangeFills.color', kind: 'text-range-fill', target: 'text', token: 'color/text' },
  node('paddingTop', 'space/4'),
  node('paddingRight', 'space/4'),
  node('paddingBottom', 'space/4'),
  node('paddingLeft', 'space/4'),
  node('itemSpacing', 'space/2'),
  node('counterAxisSpacing', 'space/2', 'wrap'),
  node('gridRowGap', 'space/2', 'grid'),
  node('gridColumnGap', 'space/2', 'grid'),
  node('topLeftRadius', 'radius/md'),
  node('topRightRadius', 'radius/md'),
  node('bottomRightRadius', 'radius/md'),
  node('bottomLeftRadius', 'radius/md'),
  node('width', 'size/control'),
  node('height', 'size/control'),
  node('minWidth', 'size/control'),
  node('maxWidth', 'size/control'),
  node('minHeight', 'space/4'),
  node('maxHeight', 'size/control'),
  node('strokeWeight', 'border/width'),
  node('strokeTopWeight', 'border/width'),
  node('strokeRightWeight', 'border/width'),
  node('strokeBottomWeight', 'border/width'),
  node('strokeLeftWeight', 'border/width'),
  node('opacity', 'opacity/muted'),
  node('visible', 'flag/visible'),
  node('characters', 'text/label', 'text'),
  range('fontSize', 'font/size'),
  range('lineHeight', 'line/height'),
  range('letterSpacing', 'letter/spacing'),
  range('fontFamily', 'font/family'),
  range('fontStyle', 'font/style'),
  range('fontWeight', 'font/weight'),
  range('paragraphSpacing', 'paragraph/spacing'),
  range('paragraphIndent', 'paragraph/indent'),
  { field: 'effects.color', kind: 'effect', target: 'frame', token: 'shadow/color' },
  { field: 'effects.radius', kind: 'effect', target: 'frame', token: 'shadow/blur' },
  { field: 'effects.spread', kind: 'effect', target: 'frame', token: 'space/2' },
  { field: 'effects.offsetX', kind: 'effect', target: 'frame', token: 'space/2' },
  { field: 'effects.offsetY', kind: 'effect', target: 'frame', token: 'space/2' },
  { field: 'textStyle.fontSize', kind: 'text-style', target: 'style', token: 'font/size' },
  { field: 'textStyle.lineHeight', kind: 'text-style', target: 'style', token: 'line/height' },
];
