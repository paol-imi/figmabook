import type { CText, Rect, SceneText } from '@holotype/ir';
import { NEAR_PX } from '../geometry';

/*
 * How a TEXT layer sits in its box (07 §8.3): auto-resize, truncation and vertical alignment
 * all follow from where the browser's line boxes are inside the layer's box.
 */

export type TextFit = Pick<SceneText, 'autoResize' | 'truncation' | 'alignV'>;

interface LineBlock {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  /** The widest line. */
  readonly width: number;
}

/** The line block of a text: its top, bottom, horizontal extent and widest line. */
export function lineBlock(text: CText): LineBlock | undefined {
  if (text.lines.length === 0) return undefined;
  return {
    top: Math.min(...text.lines.map((line) => line.top)),
    bottom: Math.max(...text.lines.map((line) => line.top + line.height)),
    left: Math.min(...text.lines.map((line) => line.left)),
    right: Math.max(...text.lines.map((line) => line.left + line.width)),
    width: Math.max(...text.lines.map((line) => line.width)),
  };
}

/**
 * Auto-resize and truncation (07 §8.3). Truncated text and a box taller than its lines keep a
 * fixed size; one line whose box hugs it grows with its content; anything else has a fixed
 * width and a height that follows the lines.
 */
function sizing(text: CText, box: Rect): Pick<SceneText, 'autoResize' | 'truncation'> {
  if (text.textOverflow === 'ellipsis' && /nowrap|pre(?!-)/.test(text.whiteSpace)) {
    return { autoResize: 'NONE', truncation: { maxLines: 1 } };
  }
  if (text.lineClamp !== null) return { autoResize: 'NONE', truncation: { maxLines: text.lineClamp } };
  const block = lineBlock(text);
  if (block === undefined) return { autoResize: 'NONE' };
  if (box.h - (block.bottom - block.top) > NEAR_PX) return { autoResize: 'NONE' };
  const tops = new Set(text.lines.map((line) => Math.round(line.top / NEAR_PX)));
  const hugs = Math.abs(box.w - block.width) <= NEAR_PX;
  return { autoResize: tops.size === 1 && hugs ? 'WIDTH_AND_HEIGHT' : 'HEIGHT' };
}

/** TOP unless the box is taller than its lines; then where the line block sits (07 §8.3). */
function alignV(text: CText, box: Rect): SceneText['alignV'] {
  const block = lineBlock(text);
  if (block === undefined) return 'TOP';
  const above = block.top - box.y;
  const below = box.y + box.h - block.bottom;
  if (above <= NEAR_PX) return 'TOP';
  if (below <= NEAR_PX) return 'BOTTOM';
  return Math.abs(above - below) <= NEAR_PX ? 'CENTER' : 'TOP';
}

/** The auto-resize, truncation and vertical alignment of a text drawn in `box`. */
export function fitText(text: CText, box: Rect): TextFit {
  return { ...sizing(text, box), alignV: alignV(text, box) };
}

/**
 * Whether Figma, drawing the text in `box` with its alignment, puts the lines where the
 * browser did: the line block starts at the box edge its alignment names (both edges for
 * centred text), up to {@link NEAR_PX}. A box with padding fails this, so its text stays
 * inside a frame.
 */
export function placesLines(text: CText, box: Rect): boolean {
  const block = lineBlock(text);
  if (block === undefined) return false;
  const left = block.left - box.x;
  const right = box.x + box.w - block.right;
  const above = block.top - box.y;
  const below = box.y + box.h - block.bottom;
  const horizontal =
    text.textAlign === 'right'
      ? Math.abs(right) <= NEAR_PX
      : text.textAlign === 'center'
        ? Math.abs(left - right) <= 2 * NEAR_PX
        : Math.abs(left - text.indent) <= NEAR_PX || Math.abs(left) <= NEAR_PX;
  const vertical = Math.abs(above) <= NEAR_PX || Math.abs(below) <= NEAR_PX || Math.abs(above - below) <= NEAR_PX;
  return horizontal && vertical && left >= -NEAR_PX && right >= -NEAR_PX && above >= -NEAR_PX && below >= -NEAR_PX;
}
