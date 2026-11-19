/**
 * Why an input cannot be simulated. `layout-sim` is a leaf package and emits no catalog
 * diagnostics itself: the caller turns issues into its own (README "Issues").
 */
export type SimIssueCode =
  /** `wrap: true`: wrap packing arrives with B-111. */
  | 'unsupported-wrap'
  /** `layoutMode: GRID`: arrives with B-112 (spike S-10). */
  | 'unsupported-grid'
  /** A rotated, skewed or scaled child inside a stack (07 §6.1 "does not model"). */
  | 'unsupported-transform'
  /** `BASELINE` on a VERTICAL stack. */
  | 'baseline-vertical'
  /** A stack hugs an axis on which an in-flow child fills. */
  | 'fill-in-hug-parent'
  /** FILL on a node that is not an in-flow child of a stack (or a FILL root without `outer`). */
  | 'fill-without-stack-parent'
  /** `sizingH/V` disagrees with the stack's own sizing mode on that axis. */
  | 'sizing-mode-conflict'
  /** An ABSOLUTE child, or a child of a non-stack frame, without `xy`. */
  | 'missing-xy'
  /** Two nodes share a key. */
  | 'duplicate-key'
  /** A size, padding, bound or stroke weight that is negative or not finite. */
  | 'invalid-number'
  /** A min greater than the max on the same axis. */
  | 'invalid-bounds';

export interface SimIssue {
  readonly code: SimIssueCode;
  /** Key of the node concerned. */
  readonly key: string;
  /** Plain-language explanation. */
  readonly message: string;
}

export function issue(code: SimIssueCode, key: string, message: string): SimIssue {
  return { code, key, message };
}
