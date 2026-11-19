/** Builders for synthetic CDP data, and the recorded Button fixture. */
import type { CssProperty, MatchedStyles, RuleMatch, SourceRange, StyleSheetHeader } from '../resolver/cdp.ts';
import type { SheetInput } from '../resolver/sheets.ts';
import recorded from './fixtures/button-primary.json';

export interface RecordedNode {
  readonly matched: MatchedStyles;
  readonly computed: Record<string, string>;
}

export interface RecordedFixture {
  readonly story: string;
  readonly repoRoot: string;
  readonly sheets: readonly SheetInput[];
  readonly nodes: { readonly button: RecordedNode; readonly label: RecordedNode };
}

/** `components-button--primary` on the dev server (`pnpm -F @holotype/spikes s19:record`). */
export const BUTTON = recorded as unknown as RecordedFixture;

export function range(startLine: number, startColumn: number, endLine = startLine, endColumn = startColumn + 10) {
  return { startLine, startColumn, endLine, endColumn } satisfies SourceRange;
}

/** An authored declaration at `line` (0-based), column 2. */
export function decl(name: string, value: string, line = 0, extra: Partial<CssProperty> = {}): CssProperty {
  return { name, value, text: `${name}: ${value};`, range: range(line, 2), ...extra };
}

export function rule(
  selector: string,
  properties: readonly CssProperty[],
  options: { sheet?: string; origin?: RuleMatch['rule']['origin']; line?: number } = {},
): RuleMatch {
  const line = options.line ?? 0;
  return {
    rule: {
      styleSheetId: options.sheet ?? 's1',
      selectorList: { selectors: [{ text: selector, range: range(line, 0) }], text: selector },
      origin: options.origin ?? 'regular',
      style: { cssProperties: properties },
    },
    matchingSelectors: [0],
  };
}

export function header(id: string, extra: Partial<StyleSheetHeader> = {}): StyleSheetHeader {
  return {
    styleSheetId: id,
    sourceURL: '',
    origin: 'regular',
    isInline: false,
    startLine: 0,
    startColumn: 0,
    ...extra,
  };
}

export function matched(own: readonly RuleMatch[], ...ancestors: (readonly RuleMatch[])[]): MatchedStyles {
  return { matchedCSSRules: own, inherited: ancestors.map((rules) => ({ matchedCSSRules: rules })) };
}
