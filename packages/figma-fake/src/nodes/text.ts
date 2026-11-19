import { figmaError, setterName, unsupported } from '../errors';
import { fontLabel, fontStyleOf, fontWeightOf } from '../fonts';
import { MIXED, type Mixed } from '../mixed';
import { type HasState, live, type NodeState } from '../state';
import type { CharStyle, StyleField, TextModel } from '../text-model';
import { checkBoolean, checkEnum, checkNumber, checkString, deepFreeze, normalizePaints } from '../values';
import type { Ctor } from './core';
import { pick } from './pick';

const TEXT_CASES = ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'] as const;
const DECORATIONS = ['NONE', 'UNDERLINE', 'STRIKETHROUGH'] as const;
const DECORATION_STYLES = ['SOLID', 'WAVY', 'DOTTED'] as const;

function model(state: NodeState): TextModel {
  if (!state.text) throw new Error(`figma-fake internal error: ${state.id} is not a text node`);
  return state.text;
}

/**
 * Writes that can change rendered text need every affected font loaded: "Calling this function
 * is **necessary** to modify any property of a text node that may cause the rendered text to
 * change, including `.characters`, `.fontSize`, `.fontName`, etc." (typings:1662-1670;
 * https://developers.figma.com/docs/plugins/working-with-text lists characters, fontSize,
 * fontName, textStyleId, textCase, textDecoration, letterSpacing, leadingTrim, lineHeight and
 * the matching setRange* methods; typings:11019-11027 add textAlignHorizontal,
 * textAlignVertical and textAutoResize). The message follows Figma's.
 */
export function requireFonts(api: string, state: NodeState, fonts: readonly FontName[]): void {
  for (const font of fonts) {
    if (!state.ctx.fonts.isLoaded(font)) {
      throw figmaError(
        api,
        `Cannot write to node with unloaded font "${fontLabel(font)}". Please call figma.loadFontAsync({ family: "${font.family}", style: "${font.style}" }) and await the returned promise first.`,
      );
    }
  }
}

function requireNodeFonts(api: string, state: NodeState): TextModel {
  const text = model(state);
  requireFonts(api, state, text.fonts());
  return text;
}

/** `start` inclusive, `end` exclusive, inside the text (typings:9877-9890). */
function checkRange(api: string, text: TextModel, start: number, end: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.characters.length || start >= end) {
    throw figmaError(api, `Range [${start}, ${end}) is outside of the ${text.characters.length} available characters`);
  }
}

/** Resolves a `FontNameInput` to a `FontName`; an omitted style means "Regular" here (typings:4069-4090). */
function toFontName(api: string, value: FontNameInput): FontName {
  if (typeof value !== 'object' || value === null) throw figmaError(api, 'Expected a font name object');
  checkString(api, 'family', value.family);
  if (value.style !== undefined) checkString(api, 'style', value.style);
  return deepFreeze({ family: value.family, style: value.style ?? 'Regular' });
}

function checkLetterSpacing(api: string, value: LetterSpacing): LetterSpacing {
  checkEnum(api, 'unit', value?.unit, ['PIXELS', 'PERCENT']);
  return { value: checkNumber(api, 'value', value.value), unit: value.unit };
}

function checkLineHeight(api: string, value: LineHeight): LineHeight {
  const unit = checkEnum(api, 'unit', value?.unit, ['PIXELS', 'PERCENT', 'AUTO']);
  if (unit === 'AUTO' || value.unit === 'AUTO') return { unit: 'AUTO' };
  return { value: checkNumber(api, 'value', value.value, 0), unit: value.unit };
}

function checkHyperlink(api: string, value: HyperlinkTarget | null): HyperlinkTarget | null {
  if (value === null) return null;
  return { type: checkEnum(api, 'type', value?.type, ['URL', 'NODE']), value: checkString(api, 'value', value.value) };
}

/** `fontSize` "Has minimum value of 1" (typings:9772-9775). */
function checkFontSize(api: string, value: number): number {
  return checkNumber(api, 'fontSize', value, 1);
}

function getNode<K extends StyleField>(node: HasState, field: K): CharStyle[K] | Mixed {
  return model(live(node)).uniform(field) ?? MIXED;
}

