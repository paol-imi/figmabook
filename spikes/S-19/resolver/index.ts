/**
 * S-19 provenance resolver (05 §6.2, 15 §5): CDP matched styles + style sheet headers + Vite dev
 * source maps → per-field `file:line:col`, original selector and `var()` definition sites.
 * Pure and isomorphic; the CDP calls live in `../probe.ts`. B-45 moves this folder to
 * `packages/capture/src/cdp/` unchanged (see docs/spikes/S-19.md §7).
 */

export {
  cascadeWinner,
  type Declaration,
  type DeclarationSource,
  levelCount,
  levelDeclarations,
  type WinnerOptions,
  type WinnerResult,
  winningDeclaration,
} from './cascade.ts';
export type * from './cdp.ts';
export {
  declarationAt,
  enclosingSelector,
  offsetOf,
  selectorFrom,
  splitSelectorList,
  splitTopLevel,
  stripComments,
} from './css-text.ts';
export { ProvenanceDiagnostics } from './diagnostics.ts';
export { fieldGroup, type NodeKind, relevantFields } from './fields.ts';
export {
  type Direction,
  declaringProperties,
  isInheritedProperty,
  MAPPED_LONGHANDS,
  type MappedLonghand,
} from './longhands.ts';
export { dirname, normalizePath, type RepoPathOptions, type RepoPathResult, toRepoPath } from './paths.ts';
export {
  dehashSelector,
  type FieldProvenance,
  type FieldStatus,
  type FieldVarChain,
  type ResolveContext,
  resolveField,
  resolveNodeFields,
  type SelectorInfo,
  toFieldOrigin,
  type UnresolvedReason,
  type VarDefinition,
} from './resolve.ts';
export {
  classifySheet,
  decodeDataUrl,
  documentPosition,
  isSourceMap,
  type MappedPosition,
  mapPosition,
  rangeStart,
  type SheetInput,
  type SheetKind,
  type SheetPosition,
  type SheetSource,
  SheetTable,
  type UnmappedReason,
} from './sheets.ts';
export { comparableValue, sameValue, shorthandComponent } from './values.ts';
export { MAX_VAR_DEPTH, resolveVarChain, type VarChain, type VarStep } from './var-chain.ts';
export { soleVarRef, type VarRef, varRefs } from './var-refs.ts';
