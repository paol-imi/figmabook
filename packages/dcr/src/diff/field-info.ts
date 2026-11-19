import type { JsonValue } from '@holotype/ir';
import { field, isObject } from '../identify/json';
import type { PartialNodeGroups } from '../schema';
import type { TokenScope } from './tokens';

/*
 * What a read-back field means (06 §6 groups, 15 §4.3, §4.7): its plain name for designers,
 * its CSS name for the code side, the kind of value, the variable scope a token for it needs,
 * and where its binding lives in the flat `bind` group (`paddingLeft`, `fills[0]`).
 */

export type ValueKind = 'px' | 'color' | 'ratio' | 'length' | 'other';

export interface FieldInfo {
  /** Designer words, e.g. `padding left`. */
  readonly label: string;
  /** CSS words, e.g. `padding-left`. */
  readonly css: string;
  readonly kind: ValueKind;
  /** The variable scope a token for this field needs; absent for fields tokens never bind. */
  readonly scope?: TokenScope;
  /** Key of the binding in the `bind` group, e.g. `paddingLeft` or `fills[0]`. */
  readonly bindKey?: string;
  /** Fields that read as one when they change together (padding sides, corners). */
  readonly family?: 'padding' | 'radius';
  readonly part?: string;
}

const SIDES = { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' } as const;
const CORNERS = {
  topLeft: ['top left', 'top-left'],
  topRight: ['top right', 'top-right'],
  bottomRight: ['bottom right', 'bottom-right'],
  bottomLeft: ['bottom left', 'bottom-left'],
} as const;

const FILL_SCOPE: Readonly<Record<string, TokenScope>> = {
  FRAME: 'FRAME_FILL',
  COMPONENT: 'FRAME_FILL',
  COMPONENT_SET: 'FRAME_FILL',
  INSTANCE: 'FRAME_FILL',
  SECTION: 'FRAME_FILL',
  TEXT: 'TEXT_FILL', // diag-check-ignore: a Figma VariableScope, not a diagnostic
};

const SIMPLE: Readonly<Record<string, FieldInfo>> = {
  'layout.itemSpacing': { label: 'gap', css: 'gap', kind: 'px', scope: 'GAP', bindKey: 'itemSpacing' },
  'layout.counterAxisSpacing': {
    label: 'row gap',
    css: 'row-gap',
    kind: 'px',
    scope: 'GAP',
    bindKey: 'counterAxisSpacing',
  },
  'layout.minWidth': { label: 'min width', css: 'min-width', kind: 'px', scope: 'WIDTH_HEIGHT', bindKey: 'minWidth' },
  'layout.maxWidth': { label: 'max width', css: 'max-width', kind: 'px', scope: 'WIDTH_HEIGHT', bindKey: 'maxWidth' },
  'layout.minHeight': {
    label: 'min height',
    css: 'min-height',
    kind: 'px',
    scope: 'WIDTH_HEIGHT',
    bindKey: 'minHeight',
  },
  'layout.maxHeight': {
    label: 'max height',
    css: 'max-height',
    kind: 'px',
    scope: 'WIDTH_HEIGHT',
    bindKey: 'maxHeight',
  },
  'layout.layoutMode': { label: 'auto layout direction', css: 'flex-direction', kind: 'other' },
  'layout.layoutSizingHorizontal': { label: 'width sizing', css: 'width', kind: 'other' },
  'layout.layoutSizingVertical': { label: 'height sizing', css: 'height', kind: 'other' },
  'layout.primaryAxisAlignItems': { label: 'alignment', css: 'justify-content', kind: 'other' },
  'layout.counterAxisAlignItems': { label: 'cross-axis alignment', css: 'align-items', kind: 'other' },
  'layout.layoutWrap': { label: 'wrap', css: 'flex-wrap', kind: 'other' },
  'layout.layoutPositioning': { label: 'positioning', css: 'position', kind: 'other' },
  'layout.children.order': { label: 'layer order', css: 'element order', kind: 'other' },
  'geom.width': { label: 'width', css: 'width', kind: 'px', scope: 'WIDTH_HEIGHT', bindKey: 'width' },
  'geom.height': { label: 'height', css: 'height', kind: 'px', scope: 'WIDTH_HEIGHT', bindKey: 'height' },
  'geom.x': { label: 'x', css: 'left', kind: 'px' },
  'geom.y': { label: 'y', css: 'top', kind: 'px' },
  'geom.rotation': { label: 'rotation', css: 'rotate', kind: 'other' },
  'paint.cornerRadius': {
    label: 'corner radius',
    css: 'border-radius',
    kind: 'px',
    scope: 'CORNER_RADIUS',
    bindKey: 'cornerRadius',
  },
  'paint.strokeWeight': {
    label: 'stroke weight',
    css: 'border-width',
    kind: 'px',
    scope: 'STROKE_FLOAT',
    bindKey: 'strokeWeight',
  },
  'paint.opacity': { label: 'opacity', css: 'opacity', kind: 'ratio', scope: 'OPACITY', bindKey: 'opacity' },
  'paint.effects': { label: 'effects', css: 'box-shadow', kind: 'other' },
  'paint.clipsContent': { label: 'clip content', css: 'overflow', kind: 'other' },
  'paint.blendMode': { label: 'blend mode', css: 'mix-blend-mode', kind: 'other' },
  'text.fontSize': { label: 'font size', css: 'font-size', kind: 'px', scope: 'FONT_SIZE', bindKey: 'fontSize' }, // diag-check-ignore: a Figma VariableScope, not a diagnostic
  'text.lineHeight': {
    label: 'line height',
    css: 'line-height',
    kind: 'length',
    scope: 'LINE_HEIGHT',
    bindKey: 'lineHeight',
  },
  'text.letterSpacing': {
    label: 'letter spacing',
    css: 'letter-spacing',
    kind: 'length',
    scope: 'LETTER_SPACING',
    bindKey: 'letterSpacing',
  },
  'text.paragraphSpacing': {
    label: 'paragraph spacing',
    css: 'margin-block',
    kind: 'px',
    scope: 'PARAGRAPH_SPACING',
    bindKey: 'paragraphSpacing',
  },
  'text.fontName': { label: 'font', css: 'font-family', kind: 'other' },
  'text.characters': { label: 'text', css: 'text content', kind: 'other' },
  'text.textCase': { label: 'text case', css: 'text-transform', kind: 'other' },
  'text.textDecoration': { label: 'text decoration', css: 'text-decoration', kind: 'other' },
  'text.textAlignHorizontal': { label: 'text alignment', css: 'text-align', kind: 'other' },
  'text.maxLines': { label: 'max lines', css: 'line-clamp', kind: 'other' },
  'vis.visible': { label: 'visibility', css: 'display', kind: 'other' },
  'vis.name': { label: 'layer name', css: 'name', kind: 'other' },
};

/** Fields with no CSS equivalent (DCR_FIELD_UNMAPPABLE). */
export const UNMAPPABLE_FIELDS: ReadonlySet<string> = new Set([
  'paint.cornerSmoothing',
  'paint.strokeAlign',
  'layout.itemReverseZIndex',
  'text.leadingTrim',
  'text.hangingPunctuation',
  'text.hangingList',
]);

/** What a field means on a node of `nodeType`. */
export function fieldInfo(path: string, nodeType: string): FieldInfo {
  const simple = SIMPLE[path];
  if (simple) return simple;
  const padding = /^layout\.padding(Top|Right|Bottom|Left)$/.exec(path);
  if (padding) {
    const side = SIDES[padding[1] as keyof typeof SIDES];
    return {
      label: `padding ${side}`,
      css: `padding-${side}`,
      kind: 'px',
      scope: 'GAP',
      bindKey: `padding${padding[1]}`,
      family: 'padding',
      part: side,
    };
  }
  const corner = /^paint\.(topLeft|topRight|bottomRight|bottomLeft)Radius$/.exec(path);
  if (corner) {
    const key = corner[1] as keyof typeof CORNERS;
    const [words, css] = CORNERS[key];
    return {
      label: `${words} radius`,
      css: `border-${css}-radius`,
      kind: 'px',
      scope: 'CORNER_RADIUS',
      bindKey: `${key}Radius`,
      family: 'radius',
      part: key,
    };
  }
  const fill = /^(paint|text)\.fills\[(\d+)\]\.color$/.exec(path);
  if (fill) {
    const text = fill[1] === 'text';
    const scope: TokenScope = text ? 'TEXT_FILL' : (FILL_SCOPE[nodeType] ?? 'SHAPE_FILL'); // diag-check-ignore: a Figma VariableScope, not a diagnostic
    return text
      ? { label: 'text color', css: 'color', kind: 'color', scope, bindKey: `fills[${fill[2]}]` }
      : { label: 'fill', css: 'background-color', kind: 'color', scope, bindKey: `fills[${fill[2]}]` };
  }
  const stroke = /^paint\.strokes\[(\d+)\]\.color$/.exec(path);
  if (stroke) {
    return {
      label: 'stroke',
      css: 'border-color',
      kind: 'color',
      scope: 'STROKE_COLOR',
      bindKey: `strokes[${stroke[1]}]`,
    };
  }
  const sideWeight = /^paint\.stroke(Top|Right|Bottom|Left)Weight$/.exec(path);
  if (sideWeight) {
    const side = SIDES[sideWeight[1] as keyof typeof SIDES];
    return {
      label: `${side} stroke weight`,
      css: `border-${side}-width`,
      kind: 'px',
      scope: 'STROKE_FLOAT',
      bindKey: `stroke${sideWeight[1]}Weight`,
    };
  }
  if (/^(paint|text)\.fills\b/.test(path)) return { label: 'fill', css: 'background', kind: 'other' };
  if (/^paint\.strokes\b/.test(path)) return { label: 'stroke', css: 'border', kind: 'other' };
  const rest = path.slice(path.indexOf('.') + 1);
  return { label: rest, css: rest, kind: 'other' };
}

/** The binding of a value field in a `bind` group: the variable id, if bound. */
export function boundVariable(bind: JsonValue | undefined, bindKey: string | undefined): string | undefined {
  if (bindKey === undefined) return undefined;
  const indexed = /^(\w+)\[(\d+)\]$/.exec(bindKey);
  const value = indexed
    ? (() => {
        const list = field(bind, indexed[1] as string);
        return Array.isArray(list) ? list[Number(indexed[2])] : undefined;
      })()
    : field(bind, bindKey);
  return typeof value === 'string' ? value : undefined;
}

const VALUE_GROUPS = ['layout', 'geom', 'paint', 'text'] as const;
const FONT_BINDINGS: ReadonlySet<string> = new Set(['fontFamily', 'fontStyle', 'fontWeight']);

/**
 * The value field a `bind.*` change binds: `bind.fills[0]` → `paint.fills[0].color` (or
 * `text.fills[0].color` on a text), `bind.paddingLeft` → `layout.paddingLeft`. `undefined` for
 * bindings that are not a value (component property references, effects).
 */
export function valueFieldOfBinding(
  bindPath: string,
  nodeType: string,
  groups: PartialNodeGroups[],
): string | undefined {
  const key = bindPath.slice('bind.'.length);
  const indexed = /^(fills|strokes)\[(\d+)\]$/.exec(key);
  if (indexed) {
    const group = indexed[1] === 'fills' && nodeType === 'TEXT' ? 'text' : 'paint';
    return `${group}.${indexed[1]}[${indexed[2]}].color`;
  }
  if (!/^\w+$/.test(key) || key === 'componentPropertyReferences') return undefined;
  if (FONT_BINDINGS.has(key)) return 'text.fontName';
  for (const group of VALUE_GROUPS) {
    if (groups.some((g) => isObject(g[group]) && Object.hasOwn(g[group] as object, key))) return `${group}.${key}`;
  }
  return undefined;
}

/** The bind field of a value field, e.g. `paint.fills[0].color` → `bind.fills[0]`. */
export const bindFieldOf = (path: string, nodeType: string): string | undefined => {
  const key = fieldInfo(path, nodeType).bindKey;
  return key === undefined ? undefined : `bind.${key}`;
};
