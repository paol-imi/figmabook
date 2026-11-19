/*
 * Step 7, text content (09 §6.1): base font first (loaded during preparation), characters
 * before ranges (replacing characters drops range styles), range styles, paragraph
 * settings, and sizing last (text `resize()` implies a fixed width). Line-count parity with
 * `widthBuffer` is B-55; OpenType features are not writable and the mapper already reported
 * them (`TEXT_OPENTYPE_UNSUPPORTED`).
 */
import type { SceneText, SceneTextRange } from '@holotype/ir';
import { toPaint, toPaints } from '../paints';
import type { Resources } from '../resources';
import { atLeastMin, type NodeWriter } from './types';

/** `createText()` starts in Inter Regular; used for an empty text without ranges. */
const DEFAULT_FONT: FontName = { family: 'Inter', style: 'Regular' };

export const textWriter: NodeWriter = {
  name: 'text',
  step: 7,
  write({ node, scene, box }, { resources }) {
    if (node.type !== 'TEXT' || scene.text === undefined) return;
    const text = scene.text;
    const [first] = text.ranges;
    node.fontName = first ? resources.font(first.font) : DEFAULT_FONT;
    node.characters = text.characters;
    if (text.characters.length === 0) {
      if (first) writeNodeStyle(node, first);
    } else {
      for (const range of text.ranges) writeRange(node, range, text.characters.length, resources);
    }
    writeParagraph(node, text);
    writeSizing(node, text, box);
  },
};

function writeRange(node: TextNode, range: SceneTextRange, length: number, resources: Resources): void {
  const start = Math.min(range.start, length);
  const end = Math.min(range.end, length);
  if (start >= end) return;
  node.setRangeFontName(start, end, resources.font(range.font));
  node.setRangeFontSize(start, end, range.fontSize);
  node.setRangeLineHeight(start, end, { unit: 'PIXELS', value: range.lineHeight.value }); // D-17: never AUTO
  node.setRangeLetterSpacing(start, end, { unit: 'PIXELS', value: range.letterSpacing.value });
  node.setRangeFills(start, end, toPaints(range.fills, resources.imageHash));
  if (range.textCase !== 'ORIGINAL') node.setRangeTextCase(start, end, range.textCase);
  if (range.decoration !== 'NONE') {
    node.setRangeTextDecoration(start, end, range.decoration);
    if (range.decorationStyle) node.setRangeTextDecorationStyle(start, end, range.decorationStyle);
    const color = range.decorationColor && toPaint(range.decorationColor, resources.imageHash);
    if (color?.type === 'SOLID') node.setRangeTextDecorationColor(start, end, { value: color });
    if (range.decorationThickness !== undefined) {
      node.setRangeTextDecorationThickness(start, end, { unit: 'PIXELS', value: range.decorationThickness });
    }
    if (range.decorationOffset !== undefined) {
      node.setRangeTextDecorationOffset(start, end, { unit: 'PIXELS', value: range.decorationOffset });
    }
  }
  if (range.hyperlink) node.setRangeHyperlink(start, end, { type: 'URL', value: range.hyperlink });
}

/** An empty text has no ranges to style: its first range's style goes on the node. */
function writeNodeStyle(node: TextNode, range: SceneTextRange): void {
  node.fontSize = range.fontSize;
  node.lineHeight = { unit: 'PIXELS', value: range.lineHeight.value };
  node.letterSpacing = { unit: 'PIXELS', value: range.letterSpacing.value };
}

function writeParagraph(node: TextNode, text: SceneText): void {
  node.textAlignHorizontal = text.alignH;
  node.textAlignVertical = text.alignV;
  if (text.paragraphSpacing) node.paragraphSpacing = text.paragraphSpacing;
  if (text.paragraphIndent) node.paragraphIndent = text.paragraphIndent;
  if (text.leadingTrim) node.leadingTrim = text.leadingTrim;
  if (text.wrapStyle) node.textWrapStyle = text.wrapStyle;
}

/**
 * Sizing last. Allowed: `WIDTH_AND_HEIGHT`, `HEIGHT`, `NONE`; the deprecated `TRUNCATE` is
 * never written: it becomes `NONE` with ending truncation, like `truncation`.
 */
function writeSizing(node: TextNode, text: SceneText, box: { readonly w: number; readonly h: number }): void {
  const truncate = text.truncation !== undefined || text.autoResize === 'TRUNCATE';
  if (text.autoResize === 'WIDTH_AND_HEIGHT' && !truncate) {
    node.textAutoResize = 'WIDTH_AND_HEIGHT';
    return;
  }
  node.resize(atLeastMin(box.w), atLeastMin(box.h));
  node.textAutoResize = text.autoResize === 'HEIGHT' && !truncate ? 'HEIGHT' : 'NONE';
  if (truncate) {
    node.textTruncation = 'ENDING';
    if (text.truncation) node.maxLines = text.truncation.maxLines;
  }
}
