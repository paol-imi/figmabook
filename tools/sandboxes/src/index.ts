/*
 * @holotype/sandboxes: generated, throwaway Storybook projects for spikes and compatibility
 * checks (D-26, BUILD B-16).
 */
export {
  DEFAULT_OUT_ROOT,
  type GeneratedSandbox,
  type GenerateOptions,
  generateSandbox,
  MANIFEST_FILE,
  MANIFEST_FORMAT,
  PACKAGE_ROOT,
  planSandbox,
  type SandboxFile,
  type SandboxManifest,
  type SandboxPlan,
  type SandboxSpec,
  sandboxName,
  sandboxPackageJson,
} from './generate.ts';
export {
  buildSandbox,
  type DevServer,
  type DevServerOptions,
  freePort,
  type InstallOptions,
  installSandbox,
  type RunResult,
  run,
  sandboxEnv,
  startDevServer,
  storybookBin,
} from './setup.ts';
export {
  checkOverlay,
  findTemplate,
  OVERLAYS,
  PLANNED_TEMPLATES,
  resolveStorybookVersion,
  type SandboxTemplate,
  TEMPLATES,
  type TemplateVersions,
} from './templates.ts';
