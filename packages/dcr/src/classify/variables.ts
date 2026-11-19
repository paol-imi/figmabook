import { canonicalJSON, fnv1a64, type JsonValue } from '@holotype/ir';
import { aliasOf, type TokenIndex } from '../diff/tokens';
import { sameJson, sortedKeys } from '../identify/json';
import type { DcrVariable, SnapVariable } from '../schema';
import type { ItemDraft } from './context';
import { ARROW, cssValue, DOT, figmaValue } from './text';

/*
 * Variables (15 §4.4, §4.7, 08): a variable whose values no longer match its `holotype/ah`
 * (the hash of the values per mode, scopes and code syntax Holotype wrote) was edited:
 * `token.changed`. A variable without `tok` was created by the designer: `token.added`, with a
 * CSS name from 08's naming rule in reverse.
 *
 * The branch file stores only the hash of what was applied, not the values. The value before
 * is recovered when exactly one candidate reproduces the stored `ah`: in one mode, an alias to
 * another variable of the same type. Otherwise the item carries only the values after.
 */

type ModeChange = DcrVariable['modes'][string];

export interface WrittenVariable {
  readonly valuesByMode: Readonly<Record<string, JsonValue>>;
  readonly codeSyntax?: unknown;
  readonly scopes?: unknown;
}

/** `ah` of a variable as Holotype writes it (08 §11, 10 §2.1): values per mode, scopes and code syntax. */
export function variableHash(variable: WrittenVariable): string {
  const written: Record<string, unknown> = { valuesByMode: variable.valuesByMode };
  if (variable.scopes !== undefined) written.scopes = variable.scopes;
  if (variable.codeSyntax !== undefined) written.codeSyntax = variable.codeSyntax;
  return fnv1a64(canonicalJSON(written, { numKind: 'ratio' }));
}

const scopesOf = (variable: SnapVariable) => (variable as SnapVariable & { scopes?: unknown }).scopes;

/** The values before an edit, when exactly one alias candidate reproduces `ah`. */
function recoverBefore(variable: SnapVariable, tokens: TokenIndex): Record<string, JsonValue> | undefined {
  const stored = variable.data.ah;
  if (stored === undefined) return undefined;
  const found: Array<Record<string, JsonValue>> = [];
  for (const mode of sortedKeys(variable.valuesByMode)) {
    for (const id of tokens.ids()) {
      const other = tokens.variable(id);
      if (id === variable.id || other?.resolvedType !== variable.resolvedType) continue;
      const candidate = { ...variable.valuesByMode, [mode]: { alias: id } };
      if (sameJson(candidate[mode], variable.valuesByMode[mode])) continue;
      const hash = variableHash({ ...variable, valuesByMode: candidate, scopes: scopesOf(variable) });
      if (hash === stored) found.push(candidate);
    }
  }
  return found.length === 1 ? found[0] : undefined;
}

/** A mode value as the request shows it: an alias by CSS name, a raw value as is. */
function shown(value: JsonValue | undefined, tokens: TokenIndex): JsonValue {
  const alias = aliasOf(value);
  if (alias === undefined) return value ?? null;
  return { alias: tokens.cssName(alias) ?? alias };
}

/** Code words for a mode value: `var(--color-green-50)`, `#16a34a`, `16`. */
function codeWords(value: JsonValue | undefined, tokens: TokenIndex, type: SnapVariable['resolvedType']): string {
  const alias = aliasOf(value);
  if (alias !== undefined) return `var(${tokens.cssName(alias) ?? alias})`;
  return cssValue(value, type === 'COLOR' ? 'color' : 'other');
}

/** Designer words for a mode value: `color/green-50`, `#16a34a`, `16`. */
function designerWords(value: JsonValue | undefined, tokens: TokenIndex): string {
  const alias = aliasOf(value);
  if (alias !== undefined) return tokens.variable(alias)?.name ?? alias;
  return figmaValue(value);
}

export function classifyVariables(tokens: TokenIndex): ItemDraft[] {
  const drafts: ItemDraft[] = [];
  for (const id of tokens.ids()) {
    const variable = tokens.variable(id) as SnapVariable;
    if (variable.remote === true) continue;
    const css = variable.data.tok ?? tokens.cssName(id);
    if (css === undefined || !css.startsWith('--')) continue;
    const added = variable.data.tok === undefined;
    if (
      !added &&
      (variable.data.ah === undefined || variableHash({ ...variable, scopes: scopesOf(variable) }) === variable.data.ah)
    ) {
      continue;
    }
    const before = added ? undefined : recoverBefore(variable, tokens);
    const modes: Record<string, ModeChange> = {};
    const changedModes: string[] = [];
    for (const mode of sortedKeys(variable.valuesByMode)) {
      const after = variable.valuesByMode[mode];
      const was = before?.[mode];
      if (before !== undefined && sameJson(was, after)) continue;
      changedModes.push(mode);
      modes[mode] = { ...(was === undefined ? {} : { before: shown(was, tokens) }), after: shown(after, tokens) };
    }
    const single = changedModes.length === 1 ? (changedModes[0] as string) : undefined;
    const valueWords = (words: (value: JsonValue | undefined) => string) => {
      if (single === undefined) return `${changedModes.length} modes`;
      const after = words(variable.valuesByMode[single]);
      return before === undefined ? after : `${words(before[single])} ${ARROW} ${after}`;
    };
    const code = valueWords((value) => codeWords(value, tokens, variable.resolvedType));
    const designer = valueWords((value) => designerWords(value, tokens));
    drafts.push({
      item: {
        kind: added ? 'token.added' : 'token.changed',
        title: added ? `New token ${css} ${DOT} ${code}` : `Token ${css} ${DOT} ${code}`,
        designerTitle: added
          ? `New variable ${variable.name} ${DOT} ${designer}`
          : `Variable ${variable.name} ${DOT} ${designer}`,
        target: { key: css, figmaNodeId: id },
        variable: { cssName: css, figmaName: variable.name, collection: variable.collection, modes },
        acceptance: { type: 'fields', story: 'existing' },
      },
      before: false,
      questions: [],
      headline: added ? `New token ${variable.name}` : `Token ${variable.name}: ${designer}`,
    });
  }
  return drafts;
}