function setNode<K extends StyleField>(node: HasState, property: string, field: K, value: CharStyle[K]): void {
  const state = live(node);
  const text = requireNodeFonts(setterName(property), state);
  text.setRange(field, 0, text.characters.length, value);
  state.ctx.record(state, 'set', property, value);
}

function getRange<K extends StyleField>(
  node: HasState,
  api: string,
  field: K,
  start: number,
  end: number,
): CharStyle[K] | Mixed {
  const text = model(live(node));
  checkRange(api, text, start, end);
  return text.uniform(field, start, end) ?? MIXED;
}

function setRange<K extends StyleField>(
  node: HasState,
  api: string,
  field: K,
  start: number,
  end: number,
  value: CharStyle[K],
  needsFont = true,
): void {
  const state = live(node);
  const text = model(state);
  checkRange(api, text, start, end);
  if (needsFont) requireFonts(api, state, text.fonts(start, end));
  text.setRange(field, start, end, value);
  state.ctx.record(state, api, null, { start, end, value });
}

/** Decoration details read as `null` on text that is not decorated (typings:5602-5622). */
function decorated<T>(node: HasState, value: T | Mixed, start?: number, end?: number): T | Mixed | null {
  const text = model(live(node));
  const decoration = text.uniform('textDecoration', start, end);
  return decoration === 'NONE' ? null : value;
}

function segmentOf(state: NodeState, text: TextModel, start: number, end: number): StyledTextSegment {
  const style = text.styleAt(start);
  const underlined = style.textDecoration !== 'NONE';
  return {
    characters: text.characters.slice(start, end),
    start,
    end,
    fontSize: style.fontSize,
    fontName: style.fontName,
    fontWeight: fontWeightOf(style.fontName),
    fontStyle: fontStyleOf(style.fontName),
    textDecoration: style.textDecoration,
    textDecorationStyle: underlined ? style.textDecorationStyle : null,
    textDecorationOffset: underlined ? style.textDecorationOffset : null,
    textDecorationThickness: underlined ? style.textDecorationThickness : null,
    textDecorationColor: underlined ? style.textDecorationColor : null,
    textDecorationSkipInk: underlined ? style.textDecorationSkipInk : null,
    textCase: style.textCase,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    fills: [...style.fills],
    textStyleId: '',
    fillStyleId: '',
    listOptions: { type: 'NONE' },
    listSpacing: state.listSpacing,
    indentation: 0,
    paragraphIndent: state.paragraphIndent,
    paragraphSpacing: state.paragraphSpacing,
    textWrapStyle: state.textWrapStyle,
    hyperlink: style.hyperlink,
    get openTypeFeatures(): StyledTextSegment['openTypeFeatures'] {
      return unsupported('StyledTextSegment.openTypeFeatures');
    },
    boundVariables: {},
    textStyleOverrides: [],
  };
}

/** Segment fields the fake splits on; the rest are node-level here (README "Differences"). */
const SEGMENT_FIELDS: Readonly<Record<string, StyleField | null>> = {
  fontSize: 'fontSize',
  fontName: 'fontName',
  fontWeight: 'fontName',
  fontStyle: 'fontName',
  textDecoration: 'textDecoration',
  textDecorationStyle: 'textDecorationStyle',
  textDecorationOffset: 'textDecorationOffset',
  textDecorationThickness: 'textDecorationThickness',
  textDecorationColor: 'textDecorationColor',
  textDecorationSkipInk: 'textDecorationSkipInk',
  textCase: 'textCase',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  fills: 'fills',
  hyperlink: 'hyperlink',
};

/** A text node property stored on the node (not per character) that needs loaded fonts. */
function setLayoutText<K extends 'paragraphIndent' | 'paragraphSpacing' | 'listSpacing'>(
  node: HasState,
  field: K,
  value: number,
): void {
  const state = live(node);
  const api = setterName(field);
  requireNodeFonts(api, state);
  state[field] = checkNumber(api, field, value, 0);
  state.ctx.record(state, 'set', field, value);
}

