import { createDiagnostic, type Diagnostic, PLAN_INVARIANT_VIOLATION } from '@holotype/shared';
import { dcrConfigHash } from './irh';
import type { BundleManifest } from './schema/bundle';
import type { SceneComponent, SceneNode, ScenePropertyDef } from './schema/scene';
import type { TokensDoc } from './schema/tokens';

/*
 * Semantic invariants the schemas cannot express (06 §9). A violation in mapper output is a
 * mapper bug: the component is skipped with `PLAN_INVARIANT_VIOLATION` (error).
 */

export type SceneInvariant =
  | 'root-kind'
  | 'vk-unique'
  | 'variant-order'
  | 'variant-values'
  | 'nk-unique'
  | 'nk-aligned'
  | 'sibling-names'
  | 'kind-content'
  | 'fallback-required'
  | 'fallback-children'
  | 'text-ranges'
  | 'prop-ref'
  | 'var-ref'
  | 'dependencies';

export interface InvariantViolation<I extends string = string> {
  readonly invariant: I;
  /** JSON pointer into the checked document. */
  readonly path: string;
  readonly message: string;
}

export interface SceneInvariantOptions {
  /** The bundle's `tokens.json`; when given, every `VarRef.key` must name one of its variables. */
  readonly tokens?: Pick<TokensDoc, 'variables'>;
}

/** Which property type each `propRefs` field must reference (09 §properties). */
const PROP_REF_TYPES = { characters: 'TEXT', visible: 'BOOLEAN', mainComponent: 'INSTANCE_SWAP' } as const;

const KIND_CONTENT: Partial<Record<SceneNode['kind'], keyof SceneNode>> = {
  text: 'text',
  instance: 'instance',
  vector: 'vector',
  svg: 'svg',
};

interface NodeVisit {
  readonly node: SceneNode;
  readonly path: string;
  readonly parentNk: string | undefined;
}

/** Walks a variant tree in document order (instance fallbacks are separate subtrees). */
function walk(root: SceneNode, rootPath: string): NodeVisit[] {
  const out: NodeVisit[] = [];
  const visit = (node: SceneNode, path: string, parentNk: string | undefined) => {
    out.push({ node, path, parentNk });
    node.children?.forEach((child, i) => {
      visit(child, `${path}/children/${i}`, node.nk);
    });
  };
  visit(root, rootPath, undefined);
  return out;
}

/** Checks the 06 §9 invariants of one `SceneComponent`. Returns every violation found. */
export function checkSceneInvariants(
  scene: SceneComponent,
  options: SceneInvariantOptions = {},
): InvariantViolation<SceneInvariant>[] {
  const violations: InvariantViolation<SceneInvariant>[] = [];
  const report = (invariant: SceneInvariant, path: string, message: string) =>
    violations.push({ invariant, path, message });

  const properties = new Map<string, ScenePropertyDef>(scene.properties.map((def) => [def.key, def]));
  const variantProps = scene.properties.filter((def) => def.type === 'VARIANT');
  const tokenKeys = options.tokens ? new Set(options.tokens.variables.map((variable) => variable.key)) : undefined;
  const localDeps = new Set<string>();
  const seenVk = new Set<string>();
  let reference: { childSets: Map<string, string>; index: number } | undefined;

  scene.variants.forEach((variant, vi) => {
    const vPath = `/variants/${vi}`;
    if (seenVk.has(variant.vk)) report('vk-unique', `${vPath}/vk`, `Variant key ${variant.vk} appears twice.`);
    seenVk.add(variant.vk);
    const previous = scene.variants[vi - 1];
    if (
      previous &&
      (variant.grid.row < previous.grid.row ||
        (variant.grid.row === previous.grid.row && variant.grid.col <= previous.grid.col))
    ) {
      report('variant-order', `${vPath}/grid`, 'Variants must be sorted by unique (row, col).');
    }
    checkVariantValues(variant.values, variantProps, `${vPath}/values`, report);
    if (variant.root.kind !== 'component') {
      report('root-kind', `${vPath}/root/kind`, `A variant root must be a component, not ${variant.root.kind}.`);
    }

    const nodes = walk(variant.root, `${vPath}/root`);
    const byNk = new Map<string, NodeVisit>();
    for (const visit of nodes) {
      const { node, path } = visit;
      if (byNk.has(node.nk)) report('nk-unique', `${path}/nk`, `Node key "${node.nk}" appears twice in this variant.`);
      byNk.set(node.nk, visit);
      checkNode(node, path, { properties, tokenKeys, localDeps, report });
    }

    // Alignment (07 §alignment): every variant has the same nodes under the same parents.
    const childSets = new Map<string, string>();
    for (const { node } of nodes)
      childSets.set(
        node.nk,
        (node.children ?? [])
          .map((c) => c.nk)
          .sort()
          .join('\n'),
      );
    if (reference === undefined) {
      reference = { childSets, index: vi };
    } else {
      const ref = reference;
      for (const nk of new Set([...childSets.keys(), ...ref.childSets.keys()])) {
        if (childSets.get(nk) !== ref.childSets.get(nk)) {
          const at = byNk.get(nk)?.path ?? `${vPath}/root`;
          report('nk-aligned', at, `Node "${nk}" is not aligned with variant ${ref.index} (07 §alignment).`);
        }
      }
    }
  });

  for (const sid of localDeps) {
    if (!scene.dependencies.includes(sid)) {
      report('dependencies', '/dependencies', `Instances of "${sid}" are used but it is not in dependencies.`);
    }
  }
  return violations;
}

