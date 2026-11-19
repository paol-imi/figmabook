/*
 * The applier (09 §5–§6): everything here writes through a `FigmaPort` and never touches the
 * `figma` global (Biome `noRestrictedGlobals`, 09 §4).
 */
export { type ApplyBundleOptions, type ApplyProgress, type ApplyResult, applyBundle, notifyMessage } from './bundle';
export { type AppliedVariant, applyComponent, type ComponentOutcome, variantFrameName } from './component';
export { SUPPORTED_FEATURES, unsupportedFeatures } from './features';
export { FontResolver, fontRequestKey, LAST_RESORT_FAMILY, nearestStyle, rankStyles, styleWeight } from './fonts';
export {
  APPLIER_EPOCH,
  ARGS_MAX_LENGTH,
  IDENTITY_NAMESPACE,
  identityVersion,
  variantArgs,
  writeIdentity,
  writeProvisionalKey,
} from './identity';
export { COMPONENTS_PAGE, ensureComponentsPage } from './page';
export { toEffect, toEffects, toPaint, toPaints } from './paints';
export { COMPONENT_SPACING, contentBottom, nextComponentTop, variantGrid } from './placement';
export { createPuller, type Puller } from './pull';
export { readbackDelta } from './readback';
export { type AssetBytes, type LoadAsset, ResourceCache, type Resources } from './resources';
export {
  createApplyId,
  type ImportSessionOptions,
  PROGRESS_INTERVAL_MS,
  parseComponent,
  runImportSession,
} from './session';
export { createSlicer, DEFAULT_SLICE_BUDGET_MS, NO_SLICING, type Slicer } from './slicer';
export { utf8Decode } from './utf8';
export { orderedWriters, WRITERS } from './write/index';
export { writeNode } from './write/node';
export type { NodeWriter, WriteContext, WriteTarget } from './write/types';
