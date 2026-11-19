import { parsePattern } from '@holotype/ir';

/*
 * Class filtering for keys and names (07 §12 rule 7, 10 §4): utility classes, CSS-module
 * hashes and CSS-in-JS classes say nothing about what a layer is, and they change with
 * cosmetic edits, so they are skipped.
 */

const BUILT_IN: readonly RegExp[] = [
  // 07 §12's Tailwind-like prefixes, with the per-side spacing (`px-2`) and min/max size forms.
  /^-?([mp][xytrbl]?|(min-|max-)?[wh]|flex|grid|text|bg|border|rounded|gap|items|justify)-/,
  /^(css|sc|emotion)-/,
];

/**
 * A CSS-module hash suffix (`Button_primary__x7a3B`, `_btn_1f9c2`): five or more characters
 * after the last `_`, with a digit among them. The digit keeps BEM names (`card__header`).
 */
export function hasHashSuffix(className: string): boolean {
  const suffix = /_([A-Za-z0-9]{5,})$/.exec(className)?.[1];
  return suffix !== undefined && /\d/.test(suffix);
}

/** A class matcher for the built-in rules plus `naming.stripClassPatterns` (16 §10). */
export function classFilter(stripClassPatterns: readonly string[]): (className: string) => boolean {
  // `g` and `y` make `test` stateful, which would make the result depend on call order.
  const configured = stripClassPatterns
    .map(parsePattern)
    .map((pattern) =>
      typeof pattern === 'string' ? pattern : new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')),
    );
  return (className) =>
    !hasHashSuffix(className) &&
    !BUILT_IN.some((pattern) => pattern.test(className)) &&
    !configured.some((pattern) => (typeof pattern === 'string' ? pattern === className : pattern.test(className)));
}

/**
 * The authored name inside a Vite CSS-module class: `_item_1ypxr_9` (`_[local]_[hash]_[line]`)
 * → `item`. The hash and line change with unrelated edits; the local name does not.
 */
export function cssModuleLocal(className: string): string {
  return /^_([A-Za-z][A-Za-z0-9_-]*?)_[A-Za-z0-9]{5}_\d+$/.exec(className)?.[1] ?? className;
}

/** The first class that names something (CSS-module classes by their local name), or `undefined`. */
export function semanticClass(
  classes: readonly string[] | undefined,
  keep: (className: string) => boolean,
): string | undefined {
  return classes?.map(cssModuleLocal).find(keep);
}
