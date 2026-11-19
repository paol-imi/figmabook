/**
 * Typed `parameters.holotype` (04 §9). The schema is shared with `holotype.config.ts`
 * `defaults` / `components[sid]` and moves to a TypeBox schema in `@holotype/ir` (D-07).
 */
export interface HolotypeParameters {
  /** Variant source (04 §2). Default `'auto'`. */
  readonly strategy?: 'auto' | 'stories' | 'args' | 'curated';
  /** Exactly these variants with `strategy: 'curated'`: axis name → value label. */
  readonly variants?: readonly Readonly<Record<string, string>>[];
  /** Axis display names per arg (04 §8). */
  readonly axes?: Readonly<Record<string, { readonly name?: string }>>;
  /** Selector, relative to the capture root, that pseudo-states are forced on. */
  readonly stateTarget?: string;
  /** Named capture viewports in px, e.g. `{ mobile: 390, desktop: 1440 }`. */
  readonly viewports?: Readonly<Record<string, number>>;
  /** Keep the story's layout and decorator padding instead of capturing fullscreen (D-24). */
  readonly keepLayout?: boolean;
  /** DCR item ids this story implements (D-37). */
  readonly implements?: readonly string[];
  /** Component id that replaces this deprecated component (15 §3). */
  readonly replacedBy?: string;
}

/** Shape of a story's, meta's or project's `parameters` with the addon installed. */
export interface WithHolotypeParameters {
  readonly holotype?: HolotypeParameters;
}
