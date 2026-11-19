import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type HolotypeConfig, type ValidationIssue, validateHolotypeConfig } from '@holotype/ir';
import { createDiagnostic, type Diagnostic, diagnostic, err, ok, type Result } from '@holotype/shared';

/*
 * Config loading, v0 (02 §8, 16 §1): one `holotype.config.{ts,mts,js,mjs,json}` found by
 * searching upward from the working directory (or named with `--config`), deep-merged with
 * the CLI flags, then validated against the `HolotypeConfig` schema (16 §18). `.holotyperc`,
 * the `package.json` key and env overlays come with the c12 loader later.
 */

/** File names searched in each directory, in this order (11 §3.1). */
export const CONFIG_FILES: readonly string[] = Object.freeze([
  'holotype.config.ts',
  'holotype.config.mts',
  'holotype.config.js',
  'holotype.config.mjs',
  'holotype.config.json',
]);

/** Values the CLI flags set; they win over the file (16 §1). */
export interface ConfigOverrides {
  /** `--storybook <dir|url>` → `storybook.source`. */
  readonly storybook?: string;
}

export interface ResolvedConfig {
  readonly config: HolotypeConfig;
  /** The config file that was read, if any. */
  readonly file?: string;
  /** `PLAN_CONFIG_UNKNOWN_KEY` warnings. */
  readonly warnings: readonly Diagnostic[];
}

const isFile = (path: string) =>
  stat(path).then(
    (stats) => stats.isFile(),
    () => false,
  );

/** The nearest config file in `cwd` or one of its parents. */
export async function findConfigFile(cwd: string): Promise<string | undefined> {
  let dir = resolve(cwd);
  for (;;) {
    for (const name of CONFIG_FILES) {
      const path = join(dir, name);
      if (await isFile(path)) return path;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function invalid(pointer: string, reason: string, file?: string): Diagnostic {
  return createDiagnostic(
    diagnostic('PLAN_CONFIG_INVALID'),
    { pointer, reason },
    file === undefined ? {} : { value: file },
  );
}

/** Reads a config file: JSON is parsed, modules are imported and their default export taken. */
export async function readConfigFile(path: string): Promise<Result<unknown, Diagnostic>> {
  if (!(await isFile(path))) return err(invalid('/', `the config file ${path} does not exist`, path));
  try {
    if (path.endsWith('.json')) return ok(JSON.parse(await readFile(path, 'utf8')) as unknown);
    const module = (await import(pathToFileURL(path).href)) as { default?: unknown };
    if (module.default === undefined) return err(invalid('/', `${basename(path)} has no default export`, path));
    return ok(module.default);
  } catch (error) {
    return err(invalid('/', `${basename(path)} could not be read: ${(error as Error).message}`, path));
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof RegExp);

/** 16 §1 merge: objects deep-merge, arrays and scalars replace, `null` unsets a key. */
export function mergeConfig(base: unknown, overlay: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay === undefined ? base : overlay;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === null) delete merged[key];
    else if (value !== undefined) merged[key] = mergeConfig(merged[key], value);
  }
  return merged;
}

function unescapePointer(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function withoutPath(value: unknown, path: readonly string[]): unknown {
  const [head, ...rest] = path;
  if (head === undefined || !isPlainObject(value) || !Object.hasOwn(value, head)) return value;
  const { [head]: child, ...others } = value;
  return rest.length === 0 ? others : { ...others, [head]: withoutPath(child, rest) };
}

/** A copy of `value` without the key a JSON pointer names. */
export function withoutPointer(value: unknown, pointer: string): unknown {
  return withoutPath(value, pointer.split('/').slice(1).map(unescapePointer));
}

function toDiagnostic(issue: ValidationIssue, file?: string): Diagnostic {
  if (issue.kind === 'unknown-key') {
    return createDiagnostic(
      diagnostic('PLAN_CONFIG_UNKNOWN_KEY'),
      { pointer: issue.path },
      file === undefined ? {} : { value: file },
    );
  }
  const reason =
    issue.path === '/storybook' || issue.path === '/storybook/source'
      ? 'storybook.source is required: pass --storybook <dir|url> or run holotype init'
      : issue.message;
  return invalid(issue.path || '/', reason, file);
}

/**
 * Merges the file value with the flag overrides and validates the result (16 §18): unknown
 * keys are dropped with `PLAN_CONFIG_UNKNOWN_KEY` (warning); any other violation fails with
 * `PLAN_CONFIG_INVALID` (error, exit 2).
 */
export function resolveConfig(
  fileValue: unknown,
  overrides: ConfigOverrides,
  file?: string,
): Result<ResolvedConfig, readonly Diagnostic[]> {
  if (fileValue !== undefined && !isPlainObject(fileValue)) {
    return err([invalid('/', 'the config must be an object', file)]);
  }
  const flags = overrides.storybook === undefined ? {} : { storybook: { source: overrides.storybook } };
  let value = mergeConfig(fileValue ?? {}, flags);
  const warnings: Diagnostic[] = [];
  // Each pass drops the unknown keys it found; a key nested in an unknown key never needs a pass.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const result = validateHolotypeConfig(value);
    if (result.ok) return ok({ config: result.value, warnings, ...(file === undefined ? {} : { file }) });
    const unknown = result.error.filter((issue) => issue.kind === 'unknown-key');
    const problems = result.error.filter((issue) => issue.kind === 'invalid');
    if (problems.length > 0) return err([...warnings, ...problems.map((issue) => toDiagnostic(issue, file))]);
    if (unknown.length === 0) return err([...warnings, invalid('/', 'the config does not match the schema', file)]);
    for (const issue of unknown) {
      warnings.push(toDiagnostic(issue, file));
      value = withoutPointer(value, issue.path);
    }
  }
  return err([...warnings, invalid('/', 'the config has too many unknown keys', file)]);
}

const MAX_PASSES = 8;

/** Finds (or reads `explicit`), merges and validates the config. */
export async function loadConfig(
  cwd: string,
  overrides: ConfigOverrides,
  explicit?: string,
): Promise<Result<ResolvedConfig, readonly Diagnostic[]>> {
  const file = explicit === undefined ? await findConfigFile(cwd) : resolve(cwd, explicit);
  if (file === undefined) return resolveConfig(undefined, overrides);
  const value = await readConfigFile(file);
  if (!value.ok) return err([value.error]);
  return resolveConfig(value.value, overrides, file);
}
