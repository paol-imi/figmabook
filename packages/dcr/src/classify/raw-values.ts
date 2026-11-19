import type { Diagnostic } from '@holotype/shared';
import { UNMAPPABLE_FIELDS } from '../diff/field-info';
import type { TokenIndex } from '../diff/tokens';
import type { DcrChange, PartialNodeGroups } from '../schema';
import { dcrDiagnostic, type QuestionDraft } from './context';
import { type Phrase, phrasesOf, tokenValueOf } from './phrases';
import { cssValue, figmaValue, hexColor } from './text';

/*
 * Raw values and fields without CSS (15 §4.7, §11). A changed value that is not bound to a
 * variable is matched against the tokens: matches become `token.candidates` and
 * `DCR_VALUE_UNTOKENIZED` (one question per phrase: use the token?); no match is
 * `DCR_VALUE_NO_TOKEN` (new token or literal?). A field with no CSS equivalent is
 * `DCR_FIELD_UNMAPPABLE`. Diagnostics are per field, questions per phrase.
 */

export interface Located {
  readonly sid?: string | undefined;
  readonly vk?: string | undefined;
  readonly nk: string;
  /** Who the question is about, e.g. `Button (Variant=Secondary, Size=Md)`. */
  readonly subject: string;
  /** The layer words before the field label, e.g. `label ` (empty on the variant root). */
  readonly layer: string;
}

export interface RawValueFindings {
  readonly changes: DcrChange[];
  readonly diagnostics: Diagnostic[];
  readonly questions: QuestionDraft[];
  /** Phrases with a raw value (the summary's `tokens.untokenized`). */
  readonly untokenized: number;
}

/** A value as the question shows it: `21, which is 20px in CSS without the 1px border,` or `4px`. */
function valueText(phrase: Phrase): { said: string; kept: string } {
  const change = phrase.changes[0] as DcrChange;
  const { kind } = phrase.info;
  const css = cssValue(change.after, kind, phrase.offset);
  const kept =
    kind === 'color' ? (hexColor(change.after) ?? css) : kind === 'px' || kind === 'length' ? `${css}px` : css;
  if (phrase.offset > 0) {
    return {
      said: `${figmaValue(change.after)}, which is ${kept} in CSS without the ${phrase.offset}px border,`,
      kept,
    };
  }
  return { said: kept, kept };
}

/** Finds the raw values and unmappable fields among one node's changes. */
export function rawValues(
  changes: readonly DcrChange[],
  nodeType: string,
  after: PartialNodeGroups,
  tokens: TokenIndex,
  at: Located,
): RawValueFindings {
  const out = changes.map((change) => ({ ...change }));
  const diagnostics: Diagnostic[] = [];
  const questions: QuestionDraft[] = [];
  let untokenized = 0;
  const where = (property: string) => ({ nodeKey: at.nk, property, sid: at.sid, variantKey: at.vk });
  for (const phrase of phrasesOf(out, nodeType, after)) {
    const lead = phrase.changes[0] as DcrChange;
    const label = `${at.layer}${phrase.label}`;
    if (UNMAPPABLE_FIELDS.has(lead.field)) {
      for (const change of phrase.changes) diagnostics.push(dcrDiagnostic('DCR_FIELD_UNMAPPABLE', where(change.field)));
      questions.push({
        code: 'DCR_FIELD_UNMAPPABLE',
        text: `${at.subject} ${label} changed from ${figmaValue(lead.before)} to ${figmaValue(lead.after)}, which has no CSS equivalent. What should the code do?`,
        options: ['approximate it', 'ignore it'],
      });
      continue;
    }
    const scope = phrase.info.scope;
    if (scope === undefined || lead.token?.after !== undefined || lead.after === null) continue;
    const value = tokenValueOf(lead, phrase, after);
    if (value === undefined) continue;
    const candidates = tokens.candidates(value, scope);
    if (candidates.length === 0 && value.kind === 'FLOAT' && value.value === 0) continue;
    untokenized += 1;
    const { said, kept } = valueText(phrase);
    const code = candidates.length > 0 ? 'DCR_VALUE_UNTOKENIZED' : 'DCR_VALUE_NO_TOKEN';
    for (const change of phrase.changes) {
      if (candidates.length > 0) change.token = { ...change.token, candidates };
      diagnostics.push(dcrDiagnostic(code, where(change.field)));
    }
    const intro = `${at.subject} ${label} is ${said} and is not bound to a variable.`;
    questions.push(
      candidates.length === 0
        ? {
            code,
            text: `${at.subject} ${label} is ${said} and matches no token. Add a token, or keep the value?`,
            options: ['add a token', `keep ${kept}`],
          }
        : {
            code,
            text:
              candidates.length === 1
                ? `${intro} One token matches: ${candidates[0]}. Use it?`
                : `${intro} ${candidates.length} tokens match: ${candidates.join(', ')}. Which one?`,
            options: [...candidates, `keep ${kept}`],
          },
    );
  }
  return { changes: out, diagnostics, questions, untokenized };
}
