import {
  type CaptureDoc,
  type CText,
  type CTextStyle,
  canonicalJSON,
  type MapperSettings,
  type SceneText,
  type SceneTextRange,
  sceneNumKind,
} from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { solidPaint } from '../color';
import { sameColor } from '../css';
import { addOnce, mapperFailure, plainDiagnostic } from '../diagnostics';
import { type WorkNode, walkWork } from '../state';
import { fitText } from '../text/fit';
import { fontRequest } from '../text/font';
import { lockLines } from '../text/locked-lines';
import { textShadowEffects } from '../text/shadow';
import { reportUnsupported } from '../visuals/unsupported';
import type { VariantStage } from './types';

/*
 * Stage 6, text (07 §8): each captured text block becomes one TEXT node. Its runs become
 * ranges, and adjacent ranges whose Scene form is identical are merged. `text-shadow`
 * becomes node effects.
 */

type ColorProfile = MapperSettings['mapper']['colorProfile'];
type Range = Omit<SceneTextRange, 'start' | 'end'>;

const TEXT_CASE: Readonly<Record<CTextStyle['transform'], SceneTextRange['textCase']>> = {
  none: 'ORIGINAL',
  uppercase: 'UPPER',
  lowercase: 'LOWER',
  capitalize: 'TITLE',
};

const DECORATION_STYLE: Readonly<Record<string, NonNullable<SceneTextRange['decorationStyle']>>> = {
  solid: 'SOLID',
  wavy: 'WAVY',
  dotted: 'DOTTED',
};

function decoration(style: CTextStyle, range: Range, profile: ColorProfile, notes: Diagnostic[]): Range {
  const lines = style.decoration?.lines ?? [];
  if (style.decoration === undefined || lines.length === 0) return range;
  if (lines.includes('overline')) reportUnsupported(notes, 'text-decoration-line', 'overline');
  const line = lines.includes('underline') ? 'UNDERLINE' : lines.includes('line-through') ? 'STRIKETHROUGH' : undefined;
  if (line === undefined) return range;
  if (line === 'UNDERLINE' && lines.includes('line-through')) {
    reportUnsupported(notes, 'text-decoration-line', 'line-through');
  }
  const { style: lineStyle, color, thicknessPx, offsetPx } = style.decoration;
  const mappedStyle = DECORATION_STYLE[lineStyle];
  if (mappedStyle === undefined) {
    notes.push(
      plainDiagnostic('TEXT_DECORATION_STYLE_APPROX', {
        property: 'text-decoration-style',
        value: lineStyle,
        fallback: 'solid',
      }),
    );
  }
  // Figma draws the decoration in the text color unless told otherwise, as CSS does.
  const ownColor = !sameColor(color, style.color);
  return {
    ...range,
    decoration: line,
    decorationStyle: mappedStyle ?? 'SOLID',
    ...(ownColor ? { decorationColor: solidPaint(color, profile, notes, 'text-decoration-color') } : {}),
    ...(thicknessPx === undefined ? {} : { decorationThickness: thicknessPx }),
    ...(offsetPx === undefined ? {} : { decorationOffset: offsetPx }),
  };
}

