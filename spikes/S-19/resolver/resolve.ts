/**
 * Field provenance (15 §5.2): for one CSS longhand at one node, the winning declaration, its
 * original selector and `file:line:col`, and the `var()` chain down to each custom property's
 * definition site. The B-45 capture pass (`packages/capture/src/cdp/{matched,sourcemap}.ts`)
 * reuses this module as is; B-51 turns a {@link FieldProvenance} into a `FieldOrigin`.
 */
import type { FieldOrigin, SourceLoc } from '@holotype/ir';
import { type Declaration, type DeclarationSource, winningDeclaration } from './cascade.ts';
import type { ComputedStyle, MatchedStyles } from './cdp.ts';
import { offsetOf, selectorFrom, splitSelectorList, splitTopLevel } from './css-text.ts';
import type { ProvenanceDiagnostics } from './diagnostics.ts';
import type { Direction } from './longhands.ts';
import type { SheetKind, SheetTable, UnmappedReason } from './sheets.ts';
import { sameValue, shorthandComponent } from './values.ts';
import { resolveVarChain, type VarChain } from './var-chain.ts';
import { soleVarRef, type VarRef, varRefs } from './var-refs.ts';

/**
 * - `resolved`: a repo file:line:col through a source map;
 * - `approximate`: the file from `data-vite-dev-id`, the served line taken as the original one;
 * - `selector-only`: built CSS (static build), the served selector only;
 * - `unresolved`: see {@link UnresolvedReason}.
 */
export type FieldStatus = 'resolved' | 'approximate' | 'selector-only' | 'unresolved';

export type UnresolvedReason =
  /** No author declaration: the initial value. */
  | 'not-declared'
  | 'css-wide-keyword'
  | 'user-agent'
  /** `style=""`: needs the JSX location (`data-holotype-loc`, hardening). */
  | 'inline-style'
  | 'attributes'
  | UnmappedReason;

export interface SelectorInfo {
  /** As served, e.g. `._md_xefp9_59`. */
  readonly served: string;
  /** From the original file (CSS modules: de-hashed), e.g. `.md`. */
  readonly original?: string;
}

export interface VarDefinition {
  readonly name: string;
  readonly value?: string;
  readonly selector?: SelectorInfo;
  readonly loc?: SourceLoc;
  readonly styleSheetId?: string;
  /** Why `loc` is missing. */
  readonly reason?: UnresolvedReason | 'undefined-var';
}

export interface FieldVarChain {
  readonly names: readonly string[];
  readonly terminal?: string;
  readonly pure: boolean;
  readonly fallbackUsed: boolean;
  /**
   * `complete`: every name defined and located; `partial`: a definition without a location;
   * `broken`: undefined name, cycle or depth; `ambiguous`: a multi-`var()` value where no single
   * reference explains the computed value.
   */
  readonly status: 'complete' | 'partial' | 'broken' | 'ambiguous';
  readonly definitions: readonly VarDefinition[];
}

export interface FieldProvenance {
  /** The longhand, e.g. `padding-left`. */
  readonly property: string;
  readonly computed?: string;
  readonly status: FieldStatus;
  readonly reason?: UnresolvedReason;
  readonly declaration?: {
    /** Declared name, e.g. `padding-inline` for `padding-left`. */
    readonly name: string;
    readonly value: string;
    readonly important: boolean;
    readonly source: DeclarationSource;
    /** 0: on the node; k: inherited from the k-th ancestor. */
    readonly level: number;
  };
  readonly selector?: SelectorInfo;
  /** The declaration's location in the original file. */
  readonly rule?: SourceLoc;
  /** The map had a segment exactly at the declaration start. */
  readonly exact?: boolean;
  readonly styleSheetId?: string;
  readonly sheetKind?: SheetKind;
  readonly varChain?: FieldVarChain;
  /**
   * Whether the winner explains the computed value (literal or chain terminal compared after
   * normalization); `unknown` for expressions and forms that cannot be compared.
   */
  readonly valueCheck: 'match' | 'mismatch' | 'unknown';
}

export interface ResolveContext {
  readonly sheets: SheetTable;
  readonly direction?: Direction;
}

/** Vite's dev CSS-module class pattern `_<local>_<hash5>_<line>`, used only without a map. */
const VITE_MODULE_CLASS = /\._([A-Za-z_][\w-]*?)_[a-z0-9]{5}(?:_\d+)?(?![\w-])/g;

/** Best-effort de-hash of a served selector without a source map (`selector-only`, `approximate`). */
export function dehashSelector(served: string): string {
  return served.replace(VITE_MODULE_CLASS, '.$1');
}

