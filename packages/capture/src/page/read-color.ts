import type { Color } from '@holotype/ir';
import { resolveCssColor } from './color';
import type { CollectContext } from './types';

/**
 * Resolves a computed color for a node and reports `PAINT_COLOR_READBACK` when it needed the
 * canvas read-back (05 §7.1).
 */
export function readColor(context: CollectContext, nodeId: string, property: string, cssText: string): Color {
  const { color, readback } = resolveCssColor(cssText, context.readback);
  if (readback) context.report({ code: 'PAINT_COLOR_READBACK', nodeId, property, value: cssText });
  return color;
}
