import type { BundleFeature, SceneComponent, SceneNode } from '@holotype/ir';

/*
 * Facts the manifest records about a component's Scene IR (06 §4.2): its node count, the
 * assets and fonts it uses and the bundle features it needs.
 */

function* walk(node: SceneNode): Generator<SceneNode> {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
  if (node.instance?.fallback) yield* walk(node.instance.fallback);
}

function* nodesOf(scene: SceneComponent): Generator<SceneNode> {
  for (const variant of scene.variants) yield* walk(variant.root);
}

/** Nodes of every variant root and its children (instance fallbacks are not counted). */
export function countNodes(scene: SceneComponent): number {
  const count = (node: SceneNode): number => 1 + (node.children ?? []).reduce((sum, child) => sum + count(child), 0);
  return scene.variants.reduce((sum, variant) => sum + count(variant.root), 0);
}

/** sha256 of every asset a component refers to (SVG content, IMAGE paints), sorted. */
export function assetRefs(scene: SceneComponent): string[] {
  const shas = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'asset' && typeof item === 'object' && item !== null && 'sha' in item) {
        if (typeof item.sha === 'string') shas.add(item.sha);
      } else {
        visit(item);
      }
    }
  };
  for (const variant of scene.variants) visit(variant.root);
  return [...shas].sort();
}

export interface FontUse {
  readonly family: string;
  readonly styles: ReadonlySet<string>;
  readonly isCustom: boolean;
}

/** The font families text ranges request, each with the preferred style names (09 §fonts). */
export function fontUses(scene: SceneComponent): FontUse[] {
  const byFamily = new Map<string, { styles: Set<string>; isCustom: boolean }>();
  for (const node of nodesOf(scene)) {
    for (const range of node.text?.ranges ?? []) {
      const { family, styleCandidates, isCustom } = range.font;
      const entry = byFamily.get(family) ?? { styles: new Set<string>(), isCustom: false };
      const [style] = styleCandidates;
      if (style !== undefined) entry.styles.add(style);
      entry.isCustom ||= isCustom;
      byFamily.set(family, entry);
    }
  }
  return [...byFamily].map(([family, { styles, isCustom }]) => ({ family, styles, isCustom }));
}

/**
 * Features a consumer must understand to apply the component (06 §7). The slice mapper
 * emits only `locked-lines` text among the gated semantics.
 */
export function featuresOf(scene: SceneComponent): BundleFeature[] {
  for (const node of nodesOf(scene)) {
    if (node.text?.wrapMode === 'locked-lines') return ['locked-lines'];
  }
  return [];
}
