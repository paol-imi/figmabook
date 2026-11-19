import { APPLY_IR_VERSION_UNSUPPORTED, createDiagnostic, type Diagnostic } from '@holotype/shared';

/**
 * Independent semver for each document format (06 §7). Majors are breaking; consumers
 * ignore unknown fields within a known major and reject unknown majors.
 */
export const CAPTURE_VERSION = '0.1.0';
export const SCENE_VERSION = '0.1.0';
export const TOKENS_VERSION = '0.1.0';
export const BUNDLE_VERSION = '0.1.0';
/** Version of the `holotype.config.ts` / `parameters.holotype` schema (16, 04 §9). */
export const CONFIG_VERSION = '0.1.0';
/** `ProvenanceDoc.v` (06 §4.1): an integer, like plugin data `v` (D-19). */
export const PROVENANCE_VERSION = 1;

/** Scene IR majors this build reads: the current one and, from 1.0 on, the previous one. */
export const SUPPORTED_SCENE_MAJORS: readonly number[] = [0];
/** Bundle format majors this build reads. */
export const SUPPORTED_BUNDLE_MAJORS: readonly number[] = [0];
/** `tokens.json` majors this build reads. */
export const SUPPORTED_TOKENS_MAJORS: readonly number[] = [0];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The major of a semver string, or `undefined` when it is not valid semver. */
export function parseMajor(version: string): number | undefined {
  const match = SEMVER.exec(version);
  return match ? Number(match[1]) : undefined;
}

/**
 * Checks a document version against the supported majors. Returns `APPLY_IR_VERSION_UNSUPPORTED`
 * for an unknown major or a version that is not semver, `undefined` when it is readable.
 */
export function checkVersion(document: string, version: unknown, supported: readonly number[]): Diagnostic | undefined {
  const major = typeof version === 'string' ? parseMajor(version) : undefined;
  if (major !== undefined && supported.includes(major)) return undefined;
  return createDiagnostic(APPLY_IR_VERSION_UNSUPPORTED, {
    document,
    found: typeof version === 'string' ? version : 'unknown',
    supported: supported.join(', '),
  });
}
