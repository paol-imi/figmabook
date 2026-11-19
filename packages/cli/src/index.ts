/*
 * @holotype/cli: the `holotype` command (alias `holo`) and its programmatic API (11 §3).
 */
export * from './bundle';
export { captureArgs, captureCommand, captureMain, sourceDateEpoch } from './commands/capture';
export { type CommandOutcome, usageError, usageReport } from './commands/usage';
export { defineConfig, type HolotypeConfig } from './config/define';
export {
  CONFIG_FILES,
  type ConfigOverrides,
  findConfigFile,
  loadConfig,
  mergeConfig,
  type ResolvedConfig,
  readConfigFile,
  resolveConfig,
  withoutPointer,
} from './config/load';
export { ExitCode, exitCodeFor } from './exit-codes';
export { type MainDeps, main, rootCommand } from './main';
export { displayPath, formatBytes, formatCaptureSummary, formatDiagnostic, helpLink } from './output/human';
export { type CliIo, processIo } from './output/io';
export { FAVICON_PATTERN, quietFavicon } from './pipeline/browser';
export {
  type CaptureDeps,
  type CaptureProgress,
  type CaptureRunOptions,
  type CaptureRunResult,
  checkStories,
  configHash,
  DEFAULT_OUTPUT_DIR,
  isoSeconds,
  makeRunId,
  runCapture,
} from './pipeline/capture';
export { type ComponentWork, mapWork, metaInput, portableCapture, skipReason } from './pipeline/component';
export { resolveMapperSettings } from './pipeline/settings';
export { redactSource, resolveSource, storybookLinks } from './pipeline/source';
export { CLI_VERSION, MAPPER_VERSION } from './pipeline/versions';
export { exportBundle, type RunOptions, run, type ServeOptions, serve } from './run';
export { countByCode, type RunComponent, type RunReport } from './run-report';
