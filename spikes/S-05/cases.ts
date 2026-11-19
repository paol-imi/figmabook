/**
 * S-05 border cases. The same data drives the Chromium reference render (`refs.ts`, in the
 * container) and the Figma build (`plugin.ts`), so both sides draw the same box.
 */

/** top, right, bottom, left (CSS order). */
export type Sides<T> = readonly [T, T, T, T];

export type BorderCase = {
  readonly id: string;
  readonly label: string;
  readonly border: {
    readonly widths: Sides<number>;
    readonly colors: Sides<string>;
    readonly style: 'solid' | 'dashed';
  } | null;
  readonly outline: { readonly width: number; readonly color: string } | null;
  /** The box is an auto-layout frame (true) or a plain frame with an absolute child (false). */
  readonly autoLayout: boolean;
};

export const BOX = { width: 120, height: 72, padding: 8, fill: '#f1f5f9' } as const;
export const CHILD = { width: 40, height: 20, fill: '#4f46e5' } as const;
/** White margin around the box, so outlines and outside strokes are inside the picture. */
export const MARGIN = 8;
export const CANVAS = { width: BOX.width + 2 * MARGIN, height: BOX.height + 2 * MARGIN, fill: '#ffffff' } as const;

const ink = '#0f172a';
const same = <T>(value: T): Sides<T> => [value, value, value, value];

const kinds: readonly Omit<BorderCase, 'id' | 'autoLayout'>[] = [
  { label: 'uniform 1px', border: { widths: same(1), colors: same(ink), style: 'solid' }, outline: null },
  { label: 'uniform 4px', border: { widths: same(4), colors: same(ink), style: 'solid' }, outline: null },
  {
    label: 'per-side widths 1/2/3/4',
    border: { widths: [1, 2, 3, 4], colors: same(ink), style: 'solid' },
    outline: null,
  },
  {
    label: 'per-side colors 3px',
    border: { widths: same(3), colors: ['#ef4444', '#22c55e', '#3b82f6', '#eab308'], style: 'solid' },
    outline: null,
  },
  { label: 'dashed 2px', border: { widths: same(2), colors: same(ink), style: 'dashed' }, outline: null },
  { label: 'outline 2px, no border', border: null, outline: { width: 2, color: '#0ea5e9' } },
];

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const CASES: readonly BorderCase[] = kinds.flatMap((kind) => [
  { ...kind, id: `${slug(kind.label)}-al`, autoLayout: true },
  { ...kind, id: `${slug(kind.label)}-abs`, autoLayout: false },
]);

/** True when all four sides share one value. */
export function uniform<T>(sides: Sides<T>): boolean {
  return sides.every((side) => side === sides[0]);
}

/** Where the child's top-left corner sits in CSS (border-box origin): border + padding. */
export function expectedChildOffset(testCase: BorderCase): { x: number; y: number } {
  const [top, , , left] = testCase.border?.widths ?? same(0);
  return { x: left + BOX.padding, y: top + BOX.padding };
}

/** CSS for one case, used by the Chromium reference renderer. */
export function caseHtml(testCase: BorderCase): string {
  const border = testCase.border;
  const borderCss = border
    ? `border-style:${border.style};border-width:${border.widths.map((w) => `${w}px`).join(' ')};border-color:${border.colors.join(' ')};`
    : '';
  const outlineCss = testCase.outline ? `outline:${testCase.outline.width}px solid ${testCase.outline.color};` : '';
  const layout = testCase.autoLayout ? 'display:flex;flex-direction:column;align-items:flex-start;' : 'display:block;';
  return (
    `<div id="canvas" style="width:${CANVAS.width}px;height:${CANVAS.height}px;padding:${MARGIN}px;box-sizing:border-box;background:${CANVAS.fill};">` +
    `<div id="box" style="box-sizing:border-box;width:${BOX.width}px;height:${BOX.height}px;padding:${BOX.padding}px;background:${BOX.fill};${borderCss}${outlineCss}${layout}">` +
    `<div id="child" style="width:${CHILD.width}px;height:${CHILD.height}px;background:${CHILD.fill};flex:none;"></div>` +
    '</div></div>'
  );
}
