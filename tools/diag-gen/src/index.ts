export { DOCS_DIR, DOCS_INDEX, renderDocs } from './emit-docs.ts';
export { CATALOG_MODULE_PATH, renderCatalogModule } from './emit-ts.ts';
export { asSentence, splitTableRow, toPlainText } from './markdown.ts';
export {
  type Catalog,
  type CatalogDomain,
  type CatalogIssue,
  type CatalogRow,
  type CatalogSeverity,
  type ChapterRef,
  catalogRows,
  type ParseResult,
} from './model.ts';
export { CATALOG_COLUMNS, parseCatalog } from './parse.ts';
export {
  CATALOG_SOURCE,
  CatalogError,
  type CheckReport,
  check,
  formatIssue,
  type GenerateResult,
  generate,
  hasAnchor,
  loadCatalog,
  renderOutputs,
} from './run.ts';
export { type CodeUse, findCodeLiterals, IGNORE_MARKER, scanPackageSources } from './scan.ts';
