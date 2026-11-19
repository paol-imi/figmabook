import { type CaptureDoc, canonicalJSON, captureNumKind, h16 } from '@holotype/ir';

/**
 * Fields that change from run to run without the capture changing (05 §10.1): wall-clock
 * timings. They are kept in the document and left out of {@link captureHash}.
 */
export const VOLATILE_CAPTURE_FIELDS = ['timing'] as const;

/** The canonical JSON of a Capture IR document (06 §5), with the Capture IR number kinds. */
export function canonicalCapture(doc: CaptureDoc): string {
  return canonicalJSON(doc, { numKind: captureNumKind });
}

/** The document with its volatile fields zeroed: equal for equal captures, and still valid. */
export function stableCapture(doc: CaptureDoc): CaptureDoc {
  return { ...doc, timing: { renderMs: 0, settleMs: 0, serializeMs: 0 } };
}

/**
 * `captureHash` (05 §10.1): `h16` of the canonical document without its volatile fields. Three
 * captures of a fixture story must give the same hash (the determinism gate).
 */
export function captureHash(doc: CaptureDoc): string {
  return h16(canonicalCapture(stableCapture(doc)));
}
