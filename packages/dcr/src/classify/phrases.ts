import type { JsonValue } from '@holotype/ir';
import { type FieldInfo, fieldInfo } from '../diff/field-info';
import { valueAt } from '../diff/index';
import type { TokenIndex, TokenValue } from '../diff/tokens';
import { rgbaOf } from '../diff/tokens';
import { asNumber, field, isObject } from '../identify/json';
import type { DcrChange, PartialNodeGroups } from '../schema';
import { ARROW, cssValue, figmaValue, roundPx } from './text';

/*
 * Field changes as words (15 §6 titles, §7.4 headlines). Changes that read as one are
 * grouped into a phrase: padding sides with the same before, after and tokens become
 * `padding left/right`, four equal corners become `corner radius`. The same grouping makes
 * one open question per phrase.
 */

export interface Phrase {
  readonly changes: readonly DcrChange[];
  /** Designer words, e.g. `padding left/right`. */
  readonly label: string;
  /** CSS words, e.g. `padding-left/right`. */
  readonly css: string;
  readonly info: FieldInfo;
  /** px a border-included padding adds over its CSS value (D-16); 0 elsewhere. */
  readonly offset: number;
}

const PADDING_ORDER = ['top', 'right', 'bottom', 'left'] as const;
const CORNER_ORDER = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;

/** The stroke width a padding side includes (D-16): an inside stroke outside the layout. */
export function borderOffset(groups: PartialNodeGroups, side: string | undefined): number {
  if (side === undefined) return 0;
  if (field(groups.layout, 'strokesIncludedInLayout') === true) return 0;
  const strokes = field(groups.paint, 'strokes');
  const visible = Array.isArray(strokes) && strokes.some((paint) => isObject(paint) && paint.visible !== false);
  if (!visible) return 0;
  const sideKey = `stroke${side.charAt(0).toUpperCase()}${side.slice(1)}Weight`;
  return asNumber(field(groups.paint, sideKey)) ?? asNumber(field(groups.paint, 'strokeWeight')) ?? 0;
}

const signature = (change: DcrChange, offset: number) =>
  JSON.stringify([change.before, change.after, change.token?.before, change.token?.after, offset]);

/** Groups the changes of one node into phrases, in field order. */
export function phrasesOf(changes: readonly DcrChange[], nodeType: string, after: PartialNodeGroups): Phrase[] {
  const phrases: Phrase[] = [];
  const families = new Map<string, DcrChange[]>();
  for (const change of changes) {
    const info = fieldInfo(change.field, nodeType);
    if (info.family === undefined) {
      phrases.push({ changes: [change], label: info.label, css: info.css, info, offset: 0 });
      continue;
    }
    const offset = info.family === 'padding' ? borderOffset(after, info.part) : 0;
    const key = `${info.family}\u0000${signature(change, offset)}`;
    const list = families.get(key);
    if (list) list.push(change);
    else {
      const created = [change];
      families.set(key, created);
      phrases.push({ changes: created, label: '', css: '', info, offset });
    }
  }
  return phrases.map((phrase) => (phrase.info.family === undefined ? phrase : named(phrase, nodeType)));
}

/** Names a family phrase from the parts it covers. */
function named(phrase: Phrase, nodeType: string): Phrase {
  const parts = new Set(phrase.changes.map((change) => fieldInfo(change.field, nodeType).part));
  if (phrase.info.family === 'padding') {
    const sides = PADDING_ORDER.filter((side) => parts.has(side));
    const pair =
      sides.length === 4
        ? ''
        : sides.join(',') === 'right,left'
          ? 'left/right'
          : sides.join(',') === 'top,bottom'
            ? 'top/bottom'
            : sides.join('/');
    return {
      ...phrase,
      label: pair ? `padding ${pair}` : 'padding',
      css: pair ? `padding-${pair}` : 'padding',
    };
  }
  const corners = CORNER_ORDER.filter((corner) => parts.has(corner));
  if (corners.length === 4) return { ...phrase, label: 'corner radius', css: 'border-radius' };
  if (corners.length === 1) return { ...phrase, label: phrase.info.label, css: phrase.info.css };
  return {
    ...phrase,
    label: `${corners.map((corner) => fieldInfo(`paint.${corner}Radius`, nodeType).label.replace(' radius', '')).join('/')} radius`,
    css: `border-${corners.map((corner) => fieldInfo(`paint.${corner}Radius`, nodeType).css.slice('border-'.length, -'-radius'.length)).join('/')}-radius`,
  };
}

/** The first change of a phrase: all its changes share before, after and tokens. */
const lead = (phrase: Phrase): DcrChange => phrase.changes[0] as DcrChange;

/** `padding-left/right 16 → 20`: CSS words and CSS values (border removed, colors in hex). */
export function codePhrase(phrase: Phrase): string {
  const change = lead(phrase);
  const { kind } = phrase.info;
  return `${phrase.css} ${cssValue(change.before, kind, phrase.offset)} ${ARROW} ${cssValue(change.after, kind, phrase.offset)}`;
}

/**
 * `padding left/right 17 → 21`, `corner radius 10 → 6 (card/radius → radius/md)`,
 * `fill button/bg → color/primary-active`: Figma words, Figma values, variables by Figma name.
 * Without `withTokens` the variable names are left out (the short form of headlines).
 */
export function designerPhrase(phrase: Phrase, tokens: TokenIndex, withTokens = true): string {
  const change = lead(phrase);
  const before = change.token?.before === undefined ? undefined : tokens.figmaName(change.token.before);
  const after = change.token?.after === undefined ? undefined : tokens.figmaName(change.token.after);
  if (phrase.info.kind === 'color') {
    const side = (value: JsonValue, token: string | undefined) => (withTokens && token ? token : figmaValue(value));
    return `${phrase.label} ${side(change.before, before)} ${ARROW} ${side(change.after, after)}`;
  }
  const values = `${phrase.label} ${figmaValue(change.before)} ${ARROW} ${figmaValue(change.after)}`;
  if (!withTokens || (before === undefined && after === undefined)) return values;
  return `${values} (${before ?? 'no variable'} ${ARROW} ${after ?? 'no variable'})`;
}

/** A raw value as a token can match it, in CSS terms (D-16 border removed). */
export function tokenValueOf(change: DcrChange, phrase: Phrase, after: PartialNodeGroups): TokenValue | undefined {
  const value = change.after;
  if (phrase.info.kind === 'color') {
    const opacity = asNumber(valueAt(after, change.field.replace(/\.color$/, '.opacity'))) ?? 1;
    const rgba = rgbaOf(value, opacity);
    return rgba ? { kind: 'COLOR', rgba } : undefined;
  }
  if (typeof value === 'number') return { kind: 'FLOAT', value: roundPx(value - phrase.offset) };
  if (phrase.info.kind === 'length' && field(value, 'unit') === 'PIXELS') {
    const amount = asNumber(field(value, 'value'));
    return amount === undefined ? undefined : { kind: 'FLOAT', value: amount };
  }
  return undefined;
}
