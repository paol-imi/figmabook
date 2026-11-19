import { figmaError } from '../errors';
import { requireLoaded } from '../fonts';
import type { NodeState } from '../state';
import type { CharStyle } from '../text-model';
import { deepFreeze } from '../values';

/**
 * Variable bindings of text ranges (`setRangeBoundVariable`, typings:9977-9990;
 * `VariableBindableTextField`, typings:6996-7004; 08 §8 "text fontSize … fontFamily …").
 */
export const TEXT_FIELDS = [
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paragraphSpacing',
  'paragraphIndent',
] as const satisfies readonly VariableBindableTextField[];

/** The style fields each binding writes, so a literal write to them unbinds it. */
export const BOUND_BY: Readonly<Partial<Record<keyof CharStyle, readonly VariableBindableTextField[]>>> = {
  fontSize: ['fontSize'],
  lineHeight: ['lineHeight'],
  letterSpacing: ['letterSpacing'],
  fontName: ['fontFamily', 'fontStyle', 'fontWeight'],
};

function model(state: NodeState) {
  if (!state.text) throw new Error(`figma-fake internal error: ${state.id} is not a text node`);
  return state.text;
}

/** Sets (`alias`) or clears (`null`) the binding of `fields` on `[start, end)`; an empty text binds its base style. */
export function setRangeBinding(
  state: NodeState,
  start: number,
  end: number,
  fields: readonly VariableBindableTextField[],
  alias: VariableAlias | null,
): void {
  const text = model(state);
  const update = (style: CharStyle): CharStyle => {
    const next: { [field in VariableBindableTextField]?: VariableAlias } = { ...style.boundVariables };
    for (const field of fields) {
      if (alias) next[field] = alias;
      else delete next[field];
    }
    return { ...style, boundVariables: deepFreeze(next) };
  };
  if (text.styles.length === 0) {
    text.base = update(text.base);
    return;
  }
  for (let i = start; i < end; i++) {
    const style = text.styles[i];
    if (style) text.styles[i] = update(style);
  }
  if (start === 0 && text.styles[0]) text.base = text.styles[0];
}

/** Runs of `[start, end)` with the same font, for per-font rewrites of family, style or weight. */
function fontRuns(state: NodeState, start: number, end: number): Array<[number, number, FontName]> {
  const text = model(state);
  if (text.styles.length === 0) return [[0, 0, text.base.fontName]];
  const runs: Array<[number, number, FontName]> = [];
  for (let i = start; i < end; i++) {
    const font = text.styleAt(i).fontName;
    const last = runs[runs.length - 1];
    if (last && last[2].family === font.family && last[2].style === font.style) last[1] = i + 1;
    else runs.push([i, i + 1, font]);
  }
  return runs;
}

/**
 * Writes a bound value into a text range. With `check`, the write follows the setter rules (font
 * loaded, font size ≥ 1, an available style for a weight) and throws like the setter; without it,
 * a value that cannot apply is skipped (a variable changed after binding).
 *
 * @param bind the binding to store: an alias, `null` to unbind, or `undefined` to keep it.
 */
export function writeTextBinding(
  state: NodeState,
  start: number,
  end: number,
  field: VariableBindableTextField,
  value: VariableValue,
  bind: VariableAlias | null | undefined,
  check: boolean,
): void {
  const api = 'setRangeBoundVariable';
  const text = model(state);
  const fonts = state.ctx.fonts;
  const fail = (message: string): void => {
    if (check) throw figmaError(api, message);
  };
  const needFonts = () => {
    if (check) requireLoaded(api, fonts, text.fonts(start, end));
  };
  let applied = true;
  switch (field) {
    case 'fontSize':
      if (typeof value !== 'number' || value < 1) {
        fail('Expected "fontSize" to have value >= 1');
        applied = false;
        break;
      }
      needFonts();
      text.setRange('fontSize', start, end, value);
      break;
    case 'lineHeight':
    case 'letterSpacing':
      if (typeof value !== 'number') {
        applied = false;
        break;
      }
      needFonts();
      text.setRange(field, start, end, deepFreeze({ value, unit: 'PIXELS' }));
      break;
    case 'paragraphSpacing':
    case 'paragraphIndent':
      // Paragraph settings are node-level in the fake (README "Differences").
      if (typeof value !== 'number') {
        applied = false;
        break;
      }
      needFonts();
      state[field] = value;
      break;
    default: {
      const runs = fontRuns(state, start, end).map(([s, e, font]): [number, number, FontName | null] => {
        if (field === 'fontFamily')
          return [s, e, typeof value === 'string' ? { family: value, style: font.style } : null];
        if (field === 'fontStyle')
          return [s, e, typeof value === 'string' ? { family: font.family, style: value } : null];
        return [s, e, typeof value === 'number' ? fonts.styleWithWeight(font.family, value, font) : null];
      });
      for (const [, , font] of runs) {
        if (!font) {
          fail(`No available style matches "${field}" = ${JSON.stringify(value)}`);
          applied = false;
        } else if (check) requireLoaded(api, fonts, [font]);
      }
      if (!applied) break;
      for (const [s, e, font] of runs) {
        if (font) text.setRange('fontName', s, e, deepFreeze(font));
      }
    }
  }
  if (applied && bind !== undefined) setRangeBinding(state, start, end, [field], bind);
}

/** The bound alias of `field` over `[start, end)`, `null`, or `undefined` when the characters differ. */
export function rangeBinding(
  state: NodeState,
  start: number,
  end: number,
  field: VariableBindableTextField,
): VariableAlias | null | undefined {
  const styles = model(state).stylesIn(start, end);
  const first = styles[0]?.boundVariables[field] ?? null;
  return styles.every((style) => (style.boundVariables[field]?.id ?? null) === (first?.id ?? null)) ? first : undefined;
}
