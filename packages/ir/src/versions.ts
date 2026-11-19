/**
 * Independent semver for each document format (06 §7). Majors are breaking; consumers
 * ignore unknown fields within a known major and reject unknown majors.
 */
export const CAPTURE_VERSION = '0.1.0';
export const SCENE_VERSION = '0.1.0';
export const TOKENS_VERSION = '0.1.0';
export const BUNDLE_VERSION = '0.1.0';

/** Scene IR majors this build reads: the current one and, from 1.0 on, the previous one. */
export const SUPPORTED_SCENE_MAJORS: readonly number[] = [0];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The major of a semver string, or `undefined` when it is not valid semver. */
export function parseMajor(version: string): number | undefined {
  const match = SEMVER.exec(version);
  return match ? Number(match[1]) : undefined;
}
