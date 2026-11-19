import type { ResolvedDcrConfig } from '@holotype/ir';
import { createDiagnostic, type DiagnosticCode, diagnostic } from '@holotype/shared';
import type { TokenIndex } from '../diff/tokens';
import type { BaselineIndex, ComponentModel } from '../identify/components';
import { field } from '../identify/json';
import type { SnapshotIndex } from '../identify/snapshot-index';
import type { DcrItem, DcrQuestion } from '../schema';

/*
 * What every classifier shares: the snapshot index, the baselines, the variables, the
 * resolved config, and the shape of what a classifier returns (an item before its id).
 */

export interface ExtractContext {
  readonly index: SnapshotIndex;
  readonly baselines: BaselineIndex;
  readonly tokens: TokenIndex;
  readonly config: ResolvedDcrConfig;
  /** Item ids of the `component.new` items, by component node id (for `new-component-ref`). */
  readonly newComponents: ReadonlyMap<string, string>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An item before its id and asset role ids (both derive from the id). */
export type ItemBody = DistributiveOmit<DcrItem, 'id' | 'assets'>;

/** A question before its id (`q<n>`, numbered in item order) and item id. */
export type QuestionDraft = Pick<DcrQuestion, 'code' | 'text'> & { readonly options?: string[] };

export interface ItemDraft {
  readonly item: ItemBody;
  /** Whether the item has a "before" image (the baseline story exists). */
  readonly before: boolean;
  readonly questions: readonly QuestionDraft[];
  /** The summary line (15 §7.4). */
  readonly headline: string;
}

/** Diagnostic codes the extractor emits. */
export type DcrDiagnosticCode = Extract<DiagnosticCode, `DCR_${string}`>;

export interface Where {
  readonly nodeKey?: string | undefined;
  readonly variantKey?: string | undefined;
  readonly sid?: string | undefined;
  readonly property?: string | undefined;
  readonly value?: string | undefined;
}

/** A catalog diagnostic with only the location fields that are set (canonical JSON has no `undefined`). */
export function dcrDiagnostic(code: DcrDiagnosticCode, where: Where = {}) {
  const context: { -readonly [K in keyof Where]?: string } = {};
  for (const key of ['nodeKey', 'variantKey', 'sid', 'property', 'value'] as const) {
    const value = where[key];
    if (value !== undefined) context[key] = value;
  }
  return createDiagnostic(diagnostic(code), undefined, context);
}

/** How a managed component is named: by its export in code, by its Figma name for designers. */
export interface ComponentNames {
  /** `exportName` from the set's `src`, e.g. `Button`. */
  readonly code: string;
  /** The set's name as applied (its baseline), e.g. `Button`; a rename is itself a change. */
  readonly designer: string;
}

export function componentNames(model: ComponentModel): ComponentNames {
  const applied = field(model.setBaseline?.nodes.set?.vis, 'name');
  const designer = typeof applied === 'string' && applied.length > 0 ? applied : model.set.name;
  return { code: model.source.exportName ?? designer, designer };
}
