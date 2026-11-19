/**
 * S-05 main thread. Builds every border case twice:
 *   model A (D-16): INSIDE stroke, padding = CSS padding + border, strokesIncludedInLayout=false
 *   model B:        INSIDE stroke, padding = CSS padding,          strokesIncludedInLayout=true
 * reads the child position and exports a 1x PNG for the UI to score. Also builds the A/B pair
 * a designer edits by hand, and reads that edit back.
 */
import { createLabel, probe, roleOf, setRole, solid, usePage } from '../_shared/figma.ts';
import type { MainContext } from '../_shared/spike.ts';
import { BOX, type BorderCase, CANVAS, CASES, CHILD, MARGIN, uniform } from './cases.ts';

export const PAGE_NAME = 'S-05 Border model';
export type Model = 'A' | 'B';
export const MODELS: readonly Model[] = ['A', 'B'];

/** How a case is drawn in Figma. Per-side colors have no stroke equivalent: edge rectangles. */
export function technique(testCase: BorderCase): 'stroke' | 'edges' | 'outline' | 'none' {
  if (testCase.outline) return 'outline';
  if (!testCase.border) return 'none';
  return uniform(testCase.border.colors) ? 'stroke' : 'edges';
}

/** Padding per side (top, right, bottom, left) that a model writes into the box. */
export function modelPadding(testCase: BorderCase, model: Model): [number, number, number, number] {
  const widths = testCase.border?.widths ?? [0, 0, 0, 0];
  // Model B lets Figma add the stroke; edge rectangles are not strokes, so B adds them too.
  const addBorder = model === 'A' || technique(testCase) === 'edges';
  return widths.map((width) => BOX.padding + (addBorder ? width : 0)) as [number, number, number, number];
}

function addEdges(figma: PluginAPI, box: FrameNode, testCase: BorderCase): void {
  if (!testCase.border) return;
  const [top, right, bottom, left] = testCase.border.widths;
  const [cTop, cRight, cBottom, cLeft] = testCase.border.colors;
  const edges: Array<[string, number, number, number, number]> = [
    [cTop, 0, 0, BOX.width, top],
    [cRight, BOX.width - right, 0, right, BOX.height],
    [cBottom, 0, BOX.height - bottom, BOX.width, bottom],
    [cLeft, 0, 0, left, BOX.height],
  ];
  for (const [color, x, y, width, height] of edges) {
    const edge = figma.createRectangle();
    edge.name = 'Edge';
    box.appendChild(edge);
    if (box.layoutMode !== 'NONE') edge.layoutPositioning = 'ABSOLUTE';
    edge.resize(width, height);
    edge.x = x;
    edge.y = y;
    edge.fills = [solid(color)];
  }
}

function applyBorder(box: FrameNode, testCase: BorderCase, dash: { dash: number; gap: number } | null): void {
  const kind = technique(testCase);
  if (kind === 'outline' && testCase.outline) {
    box.strokes = [solid(testCase.outline.color)];
    box.strokeAlign = 'OUTSIDE';
    box.strokeWeight = testCase.outline.width;
    return;
  }
  if (kind !== 'stroke' || !testCase.border) return;
  const [top, right, bottom, left] = testCase.border.widths;
  box.strokes = [solid(testCase.border.colors[0])];
  box.strokeAlign = 'INSIDE';
  if (uniform(testCase.border.widths)) box.strokeWeight = top;
  else {
    box.strokeTopWeight = top;
    box.strokeRightWeight = right;
    box.strokeBottomWeight = bottom;
    box.strokeLeftWeight = left;
  }
  if (testCase.border.style === 'dashed') box.dashPattern = dash ? [dash.dash, dash.gap] : [top * 3, top * 3];
}

/** Builds one case for one model inside a white canvas frame; returns the canvas and child. */
export function buildCase(
  figma: PluginAPI,
  testCase: BorderCase,
  model: Model,
  dash: { dash: number; gap: number } | null,
): { canvas: FrameNode; box: FrameNode; child: FrameNode } {
  const canvas = figma.createFrame();
  canvas.name = `${testCase.id} · ${model}`;
  canvas.resize(CANVAS.width, CANVAS.height);
  canvas.fills = [solid(CANVAS.fill)];
  canvas.clipsContent = true;

  const box = figma.createFrame();
  box.name = 'Box';
  box.resize(BOX.width, BOX.height);
  box.fills = [solid(BOX.fill)];
  box.clipsContent = false;
  canvas.appendChild(box);
  box.x = MARGIN;
  box.y = MARGIN;

  const child = figma.createFrame();
  child.name = 'Child';
  child.resize(CHILD.width, CHILD.height);
  child.fills = [solid(CHILD.fill)];

  if (testCase.autoLayout) {
    const [top, right, bottom, left] = modelPadding(testCase, model);
    box.layoutMode = 'VERTICAL';
    box.primaryAxisSizingMode = 'FIXED';
    box.counterAxisSizingMode = 'FIXED';
    box.primaryAxisAlignItems = 'MIN';
    box.counterAxisAlignItems = 'MIN';
    box.paddingTop = top;
    box.paddingRight = right;
    box.paddingBottom = bottom;
    box.paddingLeft = left;
    box.strokesIncludedInLayout = model === 'B';
    box.resize(BOX.width, BOX.height);
    box.appendChild(child);
  } else {
    // Without auto layout, positions are absolute captured rects: both models place the child at
    // border + padding. These cases only compare how the stroke is drawn.
    const [absTop, , , absLeft] = modelPadding(testCase, 'A');
    box.appendChild(child);
    child.x = absLeft;
    child.y = absTop;
  }
  applyBorder(box, testCase, dash);
  if (technique(testCase) === 'edges') addEdges(figma, box, testCase);
  return { canvas, box, child };
}

