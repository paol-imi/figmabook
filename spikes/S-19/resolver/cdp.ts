/**
 * The slice of the Chrome DevTools Protocol `CSS` and `DOM` domains the provenance resolver reads
 * (05 §6.2). Structural subsets of the protocol types: a real `CSS.getMatchedStylesForNode`
 * response is assignable to {@link MatchedStyles}, so the resolver needs no protocol package.
 *
 * Ranges are 0-based and, in Chromium, relative to the style sheet's own text, even for inline
 * `<style>` sheets: `header.startLine/startColumn` place the sheet in its document (S-19 finding).
 */

export type StyleSheetOrigin = 'injected' | 'user-agent' | 'inspector' | 'regular';

export interface SourceRange {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** `CSS.CSSStyleSheetHeader`, from `CSS.styleSheetAdded`. */
export interface StyleSheetHeader {
  readonly styleSheetId: string;
  readonly sourceURL: string;
  readonly sourceMapURL?: string;
  readonly origin: StyleSheetOrigin;
  /** Backend node id of the owning `<style>`/`<link>`; absent for constructed sheets. */
  readonly ownerNode?: number;
  readonly isInline: boolean;
  readonly isConstructed?: boolean;
  readonly startLine: number;
  readonly startColumn: number;
}

/** `CSS.CSSProperty`: one declaration, or a longhand CDP expanded from a shorthand (no `range`). */
export interface CssProperty {
  readonly name: string;
  readonly value: string;
  readonly important?: boolean;
  readonly implicit?: boolean;
  readonly text?: string;
  readonly parsedOk?: boolean;
  readonly disabled?: boolean;
  readonly range?: SourceRange;
}

export interface CssStyle {
  readonly styleSheetId?: string;
  readonly cssProperties: readonly CssProperty[];
  readonly range?: SourceRange;
}

export interface CssSelector {
  readonly text: string;
  readonly range?: SourceRange;
}

export interface CssRule {
  readonly styleSheetId?: string;
  readonly selectorList: { readonly selectors: readonly CssSelector[]; readonly text: string };
  readonly origin: StyleSheetOrigin;
  readonly style: CssStyle;
}

export interface RuleMatch {
  readonly rule: CssRule;
  readonly matchingSelectors: readonly number[];
}

export interface InheritedStyleEntry {
  readonly inlineStyle?: CssStyle;
  readonly matchedCSSRules: readonly RuleMatch[];
}

/** `CSS.getMatchedStylesForNode` response (the parts used here). */
export interface MatchedStyles {
  readonly inlineStyle?: CssStyle;
  readonly attributesStyle?: CssStyle;
  /** Cascade order: later entries win over earlier ones at equal importance. */
  readonly matchedCSSRules?: readonly RuleMatch[];
  /** Nearest ancestor first, up to `<html>`. */
  readonly inherited?: readonly InheritedStyleEntry[];
}

/** `CSS.getComputedStyleForNode` entries, as a property → value map. */
export type ComputedStyle = Readonly<Record<string, string>>;
