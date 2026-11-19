/*
 * The bundle writer (02 §5.1, 06 §4): Scene IR, assets and the report in, a deterministic
 * `.holotype.zip` or bundle directory out.
 */
export {
  assetFile,
  type Bundle,
  type BundleAssetInput,
  type BundleComponentInput,
  type BundleInput,
  componentFile,
  createBundle,
  encodeJson,
  MANIFEST_FILE,
  REPORT_FILE,
} from './build';
export {
  autoLayoutCoverage,
  buildBundleReport,
  type ComponentReportInput,
  sortDiagnostics,
} from './report';
export { assetRefs, countNodes, type FontUse, featuresOf, fontUses } from './scene-facts';
export { outputKind, type WrittenBundle, writeBundle, ZIP_SUFFIX } from './write';
export { entryMethod, JSON_LEVEL, unzipBundle, ZIP_MTIME, zipBundle } from './zip';
