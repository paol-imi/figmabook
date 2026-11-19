import type { CodeRef, JsonValue } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { boundVariable, fieldInfo } from '../diff/field-info';
import { rgbaOf, type TokenScope, type TokenValue } from '../diff/tokens';
import { currentValues } from '../identify/components';
import { asNumber, field, isObject, sameJson, sortedKeys, uniqueSorted } from '../identify/json';
import type { LayoutHint, SnapNode, TextHint, TokenOrValue, UsageInstance, UsageNode } from '../schema';
import { dcrDiagnostic, type ExtractContext, type QuestionDraft } from './context';
import { borderOffset } from './phrases';
import { argName, camelCase, hexColor } from './text';

/*
 * Usage trees (15 §4.5, §4.6): how an added layer or a new component is built from instances,
 * frames and text. Keys are `name:index` paths, because these nodes have no `nk`. Instances
 * are reverse-mapped to args: the main variant's story args, then the instance's TEXT and
 * BOOLEAN properties through the set's `props` ids; a property with no arg is kept as
 * `{ unmapped }` with `DCR_PROPERTY_UNMAPPED`. Frame values carry their tokens; a raw one gets
 * candidates and a question (15 §4.7).
 */

export interface UsageFindings {
  readonly diagnostics: Diagnostic[];
  readonly questions: QuestionDraft[];
  untokenized: number;
}

const DIRECTION: Readonly<Record<string, LayoutHint['direction']>> = {
  HORIZONTAL: 'row',
  VERTICAL: 'column',
  GRID: 'grid',
  NONE: 'none',
};
const JUSTIFY: Readonly<Record<string, string>> = { CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'space-between' };
const ALIGN: Readonly<Record<string, string>> = { CENTER: 'center', MAX: 'end', BASELINE: 'baseline' };
const SIZING: Readonly<Record<string, 'hug' | 'fill' | 'fixed'>> = { HUG: 'hug', FILL: 'fill', FIXED: 'fixed' };
const PADDING = ['Top', 'Right', 'Bottom', 'Left'] as const;

/** The code identity of a managed component, from its set's plugin data (15 §5.3). */
export function codeRefOf(ctx: ExtractContext, set: SnapNode): CodeRef | undefined {
  const sid = set.data.sid;
  const source = ctx.index.source(set);
  if (sid === undefined || source.storiesPath === undefined) return undefined;
  const storyIds = uniqueSorted(
    ctx.index.children(set).flatMap((variant) => (variant.data.story === undefined ? [] : [variant.data.story])),
  );
  const pkg = ctx.config.targets.components.package;
  return {
    sid,
    ...(source.exportName === undefined ? {} : { exportName: source.exportName }),
    ...(source.componentPath === undefined ? {} : { importPath: source.componentPath }),
    storiesPath: source.storiesPath,
    storyIds,
    ...(pkg === undefined ? {} : { package: pkg }),
  };
}

/** The variant an instance of the set shows by default: Figma's default values, else the first. */
export function defaultVariant(ctx: ExtractContext, set: SnapNode): SnapNode | undefined {
  const defs = set.component?.propertyDefs;
  const defaults: Record<string, string> = {};
  if (isObject(defs)) {
    for (const key of sortedKeys(defs)) {
      const def = defs[key];
      if (field(def, 'type') === 'VARIANT' && typeof field(def, 'defaultValue') === 'string') {
        defaults[key] = field(def, 'defaultValue') as string;
      }
    }
  }
  const variants = ctx.index.children(set).filter((node) => node.type === 'COMPONENT');
  return variants.find((variant) => sameJson(currentValues(variant), defaults)) ?? variants[0];
}

/** The `#id` part of a Figma property id (`Show icon#13:1` → `13:1`); stable across renames. */
export const propertySuffix = (id: string): string => {
  const at = id.lastIndexOf('#');
  return at < 0 ? id : id.slice(at + 1);
};

