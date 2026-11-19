import { createValidator, hash, type ResolvedDcrConfig, ResolvedDcrConfigSchema, type Validator } from '@holotype/ir';
import { createDiagnostic, diagnostic, HolotypeError } from '@holotype/shared';
import type { FigmaSnapshot } from '../schema';
import { asString, field, isObject, type JsonObject, parseJson } from './json';

/*
 * What the extractor reads from the file root (15 §2.2, 10 §2.3): `branch:meta`, which makes
 * the file a branch file and carries the resolved `dcr` config (D-50), and the registry, which
 * names the Storybook the baseline came from. Plugin and CLI read the same root data, so they
 * build the same header.
 */

/** The parts of `branch:meta` (15 §2.2) the extractor uses. */
export interface BranchMeta {
  readonly repo: string;
  readonly branch: string;
  readonly baseCommit: string;
  readonly dirty: boolean;
  readonly baselineFp: string;
  readonly baselineRunId?: string;
  readonly kind: 'duplicate' | 'figma-branch';
  /** Top-level frames and sections that existed at link (D-57). */
  readonly baseFrames: ReadonlySet<string>;
  readonly dcrConfig: ResolvedDcrConfig;
  /** `h16(canonical(dcrConfig))` (D-50). */
  readonly configHash: string;
  /** The previous request on this branch (D-56). */
  readonly parent?: string;
}

/** The parts of the root registry (10 §2.3) the extractor uses. */
export interface RegistryInfo {
  readonly storybookVersion: string;
  readonly framework: string;
}

const validateConfig: Validator<ResolvedDcrConfig> = createValidator(ResolvedDcrConfigSchema);

/** The root key that holds `branch:meta`. */
export const BRANCH_META_KEY = 'branch:meta';

/** `DCR_NOT_BRANCH_FILE`: the file has no usable branch metadata. Extraction stops. */
function notBranchFile(why: string): HolotypeError {
  return new HolotypeError(createDiagnostic(diagnostic('DCR_NOT_BRANCH_FILE'), undefined, { property: why }));
}

const required = (meta: JsonObject, key: string): string => {
  const value = asString(meta[key]);
  if (value === undefined || value.length === 0) throw notBranchFile(`branch:meta.${key}`);
  return value;
};

/**
 * Reads `branch:meta`. Throws a `HolotypeError` with `DCR_NOT_BRANCH_FILE` when it is missing
 * or unusable: a library file has none, and the extractor never guesses a baseline.
 */
export function readBranchMeta(snapshot: FigmaSnapshot): BranchMeta {
  const meta = parseJson(snapshot.rootData[BRANCH_META_KEY]);
  if (!isObject(meta)) throw notBranchFile(BRANCH_META_KEY);
  const config = validateConfig(meta.dcrConfig);
  if (!config.ok) throw notBranchFile('branch:meta.dcrConfig');
  const kind = meta.kind === 'duplicate' ? 'duplicate' : 'figma-branch';
  const baseFrames = Array.isArray(meta.baseFrames) ? meta.baseFrames.filter((id) => typeof id === 'string') : [];
  const runId = asString(meta.baselineRunId);
  const parent = asString(field(meta.lastDcr, 'id'));
  return {
    repo: required(meta, 'repo'),
    branch: required(meta, 'branch'),
    baseCommit: required(meta, 'baseCommit'),
    dirty: meta.dirty === true,
    baselineFp: required(meta, 'baselineFp'),
    ...(runId === undefined ? {} : { baselineRunId: runId }),
    kind,
    baseFrames: new Set(baseFrames as string[]),
    dcrConfig: config.value,
    configHash: hash(config.value),
    ...(parent === undefined ? {} : { parent }),
  };
}

/** Joins the registry chunks (`registry:meta` + `registry:0..n-1`); `undefined` when absent or broken. */
function readRegistryJson(snapshot: FigmaSnapshot): JsonObject | undefined {
  const meta = parseJson(snapshot.rootData['registry:meta']);
  const chunks = field(meta, 'chunks');
  if (typeof chunks !== 'number' || !Number.isInteger(chunks) || chunks < 1) return undefined;
  let joined = '';
  for (let i = 0; i < chunks; i++) {
    const chunk = snapshot.rootData[`registry:${i}`];
    if (chunk === undefined) return undefined;
    joined += chunk;
  }
  const registry = parseJson(joined);
  return isObject(registry) ? registry : undefined;
}

/** What the header needs from the registry. A missing value reads as `unknown`. */
export function readRegistry(snapshot: FigmaSnapshot): RegistryInfo {
  const storybook = field(readRegistryJson(snapshot), 'storybook');
  return {
    storybookVersion: asString(field(storybook, 'version')) || 'unknown',
    framework: asString(field(storybook, 'framework')) || 'unknown',
  };
}
