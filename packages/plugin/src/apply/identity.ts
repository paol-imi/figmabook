/*
 * Identity in shared plugin data, namespace `holotype` (10 §2, D-19). A fresh node gets its
 * provisional `nk` right after creation (crash-safe resume, 09 §13); the full record is
 * written last, once the node is complete (09 §6 step 10). `ah` follows once the whole variant
 * is written and read back (10 §9.1).
 */
import type { SceneNode as IrNode, SceneVariant } from '@holotype/ir';
import { canonicalJSON } from '@holotype/ir/core';

export const IDENTITY_NAMESPACE = 'holotype';

/** Bumped when the applier writes a node differently for the same Scene IR (10 §10.2). */
export const APPLIER_EPOCH = 1;

/** `v`: `"<irMajor>.<applierEpoch>"`. */
export const identityVersion = (sceneMajor: number): string => `${sceneMajor}.${APPLIER_EPOCH}`;

/** The `args` key holds at most this many characters (10 §2.1). */
export const ARGS_MAX_LENGTH = 8192;

type PluginDataNode = Pick<BaseNode, 'getSharedPluginData' | 'setSharedPluginData'>;

/** Writes a key unless it already holds `value` (10 §2.2: unchanged values are not rewritten). */
function put(node: PluginDataNode, key: string, value: string): void {
  if (node.getSharedPluginData(IDENTITY_NAMESPACE, key) !== value) {
    node.setSharedPluginData(IDENTITY_NAMESPACE, key, value);
  }
}

export function writeProvisionalKey(node: PluginDataNode, nk: string): void {
  put(node, 'nk', nk);
}

/** What a variant root carries on top of a descendant's keys. */
export interface VariantIdentity {
  readonly sid: string;
  readonly variant: SceneVariant;
  /** `identityVersion(...)` of the bundle. */
  readonly v: string;
}

/** `args` (10 §2.1): canonical `{ args, globals, state, viewport }`, truncated with `…`. */
export function variantArgs(variant: SceneVariant): string {
  const { args, globals, state, viewport } = variant.provenance;
  const json = canonicalJSON({ args, globals, state, viewport });
  return json.length <= ARGS_MAX_LENGTH ? json : `${json.slice(0, ARGS_MAX_LENGTH - 1)}…`;
}

/**
 * The identity record: `nk` and `irh` on every node; a variant root also gets `sid`, `vk`,
 * `v`, `story` and `args`. Descendants omit `v` while it equals the variant's (10 §2.1).
 */
export function writeIdentity(node: PluginDataNode, scene: IrNode, variant?: VariantIdentity): void {
  put(node, 'nk', scene.nk);
  if (variant) {
    put(node, 'sid', variant.sid);
    put(node, 'vk', variant.variant.vk);
  }
  put(node, 'irh', scene.irh);
  if (variant) {
    put(node, 'v', variant.v);
    put(node, 'story', variant.variant.provenance.storyId);
    put(node, 'args', variantArgs(variant.variant));
  }
}

/** `ah` (10 §9.1): the applied hash of the node's read-back groups, `appliedHashOf(node)`. */
export function writeAppliedHash(node: PluginDataNode, ah: string): void {
  put(node, 'ah', ah);
}
