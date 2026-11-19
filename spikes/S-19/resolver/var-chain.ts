/**
 * `var()` definition chains (05 §6.2 "Custom properties", 08 §resolution): from a reference to the
 * declaration of each custom property that wins at the element where the reference is resolved.
 * A custom property's `var()`s resolve on the element that declares it, so each step searches
 * from the level where the previous definition was found, up to `<html>`. Depth ≤ 16.
 */

import { type Declaration, winningDeclaration } from './cascade.ts';
import type { MatchedStyles } from './cdp.ts';
import { soleVarRef, type VarRef, varRefs } from './var-refs.ts';

export const MAX_VAR_DEPTH = 16;

export interface VarStep {
  readonly name: string;
  /** The winning definition; absent when the property is not defined (the fallback, if any, applies). */
  readonly declaration?: Declaration;
}

export interface VarChain {
  /** Custom property names in resolution order, e.g. `["--button-bg", "--color-primary", "--color-blue-600"]`. */
  readonly names: readonly string[];
  readonly steps: readonly VarStep[];
  /** The first value that is not a single `var()`: a literal or an expression; absent when unresolved. */
  readonly terminal?: string;
  /** Every step is a single `var()` without fallback and the terminal is a plain value (CVarChain.pure). */
  readonly pure: boolean;
  readonly fallbackUsed: boolean;
  /** `complete`: ends in a value; `undefined-var`: a name with no definition and no fallback; `cycle`/`too-deep`. */
  readonly status: 'complete' | 'undefined-var' | 'cycle' | 'too-deep';
}

const EXPRESSION = /\b(?:calc|color-mix|min|max|clamp|env|attr)\(/i;

/** Follows `ref` from `fromLevel` (the level of the declaration that holds it). */
export function resolveVarChain(matched: MatchedStyles, ref: VarRef, fromLevel: number): VarChain {
  const names: string[] = [];
  const steps: VarStep[] = [];
  let pure = ref.fallback === undefined;
  let fallbackUsed = false;
  let current: VarRef = ref;
  let level = fromLevel;
  const done = (status: VarChain['status'], terminal?: string): VarChain => {
    const plain = terminal !== undefined && !EXPRESSION.test(terminal) && varRefs(terminal).length === 0;
    return {
      names,
      steps,
      ...(terminal === undefined ? {} : { terminal }),
      pure: status === 'complete' && pure && plain,
      fallbackUsed,
      status,
    };
  };
  for (;;) {
    if (names.includes(current.name)) return done('cycle');
    if (names.length >= MAX_VAR_DEPTH) return done('too-deep');
    names.push(current.name);
    const winner = winningDeclaration(matched, current.name, { fromLevel: level });
    let value: string;
    if (winner.kind === 'declared') {
      steps.push({ name: current.name, declaration: winner.declaration });
      value = winner.declaration.property.value;
      level = winner.declaration.level;
    } else {
      steps.push({ name: current.name });
      if (current.fallback === undefined) return done('undefined-var');
      fallbackUsed = true;
      pure = false;
      value = current.fallback;
    }
    const next = soleVarRef(value);
    if (next === undefined) return done('complete', value.trim());
    if (next.fallback !== undefined) pure = false;
    current = next;
  }
}