export type BuiltCase = {
  caseId: string;
  model: Model;
  technique: string;
  child: { x: number; y: number } | null;
  png: Uint8Array | null;
  error: string | null;
};

async function build(
  { figma, progress }: MainContext,
  input: { dashes: Record<string, { dash: number; gap: number }> },
) {
  progress('Building the border cases…');
  const page = await usePage(figma, PAGE_NAME);
  const built: BuiltCase[] = [];
  for (const [row, testCase] of CASES.entries()) {
    const label = await createLabel(
      figma,
      `${testCase.label} · ${testCase.autoLayout ? 'auto layout' : 'no auto layout'}`,
      11,
    );
    page.appendChild(label);
    label.x = 0;
    label.y = row * (CANVAS.height + 28);
    for (const [column, model] of MODELS.entries()) {
      progress(`Case ${row + 1} of ${CASES.length}, model ${model}`);
      const result = await probe(async () => {
        const { canvas, child } = buildCase(figma, testCase, model, input.dashes[testCase.id] ?? null);
        page.appendChild(canvas);
        canvas.x = column * (CANVAS.width + 24);
        canvas.y = label.y + 16;
        const png = await canvas.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
        return { child: { x: child.x, y: child.y }, png };
      });
      built.push(
        result.ok
          ? {
              caseId: testCase.id,
              model,
              technique: technique(testCase),
              child: result.value.child,
              png: result.value.png,
              error: null,
            }
          : { caseId: testCase.id, model, technique: technique(testCase), child: null, png: null, error: result.error },
      );
    }
  }
  await buildDesignerPair(figma, page, CASES.length * (CANVAS.height + 28) + 40);
  return { built };
}

/** Two "Button" frames the designer edits: A (D-16) and B (strokes included). */
async function buildDesignerPair(figma: PluginAPI, page: PageNode, y: number): Promise<void> {
  const title = await createLabel(
    figma,
    'Designer check: change the stroke width of A and of B to 3. Which one feels right?',
    12,
  );
  page.appendChild(title);
  title.y = y;
  for (const [index, model] of MODELS.entries()) {
    const frame = figma.createFrame();
    frame.name = `S-05 ${model}`;
    setRole(frame, `designer-${model}`);
    frame.layoutMode = 'HORIZONTAL';
    frame.primaryAxisSizingMode = 'AUTO';
    frame.counterAxisSizingMode = 'AUTO';
    const border = 1;
    const extra = model === 'A' ? border : 0;
    frame.paddingTop = 12 + extra;
    frame.paddingBottom = 12 + extra;
    frame.paddingLeft = 16 + extra;
    frame.paddingRight = 16 + extra;
    frame.strokesIncludedInLayout = model === 'B';
    frame.strokes = [solid('#0f172a')];
    frame.strokeAlign = 'INSIDE';
    frame.strokeWeight = border;
    frame.cornerRadius = 6;
    frame.fills = [solid('#ffffff')];
    const text = await createLabel(figma, 'Button', 14);
    text.name = 'Label';
    frame.appendChild(text);
    const tag = await createLabel(figma, model, 20);
    page.appendChild(tag);
    page.appendChild(frame);
    tag.x = index * 200;
    tag.y = y + 28;
    frame.x = index * 200;
    frame.y = y + 60;
  }
}

/** Reads the designer's edit on the A/B pair. */
async function readEdit({ figma }: MainContext, _input: null) {
  const page = await usePage(figma, PAGE_NAME);
  const read = (model: Model) => {
    const frame = page.findOne((node) => node.type === 'FRAME' && roleOf(node) === `designer-${model}`);
    if (frame?.type !== 'FRAME') return null;
    const child = frame.children[0];
    const weight = frame.strokeWeight;
    return {
      strokeWeight: typeof weight === 'number' ? weight : 'mixed',
      sideWeights: [frame.strokeTopWeight, frame.strokeRightWeight, frame.strokeBottomWeight, frame.strokeLeftWeight],
      padding: [frame.paddingTop, frame.paddingRight, frame.paddingBottom, frame.paddingLeft],
      strokesIncludedInLayout: frame.strokesIncludedInLayout,
      size: { width: frame.width, height: frame.height },
      label: child ? { x: child.x, y: child.y } : null,
    };
  };
  return { A: read('A'), B: read('B') };
}

export const s05Tasks = { 'S-05/build': build, 'S-05/read-edit': readEdit };
