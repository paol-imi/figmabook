import { px, sides } from '../../css';
import { readColor } from '../../read-color';
import type { Collector } from '../../types';

/**
 * Borders (05 §7.2): width, style and color per side, in CSS order, and the outline when one
 * paints. The mapper decides how to express non-uniform borders (07).
 */
export const border: Collector = {
  name: 'border',
  element({ style }, draft, context) {
    draft.computed.border = {
      width: sides((side) => px(style.getPropertyValue(`border-${side}-width`))),
      style: sides((side) => style.getPropertyValue(`border-${side}-style`)),
      color: sides((side) =>
        readColor(context, draft.id, `border-${side}-color`, style.getPropertyValue(`border-${side}-color`)),
      ),
    };
    const width = px(style.outlineWidth);
    if (style.outlineStyle !== 'none' && width > 0) {
      draft.computed.outline = {
        width,
        style: style.outlineStyle,
        color: readColor(context, draft.id, 'outline-color', style.outlineColor),
        offset: px(style.outlineOffset),
      };
    }
  },
};
