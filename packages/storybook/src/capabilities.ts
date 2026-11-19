import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import type { IndexFormat, SbCapabilities } from './types';

/** What `project.json` says about the build (written by Storybook's `utils/metadata.ts`). */
export interface ProjectInfo {
  readonly storybookVersion?: string;
  readonly framework?: string;
  readonly renderer?: string;
  readonly builder?: string;
}

/** The newest Storybook major this adapter is tested against (D-11: SB 10 is primary). */
export const NEWEST_TESTED_MAJOR = 10;
/** Storybook 7 and older are not supported (D-11). */
export const OLDEST_SUPPORTED_MAJOR = 8;

const BUILDERS: Readonly<Record<string, string>> = {
  '@storybook/builder-vite': 'vite',
  '@storybook/builder-webpack5': 'webpack5',
};

const stringField = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** Reads `project.json`. Unknown shapes give an empty result: the file is optional (03 §2.1). */
export function parseProjectJson(json: unknown): ProjectInfo {
  if (typeof json !== 'object' || json === null) return {};
  const record = json as Readonly<Record<string, unknown>>;
  const framework =
    stringField(record.framework) ??
    (typeof record.framework === 'object' && record.framework !== null
      ? stringField((record.framework as Readonly<Record<string, unknown>>).name)
      : undefined);
  const builderPackage = stringField(record.builder);
  const info: Record<string, string | undefined> = {
    storybookVersion: stringField(record.storybookVersion),
    framework,
    renderer: stringField(record.renderer),
    builder: builderPackage === undefined ? undefined : (BUILDERS[builderPackage] ?? builderPackage),
  };
  return Object.fromEntries(Object.entries(info).filter(([, value]) => value !== undefined)) as ProjectInfo;
}

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Parses `10.6.7`, `11.0.0-beta.3`, `v9.1`; `undefined` when there is no leading number. */
export function parseSemver(version: string): Semver | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2] ?? 0), patch: Number(match[3] ?? 0) };
}

const atLeast = (v: Semver, major: number, minor = 0): boolean =>
  v.major > major || (v.major === major && v.minor >= minor);

/**
 * The lowest version an index format implies, used when `project.json` is missing. The flags it
 * gives are conservative: without `storyFinished`, `storyRendered` is the done event.
 */
const FORMAT_FLOOR: Readonly<Record<IndexFormat, Semver>> = {
  v3: { major: 6, minor: 0, patch: 0 },
  v4: { major: 8, minor: 0, patch: 0 },
  v5: { major: 8, minor: 1, patch: 0 },
};

/** Capability flags from the version (or the index format when it is unknown) (03 §3). */
export function detectCapabilities(indexFormat: IndexFormat, project: ProjectInfo): SbCapabilities {
  const version = project.storybookVersion ?? null;
  const v = (version === null ? undefined : parseSemver(version)) ?? FORMAT_FLOOR[indexFormat];
  return {
    version,
    indexFormat,
    storyFinishedEvent: atLeast(v, 8, 3),
    awaitsAnimations: atLeast(v, 9),
    pauseAnimationsInTestRunner: atLeast(v, 9, 1),
    docgenServer: atLeast(v, 11),
    componentsManifest: atLeast(v, 10, 1),
    argTypesInfoEvent: atLeast(v, 10),
    storyGlobals: atLeast(v, 8, 3),
    pseudoStatesGlobal: atLeast(v, 9),
    ...(project.framework === undefined ? {} : { framework: project.framework }),
    ...(project.renderer === undefined ? {} : { renderer: project.renderer }),
    ...(project.builder === undefined ? {} : { builder: project.builder }),
  };
}

/**
 * Version gate (D-11): Storybook older than 8 stops the run with `SB_VERSION_UNSUPPORTED`; a
 * major newer than the newest tested one warns `SB_VERSION_UNTESTED` and goes on.
 */
export function checkStorybookVersion(caps: SbCapabilities): { fatal?: Diagnostic; warnings: Diagnostic[] } {
  if (caps.indexFormat === 'v3' && caps.version === null) {
    return { fatal: unsupported('older than 8 (only a v3 stories.json is served)'), warnings: [] };
  }
  const v = caps.version === null ? undefined : parseSemver(caps.version);
  if (v === undefined) return { warnings: [] };
  if (v.major < OLDEST_SUPPORTED_MAJOR) return { fatal: unsupported(caps.version ?? ''), warnings: [] };
  if (v.major > NEWEST_TESTED_MAJOR) {
    return {
      warnings: [
        createDiagnostic(diagnostic('SB_VERSION_UNTESTED'), undefined, {
          value: caps.version ?? '',
          fallback: `the Storybook ${NEWEST_TESTED_MAJOR} adapter`,
          data: { version: caps.version, newestTestedMajor: NEWEST_TESTED_MAJOR },
        }),
      ],
    };
  }
  return { warnings: [] };
}

function unsupported(version: string): Diagnostic {
  return createDiagnostic(
    diagnostic('SB_VERSION_UNSUPPORTED'),
    { version },
    { severity: 'fatal', value: version, data: { fatal: true, oldestSupportedMajor: OLDEST_SUPPORTED_MAJOR } },
  );
}
