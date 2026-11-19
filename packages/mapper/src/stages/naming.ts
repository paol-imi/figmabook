import type { CaptureDoc, ScenePropertyDef } from '@holotype/ir';
import { classFilter } from '../naming/classes';
import { assignKeys } from '../naming/keys';
import { assignNames } from '../naming/names';
import type { ComponentStage } from './types';

/*
 * Stage 13, naming finalization (07 §12–§13.3): node keys and unique sibling names. The
 * variant root is named `Prop=Value, …` in a set (Figma's variant naming), else after the
 * component.
 */

/** Capture node id → component display name for every framework boundary root. */
function boundaryNames(capture: CaptureDoc): Map<string, string> {
  const names = new Map<string, string>();
  for (const boundary of capture.framework?.boundaries ?? []) {
    for (const id of boundary.nodeIds) if (!names.has(id)) names.set(id, boundary.displayName);
  }
  return names;
}

/** Figma's variant name, `Size=Large, State=Hover`, in property display order. */
export function variantName(properties: readonly ScenePropertyDef[], values: Readonly<Record<string, string>>): string {
  return properties
    .flatMap((def) =>
      def.type === 'VARIANT' && values[def.key] !== undefined ? [`${def.name}=${values[def.key]}`] : [],
    )
    .join(', ');
}

export const namingStage: ComponentStage = {
  step: 13,
  name: 'naming',
  per: 'component',
  run(component) {
    const { naming } = component.input.config;
    const keepClass = classFilter(naming.stripClassPatterns);
    const componentName = component.input.meta.identity.displayName;
    for (const variant of component.variants) {
      const boundaries = boundaryNames(variant.capture);
      assignKeys(variant.root, { boundaries, keepClass });
      const rootName = variantName(component.properties, variant.planned.values) || componentName;
      assignNames(variant.root, rootName, { layers: naming.layers, boundaries, keepClass });
    }
  },
};
