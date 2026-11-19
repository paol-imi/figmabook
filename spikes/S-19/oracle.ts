/**
 * Ground truth for S-19: a resolved location is right when the original file holds, at that
 * line and column, a declaration of the winning property (or of the custom property, for `var()`
 * definitions), inside a rule whose selector is the reported original selector. A location in the
 * wrong file or on the wrong line fails the first check; this is the "wrong file" count that must
 * stay 0. Independent of the source map: it reads the files from the repository.
 */
import { declarationAt, enclosingSelector, offsetOf, splitSelectorList } from './resolver/css-text.ts';
import type { FieldProvenance } from './resolver/resolve.ts';

export type Check = 'ok' | 'wrong' | 'n/a';

export interface FieldVerdict {
  /** The declaration text is at `field.rule`. */
  readonly rule: Check;
  /** The enclosing rule's selector list contains the reported original selector(s). */
  readonly selector: Check;
  /** Every located `var()` definition is a declaration of its custom property. */
  readonly definitions: Check;
  readonly detail?: string;
}

/** Reads a repo-relative file; undefined when it does not exist. */
export type ReadRepoFile = (path: string) => string | undefined;

function checkDeclaration(
  read: ReadRepoFile,
  loc: { file: string; line: number; col: number },
  name: string,
): { check: Check; text?: string; offset?: number } {
  const text = read(loc.file);
  if (text === undefined) return { check: 'wrong' };
  const offset = offsetOf(text, loc.line, loc.col);
  return declarationAt(text, offset, name) ? { check: 'ok', text, offset } : { check: 'wrong' };
}

export function verifyField(field: FieldProvenance, read: ReadRepoFile): FieldVerdict {
  let rule: Check = 'n/a';
  let selector: Check = 'n/a';
  const problems: string[] = [];
  if (field.rule !== undefined && field.declaration !== undefined) {
    const result = checkDeclaration(read, field.rule, field.declaration.name);
    rule = result.check;
    if (rule === 'wrong') {
      problems.push(`no "${field.declaration.name}" at ${field.rule.file}:${field.rule.line}:${field.rule.col}`);
    }
    const original = field.selector?.original;
    if (result.text !== undefined && result.offset !== undefined && original !== undefined) {
      const enclosing = enclosingSelector(result.text, result.offset);
      const actual = new Set(enclosing === undefined ? [] : splitSelectorList(enclosing));
      selector = splitSelectorList(original).every((s) => actual.has(s)) ? 'ok' : 'wrong';
      if (selector === 'wrong') problems.push(`selector "${original}" vs "${enclosing ?? ''}"`);
    }
  }
  let definitions: Check = 'n/a';
  for (const definition of field.varChain?.definitions ?? []) {
    if (definition.loc === undefined) continue;
    const { check } = checkDeclaration(read, definition.loc, definition.name);
    if (definitions !== 'wrong') definitions = check;
    if (check === 'wrong') {
      problems.push(`no "${definition.name}" at ${definition.loc.file}:${definition.loc.line}:${definition.loc.col}`);
    }
  }
  return { rule, selector, definitions, ...(problems.length === 0 ? {} : { detail: problems.join('; ') }) };
}