/** The Figma name of a property id (`Show icon#13:1` → `Show icon`). */
export const propertyName = (id: string): string => {
  const at = id.lastIndexOf('#');
  return at < 0 ? id : id.slice(0, at);
};

export class UsageBuilder {
  readonly findings: UsageFindings = { diagnostics: [], questions: [], untokenized: 0 };
  private readonly ctx: ExtractContext;

  constructor(ctx: ExtractContext) {
    this.ctx = ctx;
  }

  /** The usage tree of `node` at `key`. */
  build(node: SnapNode, key: string): UsageNode {
    if (node.type === 'INSTANCE') return this.instance(node, key);
    if (node.type === 'TEXT') return this.text(node, key);
    return this.frame(node, key);
  }

  private childrenOf(node: SnapNode, key: string): UsageNode[] {
    return this.ctx.index.children(node).map((child, i) => this.build(child, `${key}/${child.name}:${i}`));
  }

  private text(node: SnapNode, key: string): UsageNode {
    const text = node.groups.text;
    const style: TextHint = {};
    const font = field(text, 'fontName');
    if (typeof field(font, 'family') === 'string') style.family = field(font, 'family') as string;
    if (typeof field(font, 'style') === 'string') style.style = field(font, 'style') as string;
    const size = asNumber(field(text, 'fontSize'));
    if (size !== undefined) style.size = size;
    const lineHeight = field(text, 'lineHeight');
    if (lineHeight !== undefined) {
      const unit = field(lineHeight, 'unit');
      const amount = asNumber(field(lineHeight, 'value'));
      style.lineHeight =
        unit === 'PIXELS' && amount !== undefined ? amount : unit === 'PERCENT' ? `${amount ?? 0}%` : 'auto';
    }
    const characters = field(text, 'characters');
    return { t: 'text', key, characters: typeof characters === 'string' ? characters : '', style };
  }

  private frame(node: SnapNode, key: string): UsageNode {
    const out: Extract<UsageNode, { t: 'frame' }> = { t: 'frame', key, name: node.name, children: [] };
    const layout = this.layout(node, key);
    if (layout) out.layout = layout;
    const fills = this.fills(node, key);
    if (fills.length > 0) out.fills = fills;
    const radius = this.radius(node, key);
    if (radius) out.radius = radius;
    out.children = this.childrenOf(node, key);
    return out;
  }

  private layout(node: SnapNode, key: string): LayoutHint | undefined {
    const layout = node.groups.layout;
    const mode = field(layout, 'layoutMode');
    const h = SIZING[String(field(layout, 'layoutSizingHorizontal'))];
    const v = SIZING[String(field(layout, 'layoutSizingVertical'))];
    if (typeof mode !== 'string' && (h === undefined || v === undefined)) return undefined;
    const hint: LayoutHint = { direction: (typeof mode === 'string' && DIRECTION[mode]) || 'none' };
    const stack = mode === 'HORIZONTAL' || mode === 'VERTICAL';
    if (stack) {
      const gap = asNumber(field(layout, 'itemSpacing'));
      if (gap !== undefined && gap !== 0) {
        hint.gap = this.tokenOrValue(node, key, 'gap', 'layout.itemSpacing', gap, { kind: 'FLOAT', value: gap });
      }
      const sides = PADDING.map((side) => asNumber(field(layout, `padding${side}`)) ?? 0);
      if (sides.some((side) => side !== 0)) {
        const padding = PADDING.map((side, i) => {
          const value = sides[i] as number;
          const css = value - borderOffset(node.groups, side.toLowerCase());
          return this.tokenOrValue(node, key, `padding[${i}]`, `layout.padding${side}`, value, {
            kind: 'FLOAT',
            value: css,
          });
        });
        hint.padding = padding as [TokenOrValue, TokenOrValue, TokenOrValue, TokenOrValue];
      }
      const justify = JUSTIFY[String(field(layout, 'primaryAxisAlignItems'))];
      if (justify) hint.justify = justify;
      const align = ALIGN[String(field(layout, 'counterAxisAlignItems'))];
      if (align) hint.align = align;
      if (field(layout, 'layoutWrap') === 'WRAP') hint.wrap = true;
    }
    if (h !== undefined && v !== undefined) {
      hint.sizing = { w: h, h: v };
      const fixed: { w?: number; h?: number } = {};
      const width = asNumber(field(node.groups.geom, 'width'));
      const height = asNumber(field(node.groups.geom, 'height'));
      if (h === 'fixed' && width !== undefined) fixed.w = width;
      if (v === 'fixed' && height !== undefined) fixed.h = height;
      if (fixed.w !== undefined || fixed.h !== undefined) hint.fixed = fixed;
    }
    return hint;
  }