type Report = (invariant: SceneInvariant, path: string, message: string) => void;

function checkVariantValues(
  values: Readonly<Record<string, string>>,
  variantProps: readonly ScenePropertyDef[],
  path: string,
  report: Report,
): void {
  for (const def of variantProps) {
    if (def.type !== 'VARIANT') continue;
    const value = values[def.key];
    if (value === undefined) report('variant-values', path, `Missing a value for VARIANT property "${def.key}".`);
    else if (!def.values.includes(value)) {
      report('variant-values', `${path}/${def.key}`, `"${value}" is not a value of VARIANT property "${def.key}".`);
    }
  }
  for (const key of Object.keys(values)) {
    if (!variantProps.some((def) => def.key === key)) {
      report('variant-values', `${path}/${key}`, `"${key}" is not a VARIANT property key.`);
    }
  }
}

interface NodeCheckContext {
  readonly properties: ReadonlyMap<string, ScenePropertyDef>;
  readonly tokenKeys: ReadonlySet<string> | undefined;
  readonly localDeps: Set<string>;
  readonly report: Report;
}

function checkNode(node: SceneNode, path: string, context: NodeCheckContext): void {
  const { properties, tokenKeys, localDeps, report } = context;
  const contentKey = KIND_CONTENT[node.kind];
  if (contentKey && node[contentKey] === undefined) {
    report('kind-content', path, `A ${node.kind} node needs its "${contentKey}" field.`);
  }
  if (node.layout && !node.fallback) {
    report('fallback-required', `${path}/fallback`, 'A node with auto layout needs a fallback (D-15).');
  }
  if (node.fallback) {
    const childNks = new Set((node.children ?? []).map((child) => child.nk));
    for (const nk of Object.keys(node.fallback.children)) {
      if (!childNks.has(nk)) report('fallback-children', `${path}/fallback/children`, `"${nk}" is not a child.`);
    }
  }
  const names = new Set<string>();
  node.children?.forEach((child, i) => {
    if (names.has(child.name)) {
      report('sibling-names', `${path}/children/${i}/name`, `Sibling name "${child.name}" is not unique.`);
    }
    names.add(child.name);
  });
  if (node.text) checkTextRanges(node.text, `${path}/text`, report);
  for (const [field, key] of Object.entries(node.propRefs ?? {})) {
    const expected = PROP_REF_TYPES[field as keyof typeof PROP_REF_TYPES];
    const def = key === undefined ? undefined : properties.get(key);
    if (!def) report('prop-ref', `${path}/propRefs/${field}`, `Property "${key}" is not defined.`);
    else if (def.type !== expected) {
      report('prop-ref', `${path}/propRefs/${field}`, `"${field}" must reference a ${expected} property.`);
    }
  }
  if (node.slot && properties.get(node.slot.propKey)?.type !== 'SLOT') {
    report('prop-ref', `${path}/slot/propKey`, `"${node.slot.propKey}" is not a SLOT property.`);
  }
  if (node.instance?.component.kind === 'local') localDeps.add(node.instance.component.sid);
  if (tokenKeys) {
    const { children: _children, instance: _instance, ...own } = node;
    for (const ref of findVarRefs(own, path)) {
      if (!tokenKeys.has(ref.key)) report('var-ref', ref.path, `Variable "${ref.key}" is not in tokens.json.`);
    }
  }
  if (node.instance?.fallback) {
    // A fallback is a separate frame subtree: check it on its own, under the same rules.
    for (const visit of walk(node.instance.fallback, `${path}/instance/fallback`)) {
      checkNode(visit.node, visit.path, context);
    }
  }
}

