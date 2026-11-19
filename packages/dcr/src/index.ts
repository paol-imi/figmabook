import { canonicalJSON, h16 } from '@holotype/ir';
import { NotImplementedError } from '@holotype/shared';

/*
 * Design Change Request extraction is a pure function (D-35): no network, no clock and
 * no randomness, so the same file version and baseline give a byte-identical DCR.
 */

/** What a DCR item points at: a component, variant and node. */
export interface DcrTarget {
  readonly sid: string;
  readonly vk?: string;
  readonly nk?: string;
}

export interface DcrItemIdInput {
  /** Item kind, e.g. `component.modified` or `variant.added` (15 §3). */
  readonly kind: string;
  readonly target: DcrTarget;
  /** Paths of the changed fields, e.g. `paint.fills`. Order does not matter. */
  readonly fields: readonly string[];
}

/**
 * Stable item id: `h16(kind ∥ target ∥ sorted field paths)` (15 §4.9). The parts are
 * joined as canonical JSON so that no two different inputs share a preimage. The same
 * change gets the same id across re-extractions, which lets verify track items.
 */
export function dcrItemId({ kind, target, fields }: DcrItemIdInput): string {
  return h16(canonicalJSON([kind, target, [...fields].sort()]));
}

/** Normalized Figma read-back, from the plugin or the REST API (15 §4.1). */
export interface FigmaSnapshot {
  readonly kind: 'holotype/figma-snapshot';
  readonly v: 1;
}

/** Diffs a branch snapshot against its embedded baseline (D-34). */
export function extractDcr(_snapshot: FigmaSnapshot, _baseline: FigmaSnapshot): never {
  throw new NotImplementedError('extractDcr', 'Phase 4.5');
}