  private fills(node: SnapNode, key: string): TokenOrValue[] {
    const fills = field(node.groups.paint, 'fills');
    if (!Array.isArray(fills)) return [];
    return fills.flatMap((paint, i) => {
      if (!isObject(paint) || paint.type !== 'SOLID' || paint.visible === false) return [];
      const rgba = rgbaOf(paint.color, asNumber(paint.opacity) ?? 1);
      const value = rgba === undefined ? undefined : hexColor({ ...rgba });
      if (rgba === undefined || value === undefined) return [];
      return [this.tokenOrValue(node, key, `fills[${i}]`, `paint.fills[${i}].color`, value, { kind: 'COLOR', rgba })];
    });
  }

  private radius(node: SnapNode, key: string): TokenOrValue | undefined {
    const paint = node.groups.paint;
    const corners = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].map((corner) =>
      asNumber(field(paint, corner)),
    );
    const uniform = asNumber(field(paint, 'cornerRadius'));
    if (corners.every((corner) => corner === undefined)) {
      return uniform === undefined || uniform === 0
        ? undefined
        : this.tokenOrValue(node, key, 'radius', 'paint.cornerRadius', uniform, { kind: 'FLOAT', value: uniform });
    }
    const values = corners.map((corner) => corner ?? 0);
    if (values.every((value) => value === 0)) return undefined;
    if (values.every((value) => value === values[0])) {
      const value = values[0] as number;
      return this.tokenOrValue(node, key, 'radius', 'paint.topLeftRadius', value, { kind: 'FLOAT', value });
    }
    return { value: values, untokenized: true };
  }

  /** A hint value with its token, or raw with candidates, a diagnostic and a question (15 §4.7). */
  private tokenOrValue(
    node: SnapNode,
    key: string,
    property: string,
    path: string,
    value: JsonValue,
    match: TokenValue,
  ): TokenOrValue {
    const info = fieldInfo(path, node.type);
    const bound = boundVariable(node.groups.bind, info.bindKey);
    const token = bound === undefined ? undefined : this.ctx.tokens.cssName(bound);
    if (token !== undefined) return { token, value };
    const candidates = this.ctx.tokens.candidates(match, info.scope as TokenScope);
    const code = candidates.length > 0 ? 'DCR_VALUE_UNTOKENIZED' : 'DCR_VALUE_NO_TOKEN';
    const label = property.startsWith('padding') ? 'padding' : info.family === 'radius' ? 'corner radius' : info.label;
    const kept = match.kind === 'COLOR' ? String(value) : `${match.value}px`;
    this.findings.diagnostics.push(dcrDiagnostic(code, { nodeKey: key, property }));
    this.findings.untokenized += 1;
    const subject = `${node.name} ${label} is ${kept}`;
    this.findings.questions.push(
      candidates.length === 0
        ? {
            code,
            text: `${subject} and matches no token. Add a token, or keep the value?`,
            options: ['add a token', `keep ${kept}`],
          }
        : {
            code,
            text:
              candidates.length === 1
                ? `${subject} and is not bound to a variable. One token matches: ${candidates[0]}. Use it?`
                : `${subject} and is not bound to a variable. ${candidates.length} tokens match: ${candidates.join(', ')}. Which one?`,
            options: [...candidates, `keep ${kept}`],
          },
    );
    return candidates.length > 0 ? { value, untokenized: true, candidates } : { value, untokenized: true };
  }

  private instance(node: SnapNode, key: string): UsageNode {
    const { ctx } = this;
    const main = ctx.index.node(node.instance?.mainId);
    const newItem = main === undefined ? undefined : ctx.newComponents.get(main.id);
    if (newItem !== undefined) return { t: 'new-component-ref', key, itemId: newItem };
    const set = main?.type === 'COMPONENT' ? ctx.index.parent(main) : undefined;
    const component = set?.data.sid !== undefined ? codeRefOf(ctx, set) : undefined;
    if (!main || !set || !component) {
      const fallback: UsageNode = { t: 'frame', key, name: node.name, children: [] };
      if (!main) {
        this.findings.diagnostics.push(
          dcrDiagnostic('DCR_REMOTE_COMPONENT_UNRESOLVED', {
            nodeKey: key,
            value: node.instance?.mainKey ?? node.name,
          }),
        );
      } else if (set?.data.sid !== undefined) {
        this.findings.diagnostics.push(dcrDiagnostic('DCR_IMPORT_UNRESOLVED', { nodeKey: key, sid: set.data.sid }));
      }
      return fallback;
    }
    return { t: 'instance', key, inst: this.reverseMap(node, key, main, set, component) };
  }

  /** Instance properties → args (15 §4.5 steps 1, 2 and 4). */
  private reverseMap(node: SnapNode, key: string, main: SnapNode, set: SnapNode, component: CodeRef): UsageInstance {
    const { index } = this.ctx;
    const props: Record<string, JsonValue> = { ...index.args(main) };
    const ids = index.propertyIds(set);
    const bySuffix = new Map([...ids].map(([arg, id]) => [propertySuffix(id), argName(arg)]));
    const properties = node.instance?.properties ?? {};
    for (const id of sortedKeys(properties)) {
      const property = properties[id];
      if (!property || property.type === 'VARIANT') continue;
      const arg = bySuffix.get(propertySuffix(id));
      if (arg !== undefined && (property.type === 'TEXT' || property.type === 'BOOLEAN')) {
        props[arg] = property.value;
        continue;
      }
      const name = propertyName(id);
      props[arg ?? camelCase(name)] = { unmapped: property.value };
      this.findings.diagnostics.push(
        dcrDiagnostic('DCR_PROPERTY_UNMAPPED', { nodeKey: key, sid: component.sid, property: name }),
      );
      this.findings.questions.push({
        code: 'DCR_PROPERTY_UNMAPPED',
        text: `${node.name} sets the Figma property ${name} to ${JSON.stringify(property.value)}, which maps to no prop of ${component.exportName ?? component.sid}. Which prop should it set?`,
      });
    }
    this.unexplainedOverrides(node, key);
    const base = defaultVariant(this.ctx, set);
    const defaults = base === undefined ? {} : index.args(base);
    const sorted: Record<string, JsonValue> = {};
    for (const arg of sortedKeys(props)) sorted[arg] = props[arg] as JsonValue;
    const same = sortedKeys(sorted).filter(
      (arg) => Object.hasOwn(defaults, arg) && sameJson(defaults[arg], sorted[arg]),
    );
    return { sid: component.sid, component, props: sorted, defaults: same };
  }

  /**
   * Overrides that no component property explains (15 §4.5 step 3) need the sublayers'
   * read-back, which the slice snapshot does not carry: they are listed as unknown changes.
   */
  private unexplainedOverrides(node: SnapNode, key: string): void {
    for (const override of node.instance?.overrides ?? []) {
      const sublayer = this.ctx.index.node(override.id.slice(override.id.lastIndexOf(';') + 1));
      const references = field(sublayer?.groups.bind, 'componentPropertyReferences');
      for (const name of [...override.fields].sort()) {
        if (isObject(references) && typeof references[name] === 'string') continue;
        this.findings.diagnostics.push(
          dcrDiagnostic('DCR_UNKNOWN_CHANGE', { nodeKey: key, property: `overrides.${name}` }),
        );
      }
    }
  }
}
