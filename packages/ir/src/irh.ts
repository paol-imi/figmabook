import { canonicalJSON } from './canonical';
import { h16, hash } from './hash';
import { sceneNumKind } from './num-kinds';
import type { BundleManifest } from './schema/bundle';
import type { ResolvedDcrConfig } from './schema/config';
import type { JsonValue, PseudoStateSpec, Viewport } from './schema/primitives';
import type { SceneComponent, SceneNode, SceneVariant } from './schema/scene';
import type { TokensDoc } from './schema/tokens';

/*
 * The content hashes of 06 §6, in one place (D-52). Producers compute them; the plugin only
 * compares them. Scene and tokens hashes round numbers with `sceneNumKind`.
 */

const sceneHash = (value: unknown): string => hash(value, { numKind: sceneNumKind });

/** The render a variant key identifies (06 §6, README glossary). */
export interface VariantKeyInput {
  readonly storyId: string;
  readonly args: Readonly<Record<string, JsonValue>>;
  readonly globals: Readonly<Record<string, JsonValue>>;
  readonly state: PseudoStateSpec | null;
  readonly viewport: Viewport;
}

/** `vk = h16(canonical({storyId, args, globals, state, viewport}))`. */
export function variantKey(input: VariantKeyInput): string {
  const { storyId, args, globals, state, viewport } = input;
  return hash({ storyId, args, globals, state, viewport });
}

/**
 * Node `irh` (06 §6) from the node's own fields and its children's `nk` and `irh`, which must
 * already be set (hash bottom-up, or use `withSceneHashes`). Excluded: `nk` (the parent's
 * child list carries it), `irh`, `expect`, `source`, `diagnostics`, `layout.verified`,
 * `child.intent`, `instance.match`, and `text.lines` in reflow mode. An instance's
 * `fallback` subtree enters as its `nk:irh`, so its excluded fields stay excluded.
 */
export function sceneNodeIrh(node: SceneNode): string {
  const { verified: _verified, ...layout } = node.layout ?? {};
  const { intent: _intent, ...child } = node.child ?? {};
  const { match: _match, fallback, ...instance } = node.instance ?? {};
  const text = node.text && node.text.wrapMode === 'reflow' ? { ...node.text, lines: undefined } : node.text;
  return sceneHash({
    kind: node.kind,
    name: node.name,
    size: node.size,
    relativeTransform: node.relativeTransform,
    xy: node.xy,
    visible: node.visible,
    opacity: node.opacity,
    blendMode: node.blendMode,
    isMask: node.isMask,
    maskType: node.maskType,
    clipsContent: node.clipsContent,
    fills: node.fills,
    strokes: node.strokes,
    radius: node.radius,
    effects: node.effects,
    layout: node.layout ? layout : undefined,
    fallback: node.fallback,
    child: node.child ? child : undefined,
    text,
    vector: node.vector,
    svg: node.svg,
    instance: node.instance ? { ...instance, fallback: fallback ? childRef(fallback) : undefined } : undefined,
    bind: node.bind,
    propRefs: node.propRefs,
    slot: node.slot,
    children: node.children?.map(childRef),
  });
}

const childRef = (node: SceneNode): string => `${node.nk}:${node.irh}`;

/** Variant `irh = H(values, root.irh)`. */
export function sceneVariantIrh(variant: Pick<SceneVariant, 'values' | 'root'>): string {
  return sceneHash({ values: variant.values, root: variant.root.irh });
}

/**
 * Component `irh = H(meta minus links' volatile parts, properties, setLayout, docFrame,
 * variants[].irh, dependencies)`. A link's volatile part is its origin: the same docs page
 * on another Storybook host hashes the same. Variants enter in document order, `(row, col)`.
 */