function checkTextRanges(text: NonNullable<SceneNode['text']>, path: string, report: Report): void {
  let expectedStart = 0;
  text.ranges.forEach((range, i) => {
    if (range.start !== expectedStart || range.end <= range.start) {
      report('text-ranges', `${path}/ranges/${i}`, `Range [${range.start}, ${range.end}) leaves a gap or overlaps.`);
    }
    expectedStart = range.end;
  });
  if (expectedStart !== text.characters.length) {
    report('text-ranges', `${path}/ranges`, `Ranges must cover all ${text.characters.length} characters.`);
  }
}

/** Every `VarRef` (`{ key, confidence }`) inside a value, with its JSON pointer. */
function findVarRefs(value: unknown, path: string): Array<{ key: string; path: string }> {
  if (Array.isArray(value)) return value.flatMap((item, i) => findVarRefs(item, `${path}/${i}`));
  if (value === null || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (typeof record.key === 'string' && (record.confidence === 'chain' || record.confidence === 'value')) {
    return [{ key: record.key, path: `${path}/key` }];
  }
  return Object.entries(record).flatMap(([key, item]) => findVarRefs(item, `${path}/${key}`));
}

/** `PLAN_INVARIANT_VIOLATION` diagnostics for a component's violations. */
export function invariantDiagnostics(sid: string, violations: readonly InvariantViolation[]): Diagnostic[] {
  return violations.map((violation) =>
    createDiagnostic(
      PLAN_INVARIANT_VIOLATION,
      { invariant: `${violation.invariant} at ${violation.path}` },
      { sid, data: { invariant: violation.invariant, path: violation.path, detail: violation.message } },
    ),
  );
}

export type ManifestInvariant =
  | 'integrity-files'
  | 'integrity-manifest'
  | 'totals'
  | 'tokens-file'
  | 'branch-git'
  | 'branch-config-hash'
  | 'sid-unique';

/**
 * Cross-field rules of a `BundleManifest` (06 §4.2): every listed file has an integrity
 * hash, totals add up, and a branch block agrees with `source.git` and its own config hash.
 */
export function checkManifestInvariants(manifest: BundleManifest): InvariantViolation<ManifestInvariant>[] {
  const violations: InvariantViolation<ManifestInvariant>[] = [];
  const report = (invariant: ManifestInvariant, path: string, message: string) =>
    violations.push({ invariant, path, message });
  const files = manifest.integrity.files;
  const sids = new Set<string>();
  manifest.components.forEach((component, i) => {
    if (sids.has(component.sid)) report('sid-unique', `/components/${i}/sid`, `"${component.sid}" appears twice.`);
    sids.add(component.sid);
    if (!Object.hasOwn(files, component.file)) {
      report('integrity-files', `/components/${i}/file`, `"${component.file}" has no integrity hash.`);
    }
  });
  if (manifest.tokens && !Object.hasOwn(files, manifest.tokens.file)) {
    report('integrity-files', '/tokens/file', '"tokens.json" has no integrity hash.');
  }
  if (manifest.features.includes('tokens') !== (manifest.tokens !== undefined)) {
    report('tokens-file', '/tokens', 'The "tokens" feature and the tokens entry must appear together.');
  }
  if (Object.hasOwn(files, 'manifest.json')) {
    report('integrity-manifest', '/integrity/files/manifest.json', 'The manifest cannot hash itself.');
  }
  const sum = (pick: (c: BundleManifest['components'][number]) => number) =>
    manifest.components.reduce((total, component) => total + pick(component), 0);
  const { totals } = manifest;
  const expected = {
    components: manifest.components.length,
    variants: sum((c) => c.variants),
    nodes: sum((c) => c.nodes),
    assetBytes: manifest.assets.reduce((total, asset) => total + asset.bytes, 0),
  };
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (totals[key] !== expected[key]) {
      report('totals', `/totals/${key}`, `totals.${key} is ${totals[key]}, expected ${expected[key]}.`);
    }
  }
  if (manifest.branch) {
    const git = manifest.source.git;
    if (!git) report('branch-git', '/source/git', 'A branch bundle needs source.git (15 §2.2).');
    else if (git.sha !== manifest.branch.baseCommit || git.dirty !== manifest.branch.dirty) {
      report('branch-git', '/branch/baseCommit', 'branch.baseCommit and dirty must match source.git.');
    }
    if (dcrConfigHash(manifest.branch.dcrConfig) !== manifest.branch.configHash) {
      report('branch-config-hash', '/branch/configHash', 'configHash does not match dcrConfig.');
    }
  }
  return violations;
}