/** The Scene form of one run's style (07 §8.2). */
function rangeStyle(style: CTextStyle, href: string | undefined, profile: ColorProfile, notes: Diagnostic[]): Range {
  if (style.wordSpacingPx !== 0) {
    notes.push(
      plainDiagnostic('TEXT_WORD_SPACING_DROPPED', { property: 'word-spacing', value: `${style.wordSpacingPx}px` }),
    );
  }
  let range: Range = {
    font: fontRequest(style),
    fontSize: style.size,
    lineHeight: { unit: 'PIXELS', value: style.lineHeightPx },
    letterSpacing: { unit: 'PIXELS', value: style.letterSpacingPx },
    textCase: style.smallCaps && style.transform === 'none' ? 'SMALL_CAPS' : TEXT_CASE[style.transform],
    decoration: 'NONE',
    fills: [solidPaint(style.color, profile, notes, 'color')],
  };
  if (href !== undefined) range.hyperlink = href;
  const features = Object.entries(style.features ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (features.length > 0) {
    // Not writable through the Plugin API: kept as information only (07 §8.2).
    range.openTypeFeatures = Object.fromEntries(features.map(([tag, value]) => [tag, value !== 0]));
    notes.push(
      plainDiagnostic('TEXT_OPENTYPE_UNSUPPORTED', {
        property: 'font-feature-settings',
        value: features.map(([tag, value]) => `${tag} ${value}`).join(', '),
      }),
    );
  }
  range = decoration(style, range, profile, notes);
  return range;
}

/** Runs → ranges; adjacent ranges with the same Scene fields are merged (07 §8.1). */
function textRanges(
  node: WorkNode,
  text: CText,
  capture: CaptureDoc,
  profile: ColorProfile,
  notes: Diagnostic[],
): SceneTextRange[] {
  const sid = capture.target.sid;
  const ranges: SceneTextRange[] = [];
  let expected = 0;
  for (const run of [...text.runs].sort((a, b) => a.start - b.start)) {
    const style = capture.textStyles[run.styleId];
    if (style === undefined) {
      throw mapperFailure(sid, `text node ${node.capture.id} uses unknown text style "${run.styleId}"`);
    }
    if (run.start !== expected || run.end <= run.start) {
      throw mapperFailure(sid, `the text runs of node ${node.capture.id} do not tile its characters`);
    }
    expected = run.end;
    if (run.gradientFrom !== undefined) reportUnsupported(notes, 'background-clip', 'text');
    const fields = rangeStyle(style, run.href, profile, notes);
    const previous = ranges.at(-1);
    if (previous && sameRange(previous, fields)) {
      ranges[ranges.length - 1] = { ...previous, end: run.end };
    } else {
      ranges.push({ start: run.start, end: run.end, ...fields });
    }
  }
  if (expected !== text.characters.length) {
    throw mapperFailure(sid, `the text runs of node ${node.capture.id} do not cover its characters`);
  }
  return ranges;
}

function sameRange(a: SceneTextRange, b: Range): boolean {
  const { start: _start, end: _end, ...rest } = a;
  return canonicalJSON(rest, { numKind: sceneNumKind }) === canonicalJSON(b, { numKind: sceneNumKind });
}

const ALIGN_H: Readonly<Record<CText['textAlign'], SceneText['alignH']>> = {
  left: 'LEFT',
  center: 'CENTER',
  right: 'RIGHT',
  justify: 'JUSTIFIED',
};

function mapText(node: WorkNode, capture: CaptureDoc, settings: MapperSettings, notes: Diagnostic[]): SceneText {
  const text = node.capture.text;
  if (text === undefined) throw mapperFailure(capture.target.sid, `text node ${node.capture.id} has no text`);
  const ranges = textRanges(node, text, capture, settings.mapper.colorProfile, notes);
  const lines = text.lines.map((line) => ({ startChar: line.startChar, endChar: line.endChar }));
  const fontSize = Math.max(...ranges.map((range) => range.fontSize));
  const wrapMode = settings.textMode;
  const locked =
    wrapMode === 'locked-lines'
      ? lockLines(text.characters, ranges, lines)
      : { characters: text.characters, ranges, lines };
  const scene: SceneText = {
    characters: locked.characters,
    ...fitText(text, node.box),
    alignH: ALIGN_H[text.textAlign],
    ranges: locked.ranges,
    lines: locked.lines,
    wrapMode,
    // The plugin may widen the box up to this to restore line parity (07 §8.5, S-04).
    widthBuffer: { max: Math.min(4, 0.25 * fontSize) },
  };
  if (text.indent !== 0) scene.paragraphIndent = text.indent;
  if (text.wrap === 'balance') scene.wrapStyle = 'BALANCE';
  if (text.wrap === 'pretty') scene.wrapStyle = 'PRETTY';
  return scene;
}

export const textStage: VariantStage = {
  step: 6,
  name: 'text',
  per: 'variant',
  run(variant, component) {
    for (const node of walkWork(variant.root)) {
      if (node.kind !== 'text') continue;
      const notes: Diagnostic[] = [];
      const { config } = component.input;
      node.fields.text = mapText(node, variant.capture, config, notes);
      const effects =
        node.capture.text && textShadowEffects(node.capture.text, variant.capture, config.mapper.colorProfile, notes);
      if (effects) node.fields.effects = effects;
      for (const note of notes) addOnce(node.diagnostics, note);
    }
  },
};
