import { isPx, px, sides } from '../css';
import type { Collector } from '../types';

/**
 * Box facts every element carries (06 §2.1 `CComputed`): display, positioning, overflow,
 * padding, margin and size. The size is the computed `width` / `height` (which follow
 * `box-sizing`); for boxes whose computed size is not a length (inline boxes report `auto`),
 * it is derived from the border box.
 */
export const box: Collector = {
  name: 'box',
  element({ style }, draft) {
    const padding = sides((side) => px(style.getPropertyValue(`padding-${side}`)));
    const border = sides((side) => px(style.getPropertyValue(`border-${side}-width`)));
    const borderBox = draft.borderBox ?? { x: 0, y: 0, w: 0, h: 0 };
    const contentBox = style.boxSizing !== 'border-box';
    const derived = (outer: number, before: number, after: number) =>
      contentBox ? Math.max(0, outer - before - after) : outer;
    const [pt, pr, pb, pl] = padding;
    const [bt, br, bb, bl] = border;

    Object.assign(draft.computed, {
      display: style.display,
      position: style.position,
      boxSizing: style.boxSizing,
      visibility: style.visibility,
      zIndex: style.zIndex,
      mixBlendMode: style.mixBlendMode,
      isolation: style.isolation,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      padding,
      margin: sides((side) => px(style.getPropertyValue(`margin-${side}`))),
      size: {
        width: isPx(style.width) ? px(style.width) : derived(borderBox.w, pl + bl, pr + br),
        height: isPx(style.height) ? px(style.height) : derived(borderBox.h, pt + bt, pb + bb),
        minW: style.minWidth,
        maxW: style.maxWidth,
        minH: style.minHeight,
        maxH: style.maxHeight,
      },
    });
  },
};
