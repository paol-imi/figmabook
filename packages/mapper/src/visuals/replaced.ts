import type { CReplaced, ScenePaint } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { plainDiagnostic } from '../diagnostics';
import type { WorkNode } from '../state';
import { reportUnsupported } from './unsupported';

/*
 * Replaced content (07 §10.1, §10.7, §10.9): SVGs become `svg` nodes, images and rasters
 * become IMAGE fills. `object-fit: none | scale-down` need a CROP transform from
 * `object-position` (B-48); until then they are drawn with FIT and reported.
 */

type ImageReplaced = Extract<CReplaced, { kind: 'img' }>;

const IDENTITY_CROP: [[number, number, number], [number, number, number]] = [
  [1, 0, 0],
  [0, 1, 0],
];

function imagePaint(replaced: ImageReplaced, notes: Diagnostic[]): ScenePaint {
  const asset = replaced.asset;
  switch (replaced.objectFit) {
    case 'cover':
      return { type: 'IMAGE', asset, scaleMode: 'FILL' };
    case 'contain':
      return { type: 'IMAGE', asset, scaleMode: 'FIT' };
    case 'fill':
      // CSS `fill` stretches the image to the box: a CROP whose image rect is the box.
      return { type: 'IMAGE', asset, scaleMode: 'CROP', imageTransform: IDENTITY_CROP };
    default:
      reportUnsupported(notes, 'object-fit', replaced.objectFit, 'drawn with object-fit: contain');
      return { type: 'IMAGE', asset, scaleMode: 'FIT' };
  }
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
      return imagePaint(replaced, notes);
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
