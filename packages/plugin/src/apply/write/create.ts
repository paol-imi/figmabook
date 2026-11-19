/*
 * Step 0: create the Figma node for a Scene IR node (09 §6). Each create call puts the node
 * on the current page; step 1 moves it to its parent. Vectors get their paths here, before
 * step 4 sizes them; SVGs are imported and unwrapped here (09 §6.3).
 */
import type { SceneNode as IrNode, Rect } from '@holotype/ir';
import { createDiagnostic, diagnostic } from '@holotype/shared';
import type { WriteContext } from './types';

export interface CreatedNode {
  readonly node: SceneNode;
  /** The node's box in its parent; differs from the scene box for an unwrapped SVG child. */
  readonly box: Rect;
  /** A fresh `createFrame()` (100 × 100, white fill) that needs the step 2 defaults. */
  readonly freshFrame: boolean;
  /** Runs once the node is attached: removes an emptied SVG wrapper. */
  readonly afterAttach?: () => void;
}

/**
 * Kinds without a creation API of their own are frames: a variant root (`component`) is a
 * frame until component sets arrive (B-57), and a `group` cannot be created empty.
 */
export function createNode(scene: IrNode, box: Rect, context: WriteContext): CreatedNode {
  const { port } = context;
  switch (scene.kind) {
    case 'rectangle':
    case 'image':
      return { node: port.createRectangle(), box, freshFrame: false };
    case 'ellipse':
      return { node: port.createEllipse(), box, freshFrame: false };
    case 'text':
      return { node: port.createText(), box, freshFrame: false };
    case 'vector': {
      const vector = port.createVector();
      vector.vectorPaths = (scene.vector?.paths ?? []).map(({ windingRule, data }) => ({ windingRule, data }));
      return { node: vector, box, freshFrame: false };
    }
    case 'svg':
      return importSvg(scene, box, context);
    default:
      return { node: port.createFrame(), box, freshFrame: true };
  }
}

/** Whether a frame paints anything itself (unwrap only lifts a child out of a bare wrapper). */
function hasOwnVisuals(frame: FrameNode): boolean {
  const { fills } = frame;
  // `figma.mixed` (a symbol) cannot occur on a frame's fills; treat it as painted to be safe.
  return typeof fills === 'symbol' || fills.length > 0 || frame.strokes.length > 0 || frame.effects.length > 0;
}

/**
 * `createNodeFromSvg` returns a wrapper frame. With `unwrap` and a single child, the child
 * takes the wrapper's place, scaled from the SVG's own size to the scene box. A failed or
 * empty import becomes an empty frame of the same box with `SVG_IMPORT_FAILED`; the Scene IR
 * carries no raster for it yet (see plan gaps).
 */
function importSvg(scene: IrNode, box: Rect, context: WriteContext): CreatedNode {
  const { port, resources } = context;
  const source = scene.svg ? resources.svg(scene.svg.asset.sha) : null;
  let wrapper: FrameNode | undefined;
  let reason = source === null ? 'the SVG file could not be read' : '';
  if (source !== null) {
    try {
      wrapper = port.createNodeFromSvg(source);
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  if (wrapper && wrapper.children.length === 0) {
    wrapper.remove();
    wrapper = undefined;
    reason = 'the SVG has no drawable content';
  }
  if (wrapper === undefined) {
    context.emit(
      createDiagnostic(diagnostic('SVG_IMPORT_FAILED'), undefined, {
        sid: context.sid,
        variantKey: context.variantKey,
        nodeKey: scene.nk,
        ...(scene.svg ? { value: scene.svg.asset.sha } : {}),
        fallback: 'an empty frame of the same size',
        data: { reason },
      }),
    );
    return { node: port.createFrame(), box, freshFrame: true };
  }
  const [child] = wrapper.children;
  if (!scene.svg?.unwrap || wrapper.children.length !== 1 || child === undefined || hasOwnVisuals(wrapper)) {
    return { node: wrapper, box, freshFrame: false };
  }
  const sx = box.w / wrapper.width;
  const sy = box.h / wrapper.height;
  const emptied = wrapper;
  return {
    node: child,
    box: { x: box.x + child.x * sx, y: box.y + child.y * sy, w: child.width * sx, h: child.height * sy },
    freshFrame: false,
    afterAttach: () => emptied.remove(),
  };
}
