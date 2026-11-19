import type { CReplaced, Mat2x3, ScenePaint } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { plainDiagnostic } from '../diagnostics';
import type { WorkNode } from '../state';
import { cropTransform, resolvePosition, type Size } from './image-geometry';
import { reportUnsupported } from './unsupported';

/*
 * Replaced content (07 §10.1, §10.7, §10.9): SVGs become `svg` nodes, images and rasters
 * become IMAGE fills. `<img>` follows the background table with `object-fit` and
 * `object-position`: `cover` → FILL, `contain` → FIT, `fill` → a CROP of the whole image,
 * `none` and `scale-down` → a CROP placed by `object-position`.
 */

type ImageReplaced = Extract<CReplaced, { kind: 'img' }>;

const IDENTITY_CROP: Mat2x3 = [
  [1, 0, 0],
  [0, 1, 0],
];

const CENTRED = /^50% 50%$|^center( center)?$/;

/** The image drawn at `size`, placed in the box by `object-position`. */
function placedCrop(replaced: ImageReplaced, size: Size, box: Size, notes: Diagnostic[]): ScenePaint {
  const asset = replaced.asset;
  const at = resolvePosition(replaced.objectPosition, { w: box.w - size.w, h: box.h - size.h });
  if (at === undefined) {
    reportUnsupported(notes, 'object-position', replaced.objectPosition, 'centred');
  }
  const x = at?.x ?? (box.w - size.w) / 2;
  const y = at?.y ?? (box.h - size.h) / 2;
  return { type: 'IMAGE', asset, scaleMode: 'CROP', imageTransform: cropTransform({ x, y, ...size }, box) };
}

function imagePaint(replaced: ImageReplaced, box: Size, notes: Diagnostic[]): ScenePaint {
  const { asset, natural, objectFit, objectPosition } = replaced;
  const fits = natural.w > 0 && natural.h > 0 && box.w > 0 && box.h > 0;
  const scaled = (scaleMode: 'FILL' | 'FIT'): ScenePaint => {
    // Figma centres FILL and FIT; another position has no Scene form.
    if (!CENTRED.test(objectPosition.trim())) reportUnsupported(notes, 'object-position', objectPosition, 'centred');
    return { type: 'IMAGE', asset, scaleMode };
  };
  switch (objectFit) {
    case 'cover':
      return scaled('FILL');
    case 'contain':
      return scaled('FIT');
    case 'fill':
      // CSS `fill` stretches the image to the box: a CROP whose image rect is the box.
      return { type: 'IMAGE', asset, scaleMode: 'CROP', imageTransform: IDENTITY_CROP };
    case 'none':
      if (fits) return placedCrop(replaced, natural, box, notes);
      break;
    case 'scale-down':
      if (!fits) break;
      return natural.w <= box.w && natural.h <= box.h ? placedCrop(replaced, natural, box, notes) : scaled('FIT');
    default:
      break;
  }
  reportUnsupported(notes, 'object-fit', objectFit, 'drawn with object-fit: contain');
  return { type: 'IMAGE', asset, scaleMode: 'FIT' };
}

/**
 * Applies a node's replaced content. Returns the paint to put on top of the box fills, if
 * any. A raster replaces its whole subtree, so the node loses its children.
 */
export function applyReplaced(node: WorkNode, notes: Diagnostic[]): ScenePaint | undefined {
  const replaced = node.capture.replaced;
  if (replaced === undefined || node.paintHidden) return undefined;
  switch (replaced.kind) {
    case 'svg':
      node.fields.svg = { asset: replaced.asset, unwrap: true };
      return undefined;
    case 'img':
      return imagePaint(replaced, node.box, notes);
    case 'raster':
      node.children = [];
      notes.push(plainDiagnostic('PAINT_SUBTREE_RASTERIZED', { data: { reason: replaced.reason } }));
      return { type: 'IMAGE', asset: replaced.asset, scaleMode: 'FILL' };
    case 'control':
      if (replaced.nativeAppearance) {
        reportUnsupported(notes, 'appearance', replaced.control, 'drawn as its box, without the native control');
      }
      return undefined;
  }
}
