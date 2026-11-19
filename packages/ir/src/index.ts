// Canonical JSON and hashing (06 §5–§6).
export {
  type CanonicalOptions,
  canonicalJSON,
  type JsonPath,
  type NumKind,
  type NumKindResolver,
  normalizeNumber,
} from './canonical';
export { fnv1a64, h16, hash, sha256Hex } from './hash';
// Semantic invariants (06 §9).
export {
  checkManifestInvariants,
  checkSceneInvariants,
  type InvariantViolation,
  invariantDiagnostics,
  type ManifestInvariant,
  type SceneInvariant,
  type SceneInvariantOptions,
} from './invariants';
export {
  bundleFingerprint,
  checkSceneHashes,
  dcrConfigHash,
  type HashMismatch,
  sceneComponentIrh,
  sceneNodeIrh,
  sceneVariantIrh,
  tokensIrh,
  type VariantKeyInput,
  variantKey,
  withSceneHashes,
} from './irh';
// JSON Schema publication (06 §7).
export { jsonSchemaFiles, PUBLISHED_SCHEMAS, type PublishedSchema, toJsonSchema } from './json-schema';
export { migrateScene, SCENE_MIGRATIONS, type SceneMigration } from './migrations/scene';
// The `ah` / baseline / DCR snapshot normalizer (06 §6, 10 §9.1).
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
// Stage-boundary types of the CLI pipeline (06 §1.1, 07 §0).
export type {
  BudgetReport,
  CatalogComponent,
  ComponentCatalog,
  ComponentIdentity,
  ComponentMetaInput,
  ComponentPlan,
  MapperInput,
  MapperOutput,
  MapperSettings,
  ModePlan,
  PlanAxis,
  PlanAxisValue,
  PlannedProperty,
  PlannedRender,
  PlannedVariant,
  ProbeRender,
  ProvenanceTag,
  TokenResolution,
  VerificationResult,
} from './pipeline';
export { sourceLocKey } from './pipeline';
// Document schemas (TypeBox, D-07) and their static types.
export * from './schema/bundle';
export * from './schema/capture';
export * from './schema/config';
export * from './schema/primitives';
export * from './schema/provenance';
export * from './schema/report';
export * from './schema/scene';
/** @deprecated Use `TokensDoc` (06 §4.3). Kept until the mapper stub is rebuilt (B-12). */
export type { TokensDoc as TokenSet } from './schema/tokens';
export * from './schema/tokens';
export {
  createValidator,
  type ValidationIssue,
  type Validator,
  type ValidatorOptions,
  validateApplyReport,
  validateBundleManifest,
  validateBundleReport,
  validateCaptureDoc,
  validateHolotypeConfig,
  validateHolotypeParams,
  validateProvenanceDoc,
  validateSceneComponent,
  validateTokensDoc,
} from './validate';
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
