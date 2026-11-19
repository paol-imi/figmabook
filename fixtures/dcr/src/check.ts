import type { BaselineSnapshot, DesignChangeRequest, FigmaSnapshot, SnapNode } from '@holotype/dcr';
import { canonicalJSON } from '@holotype/ir';
import type { CaseInput } from './case.ts';
import {
  appliedHashOf,
  configHash,
  isCanonicalJsonString,
  isJsonRootKey,
  isNormalized,
  JSON_DATA_KEYS,
  readBranchMeta,
  readRegistry,
  snapshotHash,
} from './derived.ts';

/*
 * Realism checks beyond the schemas: a case must look like what the plugin would really
 * read. Each returns human-readable issues; an empty list means the case is consistent.
 */

const same = (a: unknown, b: unknown): boolean => canonicalJSON(a) === canonicalJSON(b);

/** The managed variant (a node with `vk`) a node belongs to, walking up `parent`. */
export function variantOf(snapshot: FigmaSnapshot, node: SnapNode): SnapNode | undefined {
  let current: SnapNode | undefined = node;
  while (current) {
    if (current.data.vk !== undefined) return current;
    current = current.parent === undefined ? undefined : snapshot.nodes[current.parent];
  }
  return undefined;
}

/** The baseline groups a managed node was applied with, if the case has its baseline. */
export function baselineGroupsOf(
  snapshot: FigmaSnapshot,
  baselines: readonly BaselineSnapshot[],
  node: SnapNode,
): BaselineSnapshot['nodes'][string] | undefined {
  const nk = node.data.nk;
  if (nk === undefined) return undefined;
  if (nk === 'set') {
    return baselines.find((b) => b.props !== undefined && b.sid === node.data.sid)?.nodes.set;
  }
  const variant = variantOf(snapshot, node);
  const vk = variant?.data.vk;
  return baselines.find((b) => b.props === undefined && b.vk === vk && b.sid === variant?.data.sid)?.nodes[nk];
}

function checkTree(snapshot: FigmaSnapshot): string[] {
  const issues: string[] = [];
  const pageIds = new Set(snapshot.pages.map((page) => page.id));
  for (const [id, node] of Object.entries(snapshot.nodes)) {
    if (node.id !== id) issues.push(`nodes["${id}"].id is ${node.id}.`);
    if (id.startsWith('I')) issues.push(`${id} is an instance sublayer; snapshots skip them (15 §4.1).`);
    if (node.parent !== undefined && !pageIds.has(node.parent)) {
      const parent = snapshot.nodes[node.parent];
      if (!parent) issues.push(`${id}: parent ${node.parent} is not in the snapshot.`);
      else if (!parent.children?.includes(id)) issues.push(`${id}: parent ${node.parent} does not list it as a child.`);
    }
    for (const child of node.children ?? []) {
      if (snapshot.nodes[child]?.parent !== id) issues.push(`${id}: child ${child} is missing or has another parent.`);
    }
    for (const [key, value] of Object.entries(node.data)) {
      if (JSON_DATA_KEYS.has(key) && !isCanonicalJsonString(value))
        issues.push(`${id}: data.${key} is not canonical JSON.`);
    }
    if (!isNormalized(node.groups)) issues.push(`${id}: groups are not normalized (floats 1e-3, colors 1e-4).`);
  }
  for (const page of snapshot.pages) {
    for (const id of page.topLevel) {
      if (snapshot.nodes[id]?.parent !== page.id)
        issues.push(`page ${page.id}: top-level ${id} is missing or on another page.`);
    }
  }
  for (const [key, value] of Object.entries(snapshot.rootData)) {
    if (isJsonRootKey(key) && !isCanonicalJsonString(value)) issues.push(`rootData["${key}"] is not canonical JSON.`);
  }
  return issues;
}

function checkBaselines(input: CaseInput): string[] {
  const { branch, baseline } = input;
  const issues: string[] = [];
  for (const b of baseline) {
    for (const [nk, groups] of Object.entries(b.nodes)) {
      if (!isNormalized(groups)) issues.push(`baseline ${b.vk} node ${nk}: groups are not normalized.`);
    }
    for (const [parent, children] of Object.entries(b.order)) {
      if (!(parent in b.nodes)) issues.push(`baseline ${b.vk}: order key ${parent} is not a node.`);
      for (const child of children) if (!(child in b.nodes)) issues.push(`baseline ${b.vk}: ${child} is not a node.`);
    }
  }
  for (const node of Object.values(branch.nodes)) {
    const { vk, sid, nk, ah } = node.data;
    if (vk !== undefined && !baseline.some((b) => b.vk === vk && b.sid === sid && b.props === undefined)) {
      issues.push(`${node.id}: variant ${vk} of ${sid} has no baseline.`);
    }
    if (nk === undefined || ah === undefined) continue;
    const groups = baselineGroupsOf(branch, baseline, node);
    if (groups === undefined) {
      if (variantOf(branch, node) !== undefined || nk === 'set')
        issues.push(`${node.id}: ${nk} is managed but not in its baseline.`);
      continue;
    }
    if (ah !== appliedHashOf(groups))
      issues.push(`${node.id}: data.ah is not the applied hash of its baseline groups.`);
  }
  return issues;
}

