/**
 * Authoring type for `parameters.holotype` in the fixture stories.
 *
 * It mirrors the `HolotypeParams` schema of docs/plan/04-variant-model.md §9, plus
 * `implements` (D-37) and `replacedBy` (BUILD §11 row 7). Stories use it with `satisfies`,
 * so a typo in a key fails `tsc`, the way the addon's types will once they ship.
 * Replace it with the type exported by `@holotype/ir` once that schema lands (B-01).
 */

type PseudoState = 'hover' | 'focus' | 'focus-visible' | 'active' | 'focus-within' | 'visited';

export interface HolotypeArgHint {
  as?: 'variant' | 'boolean' | 'text' | 'instance-swap' | 'slot' | 'fixed' | 'ignore';
  /** Figma property or axis name. */
  name?: string;
  values?: unknown[];
  labels?: Record<string, string>;
  order?: 'options' | 'default-first';
  target?: string;
}

export interface HolotypeStates {
  include?: (PseudoState | 'default')[];
  foldBooleans?: string[];
  labels?: Record<string, string>;
  mode?: 'force' | 'addon' | 'interact';
  target?: string;
  includePortals?: boolean;
}

export interface HolotypeParams {
  disable?: boolean;
  name?: string;
  component?: string;
  strategy?: 'auto' | 'stories' | 'args' | 'curated';
  baseStory?: string;
  matrix?: 'auto' | 'full' | 'pairwise' | 'one-at-a-time' | 'curated';
  classification?: 'verify' | 'fast';
  args?: Record<string, HolotypeArgHint>;
  fixed?: Record<string, unknown>;
  variants?: Record<string, string>[];
  states?: false | HolotypeStates;
  modes?: {
    globals?: string[];
    values?: Record<string, unknown[]>;
    as?: 'variables' | 'axis';
    capture?: 'per-variant' | 'base-only';
  };
  viewports?: {
    sizes: Record<string, number | { width: number; height?: number }>;
    as?: 'axis' | 'components';
  };
  width?: 'hug' | number | { probe: number[] };
  height?: 'hug' | number;
  viewport?: { width: number; height?: number };
  rootSelector?: string;
  unwrap?: boolean | number;
  portal?: boolean | 'auto' | string | { selector?: string; frame?: 'union' | 'viewport' };
  exclude?: string[];
  stateTarget?: string;
  slots?: Record<string, { selector?: string; min?: number; max?: number }>;
  layout?: { columns?: string[]; rows?: string[] };
  stories?: { fillMatrix?: 'none' | 'budget' | 'full'; maxStoryAxisValues?: number };
  budget?: { max?: number; warn?: number; maxProbes?: number };
  conditional?: 'dense' | 'sparse';
  play?: 'initial-only' | 'rerun';
  remount?: boolean;
  delay?: number;
  keepLayout?: boolean;
  textMode?: 'reflow' | 'locked-lines';
  /** Design change request ids this story implements (D-37). */
  implements?: string[];
  /** Component id that supersedes this one. */
  replacedBy?: string;
}