export function sceneComponentIrh(scene: Omit<SceneComponent, 'irh'>): string {
  return sceneHash({
    meta: { ...scene.meta, links: scene.meta.links.map(({ label, url }) => ({ label, url: withoutOrigin(url) })) },
    properties: scene.properties,
    setLayout: scene.setLayout,
    docFrame: scene.docFrame,
    variants: scene.variants.map((variant) => variant.irh),
    dependencies: scene.dependencies,
  });
}

function withoutOrigin(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url);
  return match ? url.slice(match[0].length) || '/' : url;
}

function withNodeHashes(node: SceneNode): SceneNode {
  const children = node.children?.map(withNodeHashes);
  const instance = node.instance?.fallback
    ? { ...node.instance, fallback: withNodeHashes(node.instance.fallback) }
    : node.instance;
  const next: SceneNode = {
    ...node,
    ...(children === undefined ? {} : { children }),
    ...(instance === undefined ? {} : { instance }),
  };
  return { ...next, irh: sceneNodeIrh(next) };
}

/** Returns a copy of `scene` with every node, variant and component `irh` recomputed bottom-up. */
export function withSceneHashes(scene: SceneComponent): SceneComponent {
  const variants = scene.variants.map((variant) => {
    const root = withNodeHashes(variant.root);
    return { ...variant, root, irh: sceneVariantIrh({ values: variant.values, root }) };
  });
  const next = { ...scene, variants };
  return { ...next, irh: sceneComponentIrh(next) };
}

/** A stored hash that does not match its content. */
export interface HashMismatch {
  /** JSON pointer of the `irh` field. */
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
}

/** Lists every `irh` in `scene` that differs from the recomputed value. Empty when consistent. */
export function checkSceneHashes(scene: SceneComponent): HashMismatch[] {
  const mismatches: HashMismatch[] = [];
  const visit = (node: SceneNode, path: string): void => {
    node.children?.forEach((child, i) => {
      visit(child, `${path}/children/${i}`);
    });
    if (node.instance?.fallback) visit(node.instance.fallback, `${path}/instance/fallback`);
    const expected = sceneNodeIrh(node);
    if (expected !== node.irh) mismatches.push({ path: `${path}/irh`, expected, actual: node.irh });
  };
  scene.variants.forEach((variant, i) => {
    visit(variant.root, `/variants/${i}/root`);
    const expected = sceneVariantIrh(variant);
    if (expected !== variant.irh) mismatches.push({ path: `/variants/${i}/irh`, expected, actual: variant.irh });
  });
  const expected = sceneComponentIrh(scene);
  if (expected !== scene.irh) mismatches.push({ path: '/irh', expected, actual: scene.irh });
  return mismatches;
}

/**
 * Tokens `irh = H(collections, variables minus provenance.usedBy and the preflight match,
 * textStyles, effectStyles)`. Styles are content the plugin writes, so they are included.
 */
export function tokensIrh(tokens: Omit<TokensDoc, 'irh'>): string {
  return sceneHash({
    collections: tokens.collections,
    variables: tokens.variables.map(({ match: _match, provenance, ...variable }) => ({
      ...variable,
      provenance: { cssName: provenance.cssName, declaredAt: provenance.declaredAt },
    })),
    textStyles: tokens.textStyles,
    effectStyles: tokens.effectStyles,
  });
}

/**
 * Bundle fingerprint `bundleFp = h16(sorted components[].irh ∥ tokens.irh ∥ config.hash)`
 * (06 §6), stored as `fp` / `baselineFp`. Not `source.fingerprint` (the Storybook build).
 */
export function bundleFingerprint(manifest: Pick<BundleManifest, 'components' | 'tokens' | 'config'>): string {
  const irhs = manifest.components.map((component) => component.irh).sort();
  return h16(`${irhs.join('')}${manifest.tokens?.irh ?? ''}${manifest.config.hash}`);
}

/** `configHash = h16(canonical(dcrConfig))` (06 §4.2 branch block, D-50). */
export function dcrConfigHash(config: ResolvedDcrConfig): string {
  return h16(canonicalJSON(config));
}
