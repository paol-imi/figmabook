import {
  type CaptureDoc,
  type CShadow,
  type CText,
  canonicalJSON,
  captureNumKind,
  type MapperSettings,
} from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { plainDiagnostic } from '../diagnostics';
import { isInvisibleShadow, type ShadowEffect, shadowEffect } from '../visuals/shadow';

/*
 * `text-shadow` → node `effects: DROP_SHADOW` with spread 0 (07 §8.2). Figma effects belong
 * to the whole TEXT node, so the shadow must be the same for every range; otherwise the
 * shadow covering the most characters is used, with `TEXT_SHADOW_RANGE_APPROX`.
 */

type ColorProfile = MapperSettings['mapper']['colorProfile'];

/** The visible shadows of a style, in CSS order. */
const shadowsOf = (shadows: readonly CShadow[] | undefined): CShadow[] =>
  (shadows ?? []).filter((shadow) => !isInvisibleShadow(shadow));

/** The text's shadow as Figma effects (bottom → top), or `undefined` when no range has one. */
export function textShadowEffects(
  text: CText,
  capture: CaptureDoc,
  profile: ColorProfile,
  notes: Diagnostic[],
): ShadowEffect[] | undefined {
  /** Canonical shadow list → characters it covers, in first-seen order. */
  const coverage = new Map<string, { shadows: CShadow[]; chars: number }>();
  for (const run of text.runs) {
    const shadows = shadowsOf(capture.textStyles[run.styleId]?.shadow);
    const key = canonicalJSON(shadows, { numKind: captureNumKind });
    const entry = coverage.get(key) ?? { shadows, chars: 0 };
    entry.chars += run.end - run.start;
    coverage.set(key, entry);
  }
  let dominant: { shadows: CShadow[]; chars: number } | undefined;
  for (const entry of coverage.values()) if (dominant === undefined || entry.chars > dominant.chars) dominant = entry;
  if (dominant === undefined) return undefined;
  if (coverage.size > 1) {
    notes.push(
      plainDiagnostic('TEXT_SHADOW_RANGE_APPROX', {
        property: 'text-shadow',
        fallback: dominant.shadows.length === 0 ? 'no shadow' : 'the shadow of most characters',
      }),
    );
  }
  if (dominant.shadows.length === 0) return undefined;
  // Text shadows have no spread or inset in CSS.
  return [...dominant.shadows]
    .reverse()
    .map((shadow) => shadowEffect({ ...shadow, inset: false, spread: 0 }, profile, notes));
}
