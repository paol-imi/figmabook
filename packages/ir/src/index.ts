export { type CanonicalOptions, canonicalJSON, type JsonPath, type NumKind, type NumKindResolver, normalizeNumber } from './canonical';
export { fnv1a64, h16, hash, sha256Hex } from './hash';
export { jsonSchemaFiles } from './json-schema';
export { migrateScene } from './migrations/scene';
export { type BundleFeature, BundleFeatureSchema, type BundleManifest, BundleManifestSchema } from './schema/bundle';
export { CaptureDocSchema, type CaptureDoc } from './schema/capture';
export { DiagnosticSchema, Hash16Schema, type Px, PxSchema, type Rect, RectSchema, SemverSchema, Sha256Schema } from './schema/common';
export { type BundleReport, BundleReportSchema } from './schema/report';
export { type SceneComponent, SceneComponentSchema, type SceneVariant, SceneVariantSchema } from './schema/scene';
export { type TokenSet, TokenSetSchema } from './schema/tokens';
export {
  type ValidationIssue,
  type Validator,
  validateBundleManifest,
  validateBundleReport,
  validateCaptureDoc,
  validateSceneComponent,
  validateTokenSet,
} from './validate';
export {
  BUNDLE_VERSION,
  CAPTURE_VERSION,
  parseMajor,
  SCENE_VERSION,
  SUPPORTED_SCENE_MAJORS,
  TOKENS_VERSION,
} from './versions';