function selectorInfo(declaration: Declaration, ctx: ResolveContext): SelectorInfo | undefined {
  const match = declaration.match;
  if (match === undefined) return undefined;
  const { selectors } = match.rule.selectorList;
  const matching = match.matchingSelectors.map((i) => selectors[i]?.text).filter((s) => s !== undefined);
  const served = (matching.length > 0 ? matching : selectors.map((s) => s.text)).join(', ');
  const first = selectors[0];
  const mapped = ctx.sheets.map(match.rule.styleSheetId, first?.range);
  if (mapped.ok && mapped.content !== undefined && !mapped.approximate) {
    const list = selectorFrom(mapped.content, offsetOf(mapped.content, mapped.loc.line, mapped.loc.col));
    if (list !== undefined) {
      const originals = splitSelectorList(list);
      if (originals.length === selectors.length) {
        const picked = match.matchingSelectors.map((i) => originals[i]).filter((s) => s !== undefined);
        return { served, original: (picked.length > 0 ? picked : originals).join(', ') };
      }
      return { served, original: list };
    }
  }
  const dehashed = dehashSelector(served);
  return dehashed === served ? { served } : { served, original: dehashed };
}

/** Where a declaration is, or why not. */
function locate(
  declaration: Declaration,
  ctx: ResolveContext,
): Pick<FieldProvenance, 'status' | 'reason' | 'rule' | 'exact' | 'styleSheetId' | 'sheetKind'> {
  if (declaration.source === 'inline') return { status: 'unresolved', reason: 'inline-style' };
  if (declaration.source === 'attributes') return { status: 'unresolved', reason: 'attributes' };
  if (declaration.source === 'user-agent') return { status: 'unresolved', reason: 'user-agent' };
  const styleSheetId = declaration.match?.rule.styleSheetId;
  const sheet = styleSheetId === undefined ? undefined : ctx.sheets.get(styleSheetId);
  const where = {
    ...(styleSheetId === undefined ? {} : { styleSheetId }),
    ...(sheet === undefined ? {} : { sheetKind: sheet.kind }),
  };
  const mapped = ctx.sheets.map(styleSheetId, declaration.property.range);
  if (!mapped.ok) {
    return mapped.reason === 'minified'
      ? { status: 'selector-only', ...where }
      : { status: 'unresolved', reason: mapped.reason, ...where };
  }
  return {
    status: mapped.approximate ? 'approximate' : 'resolved',
    rule: mapped.loc,
    exact: mapped.exact,
    ...where,
  };
}

/** The `var()` of a declaration that sets `property`, or why there is no single one. */
function pickRef(
  matched: MatchedStyles,
  declaration: Declaration,
  property: string,
  computed: string | undefined,
  direction: Direction | undefined,
): { ref?: VarRef; component?: string; ambiguous?: boolean } {
  const { name, value } = declaration.property;
  const component = shorthandComponent(name, value, property, direction);
  if (component !== undefined) {
    const [first, ...others] = varRefs(component);
    return first === undefined || others.length > 0
      ? { component, ...(first === undefined ? {} : { ambiguous: true }) }
      : { ref: first, component };
  }
  // A non-positional shorthand (`border`, `background`, `font`, `outline`): the reference whose
  // resolved value equals the computed longhand.
  const refs = varRefs(value);
  if (refs.length === 0) return {};
  if (computed === undefined)
    return refs.length === 1 && refs[0] !== undefined ? { ref: refs[0] } : { ambiguous: true };
  const explaining = refs.filter((ref) => {
    const chain = resolveVarChain(matched, ref, declaration.level);
    return chain.terminal !== undefined && sameValue(chain.terminal, computed) === true;
  });
  const [only] = explaining;
  if (explaining.length === 1 && only !== undefined) return { ref: only };
  return refs.length === 1 && explaining.length === 0 ? {} : { ambiguous: explaining.length > 1 };
}

function varChainOf(chain: VarChain, ctx: ResolveContext): FieldVarChain {
  const definitions: VarDefinition[] = chain.steps.map((step) => {
    const declaration = step.declaration;
    if (declaration === undefined) return { name: step.name, reason: 'undefined-var' as const };
    const located = locate(declaration, ctx);
    const selector = selectorInfo(declaration, ctx);
    return {
      name: step.name,
      value: declaration.property.value,
      ...(selector === undefined ? {} : { selector }),
      ...(located.rule === undefined ? {} : { loc: located.rule }),
      ...(located.styleSheetId === undefined ? {} : { styleSheetId: located.styleSheetId }),
      ...(located.status === 'resolved' || located.reason === undefined ? {} : { reason: located.reason }),
    };
  });
  const located = definitions.every((d) => d.loc !== undefined || d.reason === 'undefined-var');
  let status: FieldVarChain['status'] = 'broken';
  if (chain.status === 'complete') status = located ? 'complete' : 'partial';
  return {
    names: chain.names,
    ...(chain.terminal === undefined ? {} : { terminal: chain.terminal }),
    pure: chain.pure,
    fallbackUsed: chain.fallbackUsed,
    status,
    definitions,
  };
}

