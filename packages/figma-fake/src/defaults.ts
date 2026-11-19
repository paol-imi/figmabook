import { type DocumentContext, type FakeNodeType, NodeState } from './state';
import { deepFreeze } from './values';

function solid(r: number, g: number, b: number): readonly Paint[] {
  return deepFreeze([
    { type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color: { r, g, b }, boundVariables: {} },
  ]);
}

/** `#D9D9D9`, the default shape fill of the editor. */
const SHAPE_GREY = 217 / 255;
/** `#F5F5F5`, the default canvas background. */
const CANVAS_GREY = 245 / 255;
/** `#9747FF`, the dashed outline of a component set. */
const SET_PURPLE: readonly [number, number, number] = [151 / 255, 71 / 255, 1];

/**
 * Per-type defaults of a new node.
 *
 * - Frame: white fill, 100x100, clips content: "the new node has a white background, width
 *   and height both at 100" (typings:1069-1086).
 * - Rectangle, ellipse: "a default fill, width and height both at 100" (typings:911-980).
 * - Component: 100x100 with no fill: the typings mention no background (typings:1088-1102).
 * - Vector: "has a bounding box but doesn't have any vertices" (typings:1036-1041).
 * - Text: "the text has no characters" (typings:1043-1067); size grows with text in B-54.
 * - Section, page, component set: values the editor uses; see README "Differences".
 */
function applyTypeDefaults(state: NodeState): void {
  switch (state.type) {
    case 'FRAME':
      state.fills = solid(1, 1, 1);
      break;
    case 'COMPONENT':
      state.clipsContent = false;
      break;
    case 'COMPONENT_SET':
      state.clipsContent = false;
      state.strokes = solid(...SET_PURPLE);
      state.dashPattern = deepFreeze([10, 5]);
      state.topLeftRadius = 5;
      state.topRightRadius = 5;
      state.bottomRightRadius = 5;
      state.bottomLeftRadius = 5;
      break;
    case 'RECTANGLE':
    case 'ELLIPSE':
      state.fills = solid(SHAPE_GREY, SHAPE_GREY, SHAPE_GREY);
      break;
    case 'VECTOR':
      state.strokeAlign = 'CENTER';
      break;
    case 'TEXT':
      state.strokeAlign = 'OUTSIDE';
      state.width = 0;
      state.height = 14;
      break;
    case 'SECTION':
      state.fills = solid(1, 1, 1);
      break;
    case 'PAGE':
      state.pageBackgrounds = solid(CANVAS_GREY, CANVAS_GREY, CANVAS_GREY);
      state.width = 0;
      state.height = 0;
      break;
    case 'DOCUMENT':
      state.width = 0;
      state.height = 0;
      break;
  }
}

/** A new node state of `type` with its type defaults. Every node is created through here. */
export function newState(ctx: DocumentContext, type: FakeNodeType, id: string, name: string): NodeState {
  const state = new NodeState(ctx, type, id, name);
  applyTypeDefaults(state);
  return state;
}