function checkVariables(snapshot: FigmaSnapshot): string[] {
  const issues: string[] = [];
  for (const [id, variable] of Object.entries(snapshot.variables)) {
    if (variable.id !== id) issues.push(`variables["${id}"].id is ${variable.id}.`);
    const tok = variable.data.tok;
    if (tok !== undefined && variable.codeSyntax?.WEB !== `var(${tok})`) {
      issues.push(`${id}: codeSyntax.WEB should be var(${tok}).`);
    }
    for (const value of Object.values(variable.valuesByMode)) {
      if (value !== null && typeof value === 'object' && 'alias' in value) {
        const target = (value as { alias: unknown }).alias;
        if (typeof target !== 'string' || !(target in snapshot.variables))
          issues.push(`${id}: alias ${String(target)} is not a variable.`);
      }
    }
  }
  return issues;
}

/** Checks a case's inputs against each other: config, branch:meta, registry, tree, baselines, `ah`. */
export function checkCaseInput(input: CaseInput): string[] {
  const issues: string[] = [];
  try {
    const meta = readBranchMeta(input.branch);
    if (!same(meta.dcrConfig, input.config)) issues.push('branch:meta.dcrConfig differs from config.json.');
    if (meta.configHash !== configHash(input.config))
      issues.push(`branch:meta.configHash should be ${configHash(input.config)}.`);
    if (meta.fileKey !== null && meta.fileKey !== input.branch.fileKey)
      issues.push('branch:meta.fileKey differs from the snapshot fileKey.');
    readRegistry(input.branch);
  } catch (error) {
    issues.push((error as Error).message);
  }
  issues.push(...checkTree(input.branch), ...checkBaselines(input), ...checkVariables(input.branch));
  return issues;
}

const CLI_CHANGE_FIELDS = ['origin', 'css', 'reach', 'varDefinition'] as const;

/** Checks that the expected request agrees with the case's inputs (header, targets, CLI-only fields). */
export function checkExpected(input: CaseInput, expected: DesignChangeRequest): string[] {
  const issues: string[] = [];
  const { header } = expected;
  const meta = readBranchMeta(input.branch);
  const registry = readRegistry(input.branch);
  const expect = (what: string, actual: unknown, wanted: unknown) => {
    if (!same(actual, wanted))
      issues.push(`${what} is ${JSON.stringify(actual)}, the inputs say ${JSON.stringify(wanted)}.`);
  };
  expect('header.repo', header.repo, meta.repo);
  expect('header.branch', header.branch, meta.branch);
  expect('header.baseCommit', header.baseCommit, meta.baseCommit);
  expect('header.figma.fileKey', header.figma.fileKey, input.branch.fileKey);
  expect('header.figma.kind', header.figma.kind, meta.kind);
  expect('header.figma.snapshotHash', header.figma.snapshotHash, snapshotHash(input.branch));
  expect('header.baseline.fp', header.baseline.fp, meta.baselineFp);
  expect('header.baseline.storybookVersion', header.baseline.storybookVersion, registry.storybook.version);
  expect('header.baseline.framework', header.baseline.framework, registry.storybook.framework);
  expect('header.scope', header.scope, input.branch.scope);
  expect('header.extractor.configHash', header.extractor.configHash, meta.configHash);
  expect('header.targets.components.repo', header.targets.components.repo, meta.repo);
  expect(
    'header.targets.components.package',
    header.targets.components.package,
    input.config.targets.components.package,
  );
  if (header.generated !== undefined) issues.push('header.generated is omitted in goldens (12 §2.4).');
  for (const item of expected.items) {
    const id = item.target.figmaNodeId;
    const known = id in input.branch.nodes || id in input.branch.variables;
    if (!known) issues.push(`${item.id}: target.figmaNodeId ${id} is not in the snapshot.`);
    if (input.provenance !== undefined) continue;
    // Without provenance the request is the plugin's core: no CLI-added fields.
    if (item.target.code !== undefined) issues.push(`${item.id}: target.code needs provenance.json.`);
    if (item.kind === 'component.new' && item.nearest?.some((n) => n.code !== undefined)) {
      issues.push(`${item.id}: nearest[].code needs provenance.json.`);
    }
    if ('changes' in item) {
      for (const change of item.changes ?? []) {
        for (const field of CLI_CHANGE_FIELDS) {
          if (change[field] !== undefined) issues.push(`${item.id}: ${change.field}.${field} needs provenance.json.`);
        }
      }
    }
  }
  return issues;
}
