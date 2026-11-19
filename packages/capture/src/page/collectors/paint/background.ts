import { readColor } from '../../read-color';
import type { Collector } from '../../types';

/**
 * `background-color` (05 §7.2), plus `background-clip` per layer and the element's `color`
 * (for `currentColor` and SVG). Image layers (`url()`, gradients) are not captured yet:
 * `layers` stays empty and the `unsupported` collector reports them.
 */
export const background: Collector = {
  name: 'background',
  element({ style }, draft, context) {
    draft.computed.background = {
      color: readColor(context, draft.id, 'background-color', style.backgroundColor),
      layers: [],
      clip: style.backgroundClip.split(',').map((clip) => clip.trim()),
    };
    draft.computed.color = readColor(context, draft.id, 'color', style.color);
  },
};
