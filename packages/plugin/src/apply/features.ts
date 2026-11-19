import type { BundleFeature } from '@holotype/ir';

/**
 * Bundle features (06 §7) this applier understands. A bundle that declares any other one
 * would be misapplied if the feature were ignored, so the import refuses it with
 * `APPLY_UNSUPPORTED_FEATURE`. The slice applier writes absolute layout without variables,
 * styles or slots, so it supports none yet; each item that adds a feature lists it here.
 */
export const SUPPORTED_FEATURES: readonly BundleFeature[] = Object.freeze([]);

/** The features of `features` this build cannot apply, in their given order. */
export const unsupportedFeatures = (features: readonly BundleFeature[]): BundleFeature[] =>
  features.filter((feature) => !SUPPORTED_FEATURES.includes(feature));