function sameValueOrUndefined(part: string, computed: string | undefined): boolean {
  return computed !== undefined && sameValue(part, computed) === true;
}

function valueCheck(expected: string | undefined, computed: string | undefined): FieldProvenance['valueCheck'] {
  if (expected === undefined || computed === undefined) return 'unknown';
  const same = sameValue(expected, computed);
  return same === undefined ? 'unknown' : same ? 'match' : 'mismatch';
}

/** Provenance of one longhand at one node. `computed` is the node's computed style, when known. */
export function resolveField(
  matched: MatchedStyles,
  property: string,
  computed: ComputedStyle | undefined,
  ctx: ResolveContext,
): FieldProvenance {
  const computedValue = computed?.[property];
  const base = { property, ...(computedValue === undefined ? {} : { computed: computedValue }) };
  const winner = winningDeclaration(matched, property, ctx.direction === undefined ? {} : { direction: ctx.direction });
  if (winner.kind === 'none') return { ...base, status: 'unresolved', reason: 'not-declared', valueCheck: 'unknown' };
  const declaration = winner.declaration;
  const declared = {
    name: declaration.property.name,
    value: declaration.property.value,
    important: declaration.property.important === true,
    source: declaration.source,
    level: declaration.level,
  };
  if (winner.kind === 'keyword') {
    return { ...base, status: 'unresolved', reason: 'css-wide-keyword', declaration: declared, valueCheck: 'unknown' };
  }
  const located = locate(declaration, ctx);
  const selector = selectorInfo(declaration, ctx);
  const picked = pickRef(matched, declaration, property, computedValue, ctx.direction);
  let varChain: FieldVarChain | undefined;
  let expected: string | undefined;
  if (picked.ref !== undefined) {
    const chain = resolveVarChain(matched, picked.ref, declaration.level);
    varChain = varChainOf(chain, ctx);
    // The terminal is the value only when the reference is the whole component (not `calc(var(…))`).
    if (picked.component === undefined || soleVarRef(picked.component) !== undefined) expected = chain.terminal;
  } else if (picked.ambiguous === true) {
    varChain = { names: [], pure: false, fallbackUsed: false, status: 'ambiguous', definitions: [] };
  } else if (picked.component !== undefined) {
    expected = picked.component;
  } else {
    // A literal non-positional shorthand (`border: 2px dashed #475569`): one of its components.
    expected = splitTopLevel(declared.value, ' ').find((part) => sameValueOrUndefined(part, computedValue));
  }
  return {
    ...base,
    ...located,
    declaration: declared,
    ...(selector === undefined ? {} : { selector }),
    ...(varChain === undefined ? {} : { varChain }),
    valueCheck: valueCheck(expected, computedValue),
  };
}

/** The `FieldOrigin` of a resolved field (15 §5.2), for the mapper's provenance side file (B-51). */
export function toFieldOrigin(field: FieldProvenance, css: readonly string[] = [field.property]): FieldOrigin {
  const [first, ...rest] = css;
  return {
    css: [first ?? field.property, ...rest],
    ...(field.declaration === undefined ? {} : { authored: field.declaration.value }),
    ...(field.selector?.original === undefined ? {} : { selector: field.selector.original }),
    ...(field.rule === undefined || field.status !== 'resolved' ? {} : { rule: field.rule }),
    ...(field.varChain === undefined || field.varChain.names.length === 0
      ? {}
      : { varChain: [...field.varChain.names] }),
  };
}

/** Provenance of `properties` at one node; records sheet diagnostics in `diagnostics`. */
export function resolveNodeFields(
  matched: MatchedStyles,
  computed: ComputedStyle | undefined,
  properties: readonly string[],
  ctx: ResolveContext,
  diagnostics?: ProvenanceDiagnostics,
): FieldProvenance[] {
  return properties.map((property) => {
    const field = resolveField(matched, property, computed, ctx);
    if (diagnostics !== undefined) {
      const sheetIds = [field.styleSheetId, ...(field.varChain?.definitions.map((d) => d.styleSheetId) ?? [])];
      for (const id of sheetIds) if (id !== undefined) diagnostics.observe(field.property, ctx.sheets.get(id));
    }
    return field;
  });
}
