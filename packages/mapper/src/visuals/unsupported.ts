import type { CNode } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { isSet, isTransformed, isTransparent, outlineVisible } from '../css';
import { plainDiagnostic } from '../diagnostics';

/*
 * CSS this mapper version does not turn into Scene fields yet. Each is reported with
 * `CAP_CSS_UNSUPPORTED` (`property` names it) instead of being dropped silently (BUILD §3.1
 * rule 6). Gradients, images, shadows, outlines, filters, clips, masks and transforms are
 * B-48 and its hardening items.
 */

const FALLBACK = 'left out of the Figma layer';

/** Reports one CSS property this version leaves out. */
export function reportUnsupported(notes: Diagnostic[], property: string, value?: string, fallback = FALLBACK): void {
  notes.push(
    plainDiagnostic('CAP_CSS_UNSUPPORTED', {
      property,
      ...(value === undefined ? {} : { value }),
      fallback,
      data: { property },
    }),
  );
}

/** Reports the unsupported visual CSS of an element's own box. */
export function reportUnsupportedVisuals(node: CNode, notes: Diagnostic[]): void {
  const computed = node.computed;
  if (isTransformed(node.transform)) reportUnsupported(notes, 'transform');
  if (!computed) return;
  const { background } = computed;
  for (const layer of background.layers) {
    reportUnsupported(notes, 'background-image', layer.image.kind === 'url' ? 'url()' : layer.image.css);
  }
  const colorClip = background.clip.at(-1) ?? 'border-box';
  if (!isTransparent(background.color) && colorClip !== 'border-box')
    reportUnsupported(notes, 'background-clip', colorClip);
  if (computed.boxShadow.length > 0) reportUnsupported(notes, 'box-shadow');
  if (outlineVisible(computed)) reportUnsupported(notes, 'outline');
  if (isSet(computed.filter)) reportUnsupported(notes, 'filter', computed.filter);
  if (isSet(computed.backdropFilter)) reportUnsupported(notes, 'backdrop-filter', computed.backdropFilter);
  if (isSet(computed.clipPath)) reportUnsupported(notes, 'clip-path', computed.clipPath);
  if (isSet(computed.maskImage)) reportUnsupported(notes, 'mask-image', computed.maskImage);
}
