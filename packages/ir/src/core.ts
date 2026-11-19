/*
 * `@holotype/ir/core`: the lean entry for the Figma plugin main thread (02 §6.2, D-04).
 *
 * Only document versions, canonical JSON, hashing and the `ah` normalizer: no TypeBox schema
 * and no validator, so a bundle that imports this entry does not pull the schema modules.
 * (A CommonJS `require` of the plugin entry, as create-figma-plugin emits, defeats esbuild's
 * tree shaking of the root entry's `export *` re-exports.) Types of every document are
 * erased at build time, so `import type` from the root entry stays free.
 *
 * Every export here is the same binding as the one of the root entry.
 */
export {
  type CanonicalOptions,
  canonicalJSON,
  type JsonPath,
  type NumKind,
  type NumKindResolver,
  normalizeNumber,
} from './canonical';
export { fnv1a64, h16, hash, sha256Hex } from './hash';
export {
  APPLIED_GROUPS,
  APPLIED_HASH_LENGTH,
  type AppliedGroup,
  appliedHash,
  canonicalGroup,
  changedGroups,
  groupHashes,
  type NodeGroups,
  normalizeGroups,
  type RawNodeGroups,
  splitAppliedHash,
} from './normalize';
export { captureNumKind, sceneNumKind } from './num-kinds';
export {
  BUNDLE_VERSION,
  CAPTURE_VERSION,
  CONFIG_VERSION,
  checkVersion,
  PROVENANCE_VERSION,
  parseMajor,
  SCENE_VERSION,
  SUPPORTED_BUNDLE_MAJORS,
  SUPPORTED_SCENE_MAJORS,
  SUPPORTED_TOKENS_MAJORS,
  TOKENS_VERSION,
} from './versions';
