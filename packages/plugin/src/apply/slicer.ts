/**
 * Time slicing (09 §12): the main thread shares the editor's thread, so the applier yields
 * after every `budgetMs` of work. `tick()` is called between work units (node writes).
 */
export interface Slicer {
  tick(): Promise<void>;
}

export interface SlicerOptions {
  /** A monotonic clock in milliseconds. */
  readonly now: () => number;
  /** Gives the editor a turn: `setTimeout(0)` where the sandbox has it, else a UI round trip. */
  readonly yieldToEditor: () => Promise<void>;
  /** Work per slice. 09 §12: 12 ms (configurable 8–16). */
  readonly budgetMs?: number;
}

export const DEFAULT_SLICE_BUDGET_MS = 12;

export function createSlicer({ now, yieldToEditor, budgetMs = DEFAULT_SLICE_BUDGET_MS }: SlicerOptions): Slicer {
  let sliceStart = now();
  return {
    async tick() {
      if (now() - sliceStart < budgetMs) return;
      await yieldToEditor();
      sliceStart = now();
    },
  };
}

/** A slicer that never yields, for callers that run outside the editor (tests, tools). */
export const NO_SLICING: Slicer = { tick: async () => {} };
