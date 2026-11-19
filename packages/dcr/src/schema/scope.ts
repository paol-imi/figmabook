import { err, ok, type Result } from '@holotype/shared';
import { type Static, Type } from '@sinclair/typebox';
import { FigmaNodeIdSchema } from './primitives';

/**
 * What a request covers (15 §4.6 "scope", D-57). `changed` is the default: managed
 * components whose `ah` differs from the baseline plus top-level frames created after link.
 */
export const DcrScopeSchema = Type.Union([
  Type.Object({ kind: Type.Literal('changed') }),
  Type.Object({ kind: Type.Literal('ready') }),
  Type.Object({ kind: Type.Literal('page'), name: Type.String({ minLength: 1 }) }),
  /** Plugin only; recorded as node ids so `--pull` reproduces it. */
  Type.Object({ kind: Type.Literal('selection'), ids: Type.Array(FigmaNodeIdSchema, { minItems: 1 }) }),
  Type.Object({ kind: Type.Literal('all') }),
]);
export type DcrScope = Static<typeof DcrScopeSchema>;

const NODE_ID = /^I?\d+:\d+(?:;\d+:\d+)*$/;

/**
 * Parses the CLI/config string form `changed | ready | page:<name> | selection:<ids> | all`
 * (15 §4.6, 16 §15). Selection ids are comma-separated and come back sorted and unique, so
 * the same selection always gives the same scope (and the same `dcrHash`).
 */
export function parseDcrScope(input: string): Result<DcrScope, string> {
  if (input === 'changed' || input === 'ready' || input === 'all') return ok({ kind: input });
  if (input.startsWith('page:')) {
    const name = input.slice('page:'.length);
    return name.length > 0 ? ok({ kind: 'page', name }) : err('Scope "page:" needs a page name, e.g. "page:Checkout".');
  }
  if (input.startsWith('selection:')) {
    const ids = input
      .slice('selection:'.length)
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (ids.length === 0) return err('Scope "selection:" needs at least one node id, e.g. "selection:12:40".');
    const bad = ids.find((id) => !NODE_ID.test(id));
    if (bad !== undefined) return err(`"${bad}" is not a Figma node id (expected e.g. "12:40").`);
    return ok({ kind: 'selection', ids: [...new Set(ids)].sort() });
  }
  return err(`Unknown scope "${input}": use changed, ready, page:<name>, selection:<ids> or all.`);
}

/** The string form of a scope; `parseDcrScope(formatDcrScope(s))` gives `s` back (ids sorted). */
export function formatDcrScope(scope: DcrScope): string {
  switch (scope.kind) {
    case 'page':
      return `page:${scope.name}`;
    case 'selection':
      return `selection:${[...new Set(scope.ids)].sort().join(',')}`;
    default:
      return scope.kind;
  }
}
