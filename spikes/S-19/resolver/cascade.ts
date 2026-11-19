/**
 * The winning declaration of a property at a node (05 §6.2), from a `CSS.getMatchedStylesForNode`
 * response. CDP returns rules in cascade order, so the winner is the last applicable declaration,
 * an `!important` one beating any normal one. Inherited properties fall back to the nearest
 * ancestor that declares them; `inherit` defers to the parent for any property.
 *
 * Not modelled (none occur in branch-mode dev CSS so far, S-19): cascade layers reversing the
 * order of `!important` declarations, user-agent `!important`, `all`, `revert-layer`.
 */
import type { CssProperty, CssStyle, MatchedStyles, RuleMatch } from './cdp.ts';
import { type Direction, declaringProperties, isInheritedProperty } from './longhands.ts';

export type DeclarationSource = 'inline' | 'attributes' | 'rule' | 'user-agent';

export interface Declaration {
  /** The authored declaration (for a shorthand, the shorthand itself). */
  readonly property: CssProperty;
  readonly source: DeclarationSource;
  /** The matched rule, for `rule` and `user-agent` declarations. */
  readonly match?: RuleMatch;
  /** 0 = the node itself; k = its k-th ancestor (`MatchedStyles.inherited[k - 1]`). */
  readonly level: number;
}

const CSS_WIDE_KEYWORDS = new Set(['initial', 'unset', 'revert', 'revert-layer']);

/**
 * The declarations of one style that the cascade considers. CDP lists the authored declarations
 * (with a `range`) plus the longhands it expanded (without one); an authored style is read through
 * its ranged declarations only. User-agent styles carry no ranges: all their entries count.
 */
function authored(style: CssStyle | undefined): readonly CssProperty[] {
  if (style === undefined) return [];
  const usable = style.cssProperties.filter((p) => p.disabled !== true && p.parsedOk !== false);
  const ranged = usable.filter((p) => p.range !== undefined);
  return ranged.length > 0 ? ranged : usable;
}

function ruleDeclarations(matches: readonly RuleMatch[] | undefined, level: number): Declaration[] {
  const out: Declaration[] = [];
  for (const match of matches ?? []) {
    const source: DeclarationSource = match.rule.origin === 'user-agent' ? 'user-agent' : 'rule';
    for (const property of authored(match.rule.style)) out.push({ property, source, match, level });
  }
  return out;
}

/** Declarations at `level` in ascending cascade order (presentational attributes, rules, `style=""`). */
export function levelDeclarations(matched: MatchedStyles, level: number): Declaration[] {
  if (level === 0) {
    return [
      ...authored(matched.attributesStyle).map((property) => ({ property, source: 'attributes' as const, level })),
      ...ruleDeclarations(matched.matchedCSSRules, level),
      ...authored(matched.inlineStyle).map((property) => ({ property, source: 'inline' as const, level })),
    ];
  }
  const entry = matched.inherited?.[level - 1];
  if (entry === undefined) return [];
  return [
    ...ruleDeclarations(entry.matchedCSSRules, level),
    ...authored(entry.inlineStyle).map((property) => ({ property, source: 'inline' as const, level })),
  ];
}

/** Number of levels: the node plus its ancestors. */
export function levelCount(matched: MatchedStyles): number {
  return 1 + (matched.inherited?.length ?? 0);
}

/** The cascade winner among `candidates` (ascending order): the last `!important`, else the last. */
export function cascadeWinner(candidates: readonly Declaration[]): Declaration | undefined {
  let winner: Declaration | undefined;
  for (const candidate of candidates) {
    if (winner?.property.important === true && candidate.property.important !== true) continue;
    winner = candidate;
  }
  return winner;
}

export interface WinnerOptions {
  readonly direction?: Direction;
  /** First level to look at (a `var()` defined on an ancestor resolves from there). */
  readonly fromLevel?: number;
}

export type WinnerResult =
  | { readonly kind: 'declared'; readonly declaration: Declaration }
  /** Nothing declares it: the initial value (or, for inherited properties, nothing up to `<html>`). */
  | { readonly kind: 'none' }
  /** `initial`, `unset`, `revert`: the value comes from no author declaration. */
  | { readonly kind: 'keyword'; readonly declaration: Declaration };

/** The winning declaration of `property` (a longhand or a custom property) at the node. */
export function winningDeclaration(
  matched: MatchedStyles,
  property: string,
  options: WinnerOptions = {},
): WinnerResult {
  const names = new Set(declaringProperties(property, options.direction));
  const inherits = isInheritedProperty(property);
  const levels = levelCount(matched);
  for (let level = options.fromLevel ?? 0; level < levels; level++) {
    const winner = cascadeWinner(levelDeclarations(matched, level).filter((d) => names.has(d.property.name)));
    if (winner === undefined) {
      if (inherits) continue;
      return { kind: 'none' };
    }
    const keyword = winner.property.value.trim().toLowerCase();
    // `inherit`, and `unset` on an inherited property, take the parent's value.
    if (keyword === 'inherit' || (keyword === 'unset' && inherits)) continue;
    if (CSS_WIDE_KEYWORDS.has(keyword)) return { kind: 'keyword', declaration: winner };
    return { kind: 'declared', declaration: winner };
  }
  return { kind: 'none' };
}
