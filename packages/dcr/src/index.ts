/*
 * Design Change Request extraction is a pure function (D-35): no network, no clock and
 * no randomness, so the same file version and baseline give a byte-identical DCR. The
 * package runs in Node (CLI) and in the plugin UI.
 */

export { DCR_EXTRACTOR_VERSION, extractDcr } from './extract';
export { canonicalSnapshot, snapshotHash } from './ids/index';
export {
  normalizePlugin,
  type PluginNodeRead,
  type PluginReadback,
  type PluginVariableRead,
  SnapshotReadError,
} from './normalize-plugin/index';
export * from './schema';
