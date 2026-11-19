/*
 * Text extraction for one text block (05 §4.1–4.2): characters as rendered, styled runs and
 * the browser's line boxes.
 */
import type { CText, Rect } from '@holotype/ir';
import { px, toPageRect, unionRects } from '../css';
import type { CollectContext, TextBlock } from '../types';
import { assembleText, type MeasuredToken, type TokenStyle } from './assemble';
import { usedLineHeight } from './line-height';
import { groupLines } from './lines';
import { textStyleOf } from './style';
import { tokenize, whiteSpaceCollapseOf } from './whitespace';

export interface ExtractedText {
  readonly text: CText;
  /** Union of the line boxes, page space. */
  readonly borderBox: Rect;
}

/** Resolves `text-align: start | end` (and the `-webkit-` forms) through `direction`. */
export function resolveTextAlign(textAlign: string, direction: string): CText['textAlign'] {
  const rtl = direction === 'rtl';
  switch (textAlign) {
    case 'left':
    case '-webkit-left':
      return 'left';
    case 'right':
    case '-webkit-right':
      return 'right';
    case 'center':
    case '-webkit-center':
      return 'center';
    case 'justify':
      return 'justify';
    case 'end':
      return rtl ? 'left' : 'right';
    default:
      return rtl ? 'right' : 'left';
  }
}

/** `wrap` from `text-wrap-mode` and `text-wrap-style` (05 §4.2). */
export function wrapOf(style: CSSStyleDeclaration): CText['wrap'] {
  if (style.getPropertyValue('text-wrap-mode') === 'nowrap') return 'nowrap';
  const wrapStyle = style.getPropertyValue('text-wrap-style');
  return wrapStyle === 'balance' || wrapStyle === 'pretty' ? wrapStyle : 'wrap';
}

function lineClampOf(style: CSSStyleDeclaration): number | null {
  const clamp = Number.parseInt(style.getPropertyValue('-webkit-line-clamp'), 10);
  return Number.isInteger(clamp) && clamp >= 1 ? clamp : null;
}

/**
 * Measures a block's tokens (05 §4.1): one Range per word and per whitespace character; a
 * word whose Range has more than one client rect straddles a line break and is measured per
 * character (code point).
 */
function measureTokens(block: TextBlock, context: CollectContext, nodeId: string): MeasuredToken[] {
  const { doc } = context;
  const probes = context.memo('text:line-height', () => new Map<string, number>());
  const styles = context.memo('text:token-style', () => new Map<Element, TokenStyle>());
  const styleFor = (owner: Element, style: CSSStyleDeclaration): TokenStyle => {
    let tokenStyle = styles.get(owner);
    if (tokenStyle === undefined) {
      const lineHeight = usedLineHeight(style, doc, probes);
      const styleId = context.internTextStyle(textStyleOf(style, lineHeight, context, nodeId));
      tokenStyle = { styleId, lineHeight: lineHeight.px };
      styles.set(owner, tokenStyle);
    }
    return tokenStyle;
  };

  const tokens: MeasuredToken[] = [];
  const range = doc.createRange();
  const rectsOf = (node: Text, start: number, end: number) => {
    range.setStart(node, start);
    range.setEnd(node, end);
    return [...range.getClientRects()].map(toPageRect);
  };
  for (const item of block.items) {
    if (item.kind === 'break') {
      const rects = [...item.node.getClientRects()].map(toPageRect);
      tokens.push({ kind: 'break', rects, style: styleFor(item.node, item.style) });
      continue;
    }
    const { node, owner } = item;
    const style = styleFor(owner, item.style);
    const collapse = whiteSpaceCollapseOf(item.style);
    const data = node.data;
    for (const token of tokenize(data)) {
      const rects = rectsOf(node, token.start, token.end);
      if (token.whitespace) {
        tokens.push({ kind: 'space', char: data.charAt(token.start), rects, style, collapse });
      } else if (rects.length <= 1) {
        tokens.push({ kind: 'word', text: data.slice(token.start, token.end), rects, style });
      } else {
        let offset = token.start;
        for (const char of data.slice(token.start, token.end)) {
          tokens.push({ kind: 'word', text: char, rects: rectsOf(node, offset, offset + char.length), style });
          offset += char.length;
        }
      }
    }
  }
  range.detach();
  return tokens;
}

/**
 * Extracts the text of a block: `null` when nothing renders (a whitespace-only block). Text
 * styles are interned in `context`; runs refer to their page-local ids.
 */
export function extractText(block: TextBlock, context: CollectContext, nodeId: string): ExtractedText | null {
  const { characters, runs, pieces } = assembleText(measureTokens(block, context, nodeId));
  if (characters === '') return null;
  const lines = groupLines(pieces);
  const borderBox = unionRects(lines.map((line) => ({ x: line.left, y: line.top, w: line.width, h: line.height })));
  if (borderBox === null) return null;

  const { containerStyle: style } = block;
  return {
    borderBox,
    text: {
      characters,
      runs,
      lines,
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      lineClamp: lineClampOf(style),
      wrap: wrapOf(style),
      textAlign: resolveTextAlign(style.textAlign, style.direction),
      indent: px(style.textIndent),
    },
  };
}
