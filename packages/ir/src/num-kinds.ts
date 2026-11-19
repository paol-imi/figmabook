import type { JsonPath, NumKind } from './canonical';

/*
 * Number kinds by location (06 §5), for `canonicalJSON(doc, { numKind })`. They are keyed on
 * property names, so they work on a whole document and on any sub-object of it.
 */

const RATIO_KEYS = new Set(['r', 'g', 'b', 'a', 'opacity', 'position', 'ssim']);
const SCENE_MATRIX_KEYS = new Set(['relativeTransform', 'gradientTransform', 'imageTransform']);
/** Per-side px objects `{ t, r, b, l }`, whose `r` and `b` are lengths, not color channels. */
const PER_SIDE_KEYS = new Set(['padding', 'weight']);

function stringKeys(path: JsonPath): string[] {
  return path.filter((segment): segment is string => typeof segment === 'string');
}

function isRatio(path: JsonPath): boolean {
  const keys = stringKeys(path);
  const key = keys.at(-1);
  if (key === undefined || !RATIO_KEYS.has(key)) return false;
  return !(key.length === 1 && PER_SIDE_KEYS.has(keys.at(-2) ?? ''));
}

/** Scene IR, tokens and bundle documents: colors, opacity and stops are ratios; transforms matrices. */
export function sceneNumKind(path: JsonPath): NumKind {
  if (path.some((segment) => typeof segment === 'string' && SCENE_MATRIX_KEYS.has(segment))) return 'matrix';
  return isRatio(path) ? 'ratio' : 'px';
}

/** Capture IR: as Scene IR, plus angles in degrees and gradient stop offsets. */
export function captureNumKind(path: JsonPath): NumKind {
  const key = stringKeys(path).at(-1);
  if (key === 'angleDeg' || key === 'fromDeg') return 'angle';
  if (path.includes('transform')) return 'matrix';
  if (key === 'offset' && path.includes('stops')) return 'ratio';
  return isRatio(path) ? 'ratio' : 'px';
}