/**
 * `BaseNonResizableTextMixin`, `NonResizableTextMixin` and the `TextNode` own members
 * (typings:9767-10460, 11002-11070).
 */
export function WithText<B extends Ctor>(Base: B) {
  return class extends Base implements NonResizableTextMixin {
    /** True when the node uses a font the editor does not have (typings:9769-9771). */
    get hasMissingFont(): boolean {
      const state = live(this);
      return model(state)
        .fonts()
        .some((font) => !state.ctx.fonts.isAvailable(font));
    }

    get characters(): string {
      return model(live(this)).characters;
    }

    /**
     * Requires the fonts to be loaded; resets range styles; renames the node while `autoRename`
     * is true (typings:9861-9867).
     */
    set characters(value: string) {
      const state = live(this);
      checkString('set_characters', 'characters', value);
      const text = requireNodeFonts('set_characters', state);
      text.replace(value);
      if (state.autoRename) state.name = value;
      state.ctx.record(state, 'set', 'characters', value);
    }

    insertCharacters(start: number, characters: string, useStyle: 'BEFORE' | 'AFTER' = 'BEFORE'): void {
      const state = live(this);
      const api = 'insertCharacters';
      checkString(api, 'characters', characters);
      const text = requireNodeFonts(api, state);
      if (!Number.isInteger(start) || start < 0 || start > text.characters.length) {
        throw figmaError(api, `Index ${start} is outside of the ${text.characters.length} available characters`);
      }
      text.insert(start, characters, useStyle);
      if (state.autoRename) state.name = text.characters;
      state.ctx.record(state, api, null, { start, characters, useStyle });
    }

    deleteCharacters(start: number, end: number): void {
      const state = live(this);
      const api = 'deleteCharacters';
      const text = requireNodeFonts(api, state);
      checkRange(api, text, start, end);
      text.delete(start, end);
      if (state.autoRename) state.name = text.characters;
      state.ctx.record(state, api, null, { start, end });
    }

    get fontSize(): number | Mixed {
      return getNode(this, 'fontSize');
    }

    set fontSize(value: number | Mixed) {
      setNode(
        this,
        'fontSize',
        'fontSize',
        checkFontSize('set_fontSize', checkNumber('set_fontSize', 'fontSize', value)),
      );
    }

    get fontName(): FontName | Mixed {
      return getNode(this, 'fontName');
    }

    /** "Setting this property to a different value requires the new font to be loaded" (typings:9776-9790). */
    set fontName(value: FontName | Mixed) {
      const state = live(this);
      const api = 'set_fontName';
      if (value === MIXED) throw figmaError(api, 'Cannot set fontName to figma.mixed');
      const font = toFontName(api, value);
      requireFonts(api, state, [font]);
      const text = model(state);
      text.setRange('fontName', 0, text.characters.length, font);
      state.ctx.record(state, 'set', 'fontName', font);
    }

    get fontWeight(): number | Mixed {
      const font = getNode(this, 'fontName');
      return font === MIXED ? MIXED : fontWeightOf(font);
    }

    get textCase(): TextCase | Mixed {
      return getNode(this, 'textCase');
    }

    set textCase(value: TextCase | Mixed) {
      setNode(this, 'textCase', 'textCase', checkEnum('set_textCase', 'textCase', value, TEXT_CASES));
    }

    /** OpenType features are verified by spike S-04 and modelled in B-54. */
    get openTypeFeatures(): { readonly [feature in OpenTypeFeature]: boolean } | Mixed {
      return unsupported('TextNode.openTypeFeatures');
    }

    get letterSpacing(): LetterSpacing | Mixed {
      return getNode(this, 'letterSpacing');
    }

    set letterSpacing(value: LetterSpacing | Mixed) {
      if (value === MIXED) throw figmaError('set_letterSpacing', 'Cannot set letterSpacing to figma.mixed');
      setNode(this, 'letterSpacing', 'letterSpacing', checkLetterSpacing('set_letterSpacing', value));
    }

    get hyperlink(): HyperlinkTarget | null | Mixed {
      return getNode(this, 'hyperlink');
    }

    set hyperlink(value: HyperlinkTarget | null | Mixed) {
      if (value === MIXED) throw figmaError('set_hyperlink', 'Cannot set hyperlink to figma.mixed');
      const state = live(this);
      const text = model(state);
      text.setRange('hyperlink', 0, text.characters.length, checkHyperlink('set_hyperlink', value));
      state.ctx.record(state, 'set', 'hyperlink', value);
    }

    get lineHeight(): LineHeight | Mixed {
      return getNode(this, 'lineHeight');
    }

    set lineHeight(value: LineHeight | Mixed) {
      if (value === MIXED) throw figmaError('set_lineHeight', 'Cannot set lineHeight to figma.mixed');
      setNode(this, 'lineHeight', 'lineHeight', checkLineHeight('set_lineHeight', value));
    }

    get textDecoration(): TextDecoration | Mixed {
      return getNode(this, 'textDecoration');
    }

    set textDecoration(value: TextDecoration | Mixed) {
      setNode(
        this,
        'textDecoration',
        'textDecoration',
        checkEnum('set_textDecoration', 'textDecoration', value, DECORATIONS),
      );
    }

    get textDecorationStyle(): TextDecorationStyle | Mixed | null {
      return decorated(this, getNode(this, 'textDecorationStyle'));
    }

    set textDecorationStyle(value: TextDecorationStyle | Mixed | null) {
      const style = checkEnum('set_textDecorationStyle', 'textDecorationStyle', value, DECORATION_STYLES);
      setNode(this, 'textDecorationStyle', 'textDecorationStyle', style);
    }

    get textDecorationOffset(): TextDecorationOffset | Mixed | null {
      return decorated(this, getNode(this, 'textDecorationOffset'));
    }

    set textDecorationOffset(value: TextDecorationOffset | Mixed | null) {
      if (value === MIXED || value === null) throw figmaError('set_textDecorationOffset', 'Expected an offset object');
      setNode(this, 'textDecorationOffset', 'textDecorationOffset', deepFreeze({ ...value }));
    }

    get textDecorationThickness(): TextDecorationThickness | Mixed | null {
      return decorated(this, getNode(this, 'textDecorationThickness'));
    }

    set textDecorationThickness(value: TextDecorationThickness | Mixed | null) {
      if (value === MIXED || value === null)
        throw figmaError('set_textDecorationThickness', 'Expected a thickness object');
      setNode(this, 'textDecorationThickness', 'textDecorationThickness', deepFreeze({ ...value }));
    }

    get textDecorationColor(): TextDecorationColor | Mixed | null {
      return decorated(this, getNode(this, 'textDecorationColor'));
    }

    set textDecorationColor(value: TextDecorationColor | Mixed | null) {
      if (value === MIXED || value === null) throw figmaError('set_textDecorationColor', 'Expected a color object');
      setNode(this, 'textDecorationColor', 'textDecorationColor', deepFreeze({ ...value }));
    }

    get textDecorationSkipInk(): boolean | Mixed | null {
      return decorated(this, getNode(this, 'textDecorationSkipInk'));
    }

    set textDecorationSkipInk(value: boolean | Mixed | null) {
      setNode(
        this,
        'textDecorationSkipInk',
        'textDecorationSkipInk',
        checkBoolean('set_textDecorationSkipInk', 'textDecorationSkipInk', value),
      );
    }

    get paragraphIndent(): number | Mixed {
      return live(this).paragraphIndent;
    }

    set paragraphIndent(value: number | Mixed) {
      setLayoutText(this, 'paragraphIndent', checkNumber('set_paragraphIndent', 'paragraphIndent', value));
    }

    get paragraphSpacing(): number | Mixed {
      return live(this).paragraphSpacing;
    }

    set paragraphSpacing(value: number | Mixed) {
      setLayoutText(this, 'paragraphSpacing', checkNumber('set_paragraphSpacing', 'paragraphSpacing', value));
    }

    get listSpacing(): number | Mixed {
      return live(this).listSpacing;
    }

    set listSpacing(value: number | Mixed) {
      setLayoutText(this, 'listSpacing', checkNumber('set_listSpacing', 'listSpacing', value));
    }

    get textWrapStyle(): TextWrapStyle | Mixed {
      return live(this).textWrapStyle;
    }

    set textWrapStyle(value: TextWrapStyle | Mixed) {
      const state = live(this);
      const api = 'set_textWrapStyle';
      requireNodeFonts(api, state);
      state.textWrapStyle = checkEnum(api, 'textWrapStyle', value, ['AUTO', 'BALANCE', 'PRETTY']);
      state.ctx.record(state, 'set', 'textWrapStyle', value);
    }

    get leadingTrim(): LeadingTrim | Mixed {
      return live(this).leadingTrim;
    }

    set leadingTrim(value: LeadingTrim | Mixed) {
      const state = live(this);
      const api = 'set_leadingTrim';
      requireNodeFonts(api, state);
      state.leadingTrim = checkEnum(api, 'leadingTrim', value, ['CAP_HEIGHT', 'NONE']); // diag-check-ignore: Figma enum, not a diagnostic
      state.ctx.record(state, 'set', 'leadingTrim', value);
    }

    get hangingPunctuation(): boolean {
      return live(this).hangingPunctuation;
    }

    set hangingPunctuation(value: boolean) {
      const state = live(this);
      requireNodeFonts('set_hangingPunctuation', state);
      state.hangingPunctuation = checkBoolean('set_hangingPunctuation', 'hangingPunctuation', value);
      state.ctx.record(state, 'set', 'hangingPunctuation', value);
    }

    get hangingList(): boolean {
      return live(this).hangingList;
    }

    set hangingList(value: boolean) {
      const state = live(this);
      requireNodeFonts('set_hangingList', state);
      state.hangingList = checkBoolean('set_hangingList', 'hangingList', value);
      state.ctx.record(state, 'set', 'hangingList', value);
    }

    // Range getters and setters.

    getRangeFontSize(start: number, end: number): number | Mixed {
      return getRange(this, 'getRangeFontSize', 'fontSize', start, end);
    }

    setRangeFontSize(start: number, end: number, value: number): void {
      setRange(this, 'setRangeFontSize', 'fontSize', start, end, checkFontSize('setRangeFontSize', value));
    }

    getRangeFontName(start: number, end: number): FontName | Mixed {
      return getRange(this, 'getRangeFontName', 'fontName', start, end);
    }

    /** "Requires the new font to be loaded" (typings:9895-9905). */
    setRangeFontName(start: number, end: number, value: FontNameInput): void {
      const state = live(this);
      const api = 'setRangeFontName';
      const font = toFontName(api, value);
      checkRange(api, model(state), start, end);
      requireFonts(api, state, [font]);
      setRange(this, api, 'fontName', start, end, font, false);
    }

    getRangeFontWeight(start: number, end: number): number | Mixed {
      const font = getRange(this, 'getRangeFontWeight', 'fontName', start, end);
      return font === MIXED ? MIXED : fontWeightOf(font);
    }

    getRangeAllFontNames(start: number, end: number): FontName[] {
      const text = model(live(this));
      checkRange('getRangeAllFontNames', text, start, end);
      return text.fonts(start, end);
    }

    getRangeTextCase(start: number, end: number): TextCase | Mixed {
      return getRange(this, 'getRangeTextCase', 'textCase', start, end);
    }

    setRangeTextCase(start: number, end: number, value: TextCase): void {
      const api = 'setRangeTextCase';
      setRange(this, api, 'textCase', start, end, checkEnum(api, 'textCase', value, TEXT_CASES));
    }

    getRangeOpenTypeFeatures(start: number, end: number): { readonly [feature in OpenTypeFeature]: boolean } | Mixed {
      checkRange('getRangeOpenTypeFeatures', model(live(this)), start, end);
      return unsupported('TextNode.getRangeOpenTypeFeatures');
    }

    getRangeLetterSpacing(start: number, end: number): LetterSpacing | Mixed {
      return getRange(this, 'getRangeLetterSpacing', 'letterSpacing', start, end);
    }

    setRangeLetterSpacing(start: number, end: number, value: LetterSpacing): void {
      const api = 'setRangeLetterSpacing';
      setRange(this, api, 'letterSpacing', start, end, checkLetterSpacing(api, value));
    }

    getRangeHyperlink(start: number, end: number): HyperlinkTarget | null | Mixed {
      return getRange(this, 'getRangeHyperlink', 'hyperlink', start, end);
    }

    /** Hyperlinks do not change glyphs, so no font is needed (typings:9937-9940). */
    setRangeHyperlink(start: number, end: number, value: HyperlinkTarget | null): void {
      const api = 'setRangeHyperlink';
      setRange(this, api, 'hyperlink', start, end, checkHyperlink(api, value), false);
    }

    getRangeFills(start: number, end: number): Paint[] | Mixed {
      const fills = getRange(this, 'getRangeFills', 'fills', start, end);
      return fills === MIXED ? MIXED : [...fills];
    }

    /** "Requires font to be loaded" (typings:9945-9949). */
    setRangeFills(start: number, end: number, value: Paint[]): void {
      const api = 'setRangeFills';
      setRange(this, api, 'fills', start, end, normalizePaints(api, value));
    }

    getRangeTextStyleId(start: number, end: number): string | Mixed {
      checkRange('getRangeTextStyleId', model(live(this)), start, end);
      return '';
    }

    setRangeTextStyleIdAsync(_start: number, _end: number, _styleId: string): Promise<void> {
      return unsupported('setRangeTextStyleIdAsync', 'B-139');
    }

    /** Deprecated; throws under `documentAccess: "dynamic-page"` (typings:9958-9962). */
    setRangeTextStyleId(_start: number, _end: number, _value: string): void {
      throw figmaError(
        'setRangeTextStyleId',
        'Cannot call with documentAccess: dynamic-page. Use setRangeTextStyleIdAsync instead.',
      );
    }

    getRangeFillStyleId(start: number, end: number): string | Mixed {
      checkRange('getRangeFillStyleId', model(live(this)), start, end);
      return '';
    }

    setRangeFillStyleIdAsync(_start: number, _end: number, _styleId: string): Promise<void> {
      return unsupported('setRangeFillStyleIdAsync', 'B-139');
    }

    /** Deprecated; throws under `documentAccess: "dynamic-page"` (typings:9972-9976). */
    setRangeFillStyleId(_start: number, _end: number, _value: string): void {
      throw figmaError(
        'setRangeFillStyleId',
        'Cannot call with documentAccess: dynamic-page. Use setRangeFillStyleIdAsync instead.',
      );
    }

    getRangeBoundVariable(start: number, end: number, _field: VariableBindableTextField): VariableAlias | null | Mixed {
      checkRange('getRangeBoundVariable', model(live(this)), start, end);
      return null;
    }

    setRangeBoundVariable(
      _start: number,
      _end: number,
      _field: VariableBindableTextField,
      _variable: Variable | null,
    ): void {
      unsupported('setRangeBoundVariable');
    }

    getRangeTextDecoration(start: number, end: number): TextDecoration | Mixed {
      return getRange(this, 'getRangeTextDecoration', 'textDecoration', start, end);
    }

    setRangeTextDecoration(start: number, end: number, value: TextDecoration): void {
      const api = 'setRangeTextDecoration';
      setRange(this, api, 'textDecoration', start, end, checkEnum(api, 'textDecoration', value, DECORATIONS));
    }

    getRangeTextDecorationStyle(start: number, end: number): TextDecorationStyle | Mixed | null {
      return decorated(
        this,
        getRange(this, 'getRangeTextDecorationStyle', 'textDecorationStyle', start, end),
        start,
        end,
      );
    }

    setRangeTextDecorationStyle(start: number, end: number, value: TextDecorationStyle): void {
      const api = 'setRangeTextDecorationStyle';
      setRange(this, api, 'textDecorationStyle', start, end, checkEnum(api, 'value', value, DECORATION_STYLES));
    }

    getRangeTextDecorationOffset(start: number, end: number): TextDecorationOffset | Mixed | null {
      return decorated(
        this,
        getRange(this, 'getRangeTextDecorationOffset', 'textDecorationOffset', start, end),
        start,
        end,
      );
    }

    setRangeTextDecorationOffset(start: number, end: number, value: TextDecorationOffset): void {
      setRange(this, 'setRangeTextDecorationOffset', 'textDecorationOffset', start, end, deepFreeze({ ...value }));
    }

    getRangeTextDecorationThickness(start: number, end: number): TextDecorationThickness | Mixed | null {
      return decorated(
        this,
        getRange(this, 'getRangeTextDecorationThickness', 'textDecorationThickness', start, end),
        start,
        end,
      );
    }

    setRangeTextDecorationThickness(start: number, end: number, value: TextDecorationThickness): void {
      setRange(
        this,
        'setRangeTextDecorationThickness',
        'textDecorationThickness',
        start,
        end,
        deepFreeze({ ...value }),
      );
    }

    getRangeTextDecorationColor(start: number, end: number): TextDecorationColor | Mixed | null {
      return decorated(
        this,
        getRange(this, 'getRangeTextDecorationColor', 'textDecorationColor', start, end),
        start,
        end,
      );
    }

    setRangeTextDecorationColor(start: number, end: number, value: TextDecorationColor): void {
      setRange(this, 'setRangeTextDecorationColor', 'textDecorationColor', start, end, deepFreeze({ ...value }));
    }

    getRangeTextDecorationSkipInk(start: number, end: number): boolean | Mixed | null {
      return decorated(
        this,
        getRange(this, 'getRangeTextDecorationSkipInk', 'textDecorationSkipInk', start, end),
        start,
        end,
      );
    }

    setRangeTextDecorationSkipInk(start: number, end: number, value: boolean): void {
      const api = 'setRangeTextDecorationSkipInk';
      setRange(this, api, 'textDecorationSkipInk', start, end, checkBoolean(api, 'value', value));
    }

    getRangeLineHeight(start: number, end: number): LineHeight | Mixed {
      return getRange(this, 'getRangeLineHeight', 'lineHeight', start, end);
    }

    setRangeLineHeight(start: number, end: number, value: LineHeight): void {
      const api = 'setRangeLineHeight';
      setRange(this, api, 'lineHeight', start, end, checkLineHeight(api, value));
    }

    getRangeListOptions(_start: number, _end: number): TextListOptions | Mixed {
      return unsupported('getRangeListOptions', 'hardening');
    }

    setRangeListOptions(_start: number, _end: number, _value: TextListOptions): void {
      unsupported('setRangeListOptions', 'hardening');
    }

    getRangeListSpacing(_start: number, _end: number): number | Mixed {
      return unsupported('getRangeListSpacing', 'hardening');
    }

    setRangeListSpacing(_start: number, _end: number, _value: number): void {
      unsupported('setRangeListSpacing', 'hardening');
    }

    getRangeIndentation(_start: number, _end: number): number | Mixed {
      return unsupported('getRangeIndentation', 'hardening');
    }

    setRangeIndentation(_start: number, _end: number, _value: number): void {
      unsupported('setRangeIndentation', 'hardening');
    }

    getRangeParagraphIndent(_start: number, _end: number): number | Mixed {
      return unsupported('getRangeParagraphIndent', 'hardening');
    }

    setRangeParagraphIndent(_start: number, _end: number, _value: number): void {
      unsupported('setRangeParagraphIndent', 'hardening');
    }

    getRangeParagraphSpacing(_start: number, _end: number): number | Mixed {
      return unsupported('getRangeParagraphSpacing', 'hardening');
    }

    setRangeParagraphSpacing(_start: number, _end: number, _value: number): void {
      unsupported('setRangeParagraphSpacing', 'hardening');
    }

    getRangeTextWrapStyle(_start: number, _end: number): TextWrapStyle | Mixed {
      return unsupported('getRangeTextWrapStyle', 'hardening');
    }

    setRangeTextWrapStyle(_start: number, _end: number, _value: TextWrapStyle): void {
      unsupported('setRangeTextWrapStyle', 'hardening');
    }

    /**
     * Maximal runs over `[start, end)` whose requested fields are equal, each with only the
     * requested fields plus `characters`, `start` and `end` (typings:10025-10170).
     */
    getStyledTextSegments<
      StyledTextSegmentFields extends (keyof Omit<StyledTextSegment, 'characters' | 'start' | 'end'>)[],
    >(
      fields: StyledTextSegmentFields,
      start?: number,
      end?: number,
    ): Array<Pick<StyledTextSegment, StyledTextSegmentFields[number] | 'characters' | 'start' | 'end'>> {
      const state = live(this);
      const text = model(state);
      const [from, to] = [start ?? 0, end ?? text.characters.length];
      if (text.characters.length === 0) return [];
      checkRange('getStyledTextSegments', text, from, to);
      const split = fields.flatMap((field) => {
        const styleField = SEGMENT_FIELDS[field];
        return styleField ? [styleField] : [];
      });
      return text.segments(split, from, to).map((run) => {
        const keys: Array<StyledTextSegmentFields[number] | 'characters' | 'start' | 'end'> = [
          'characters',
          'start',
          'end',
          ...fields,
        ];
        return pick(segmentOf(state, text, run.start, run.end), keys);
      });
    }

    // TextNode own members (typings:11010-11069).

    get textAlignHorizontal(): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' {
      return live(this).textAlignHorizontal;
    }

    /** "Setting this property requires the font the be loaded" (typings:11019). */
    set textAlignHorizontal(value: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED') {
      const state = live(this);
      const api = 'set_textAlignHorizontal';
      requireNodeFonts(api, state);
      state.textAlignHorizontal = checkEnum(api, 'value', value, ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']);
      state.ctx.record(state, 'set', 'textAlignHorizontal', value);
    }

    get textAlignVertical(): 'TOP' | 'CENTER' | 'BOTTOM' {
      return live(this).textAlignVertical;
    }

    /** "Setting this property requires the font the be loaded" (typings:11023). */
    set textAlignVertical(value: 'TOP' | 'CENTER' | 'BOTTOM') {
      const state = live(this);
      const api = 'set_textAlignVertical';
      requireNodeFonts(api, state);
      state.textAlignVertical = checkEnum(api, 'value', value, ['TOP', 'CENTER', 'BOTTOM']);
      state.ctx.record(state, 'set', 'textAlignVertical', value);
    }

    get textAutoResize(): 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE' {
      return live(this).textAutoResize;
    }

    /** "Setting this property requires the font the be loaded" (typings:11027). */
    set textAutoResize(value: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE') {
      const state = live(this);
      const api = 'set_textAutoResize';
      requireNodeFonts(api, state);
      state.textAutoResize = checkEnum(api, 'value', value, ['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE']);
      state.ctx.record(state, 'set', 'textAutoResize', value);
    }

    get textTruncation(): 'DISABLED' | 'ENDING' {
      return live(this).textTruncation;
    }

    set textTruncation(value: 'DISABLED' | 'ENDING') {
      const state = live(this);
      state.textTruncation = checkEnum('set_textTruncation', 'value', value, ['DISABLED', 'ENDING']);
      state.ctx.record(state, 'set', 'textTruncation', value);
    }

    get maxLines(): number | null {
      return live(this).maxLines;
    }

    /** "The value must be >= 1. To disable truncation at a maximum number of lines, set to `null`" (typings:11049). */
    set maxLines(value: number | null) {
      const state = live(this);
      state.maxLines = value === null ? null : checkNumber('set_maxLines', 'maxLines', value, 1);
      state.ctx.record(state, 'set', 'maxLines', value);
    }

    get autoRename(): boolean {
      return live(this).autoRename;
    }

    set autoRename(value: boolean) {
      const state = live(this);
      state.autoRename = checkBoolean('set_autoRename', 'autoRename', value);
      state.ctx.record(state, 'set', 'autoRename', value);
    }

    get textStyleId(): string | Mixed {
      live(this);
      return '';
    }

    /** Read-only under `documentAccess: "dynamic-page"` (typings:11063). */
    set textStyleId(_value: string | Mixed) {
      throw figmaError(
        'set_textStyleId',
        'Cannot call with documentAccess: dynamic-page. Use setTextStyleIdAsync instead.',
      );
    }

    setTextStyleIdAsync(_styleId: string): Promise<void> {
      return unsupported('setTextStyleIdAsync', 'B-139');
    }
  };
}
