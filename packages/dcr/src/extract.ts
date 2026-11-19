import type { Diagnostic } from '@holotype/shared';
import { classifyComponent } from './classify/component';
import { dcrDiagnostic, type ExtractContext, type ItemDraft } from './classify/context';
import { unextractedFrame } from './classify/frames';
import { componentKey, newComponent } from './classify/new-component';
import { scopedNodes } from './classify/scope';
import { classifyVariables } from './classify/variables';
import { TokenIndex } from './diff/tokens';
import { BaselineIndex } from './identify/components';
import { compareStrings } from './identify/json';
import { type BranchMeta, type RegistryInfo, readBranchMeta, readRegistry } from './identify/meta';
import { type SetSource, SnapshotIndex } from './identify/snapshot-index';
import { identifyItems, numberQuestions, type SealedItem, snapshotHash } from './ids/index';
import {
  type BaselineSnapshot,
  computeItemId,
  DCR_VERSION,
  type DcrHeader,
  type DcrItemKind,
  type DcrQuestion,
  type DcrSummary,
  type DesignChangeRequest,
  type FigmaSnapshot,
  sealDcr,
} from './schema';

/*
 * `extractDcr(snapshot, baselines)` (15 §4): identify, diff, classify, then seal. Pure and
 * deterministic (D-35): no clock, no randomness, no network; every input object is walked in
 * code-unit key order and every unordered array is sorted, so a shuffled snapshot gives the
 * same bytes. The result is the plugin's core; the CLI attaches provenance afterwards and the
 * core hash stays the same (D-50).
 */

/** `header.extractor.version`: bumped whenever the same input extracts differently. */
export const DCR_EXTRACTOR_VERSION = '1.0.0';

/** Kinds whose sid is listed in `summary.components` (15 §6). */
const COMPONENT_KINDS: ReadonlySet<DcrItemKind> = new Set([
  'component.modified',
  'variant.added',
  'variant.removed',
  'property.added',
  'property.changed',
  'node.added',
  'node.removed',
]);

const RAW_VALUE_CODES: ReadonlySet<string> = new Set(['DCR_VALUE_UNTOKENIZED', 'DCR_VALUE_NO_TOKEN']);

/** At most 8 headline lines (15 §6); the last one counts the rest. */
const HEADLINE_LINES = 8;

function header(
  snapshot: FigmaSnapshot,
  meta: BranchMeta,
  registry: RegistryInfo,
  config: ExtractContext['config'],
): DcrHeader {
  const pkg = config.targets.components.package;
  const screens = config.targets.screens;
  return {
    repo: meta.repo,
    branch: meta.branch,
    baseCommit: meta.baseCommit,
    dirty: meta.dirty,
    targets: {
      components: { repo: meta.repo, ...(pkg === undefined ? {} : { package: pkg }) },
      ...(screens === undefined
        ? {}
        : { screens: { repo: screens.repo, ...(screens.path ? { path: screens.path } : {}) } }),
    },
    figma: {
      fileKey: snapshot.fileKey,
      ...(snapshot.fileVersion === undefined ? {} : { fileVersion: snapshot.fileVersion }),
      kind: meta.kind,
      snapshotHash: snapshotHash(snapshot),
    },
    baseline: {
      fp: meta.baselineFp,
      ...(meta.baselineRunId === undefined ? {} : { runId: meta.baselineRunId }),
      storybookVersion: registry.storybookVersion,
      framework: registry.framework,
    },
    scope: snapshot.scope,
    extractor: { version: DCR_EXTRACTOR_VERSION, configHash: meta.configHash },
    ...(meta.parent === undefined ? {} : { parent: meta.parent }),
  };
}

function summary(items: readonly SealedItem[], questions: readonly DcrQuestion[], ctx: ExtractContext): DcrSummary {
  const counts: DcrSummary['counts'] = {};
  const components = new Set<string>();
  const newComponents: DcrSummary['newComponents'] = [];
  for (const { item } of items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    if (COMPONENT_KINDS.has(item.kind) && item.target.sid !== undefined) components.add(item.target.sid);
    if (item.kind === 'component.new') {
      newComponents.push({ itemId: item.id, name: ctx.index.node(item.target.figmaNodeId)?.name ?? item.title });
    }
  }
  const lines = items.map(({ draft }) => draft.headline);
  const headline =
    lines.length <= HEADLINE_LINES
      ? lines
      : [...lines.slice(0, HEADLINE_LINES - 1), `and ${lines.length - HEADLINE_LINES + 1} more changes`];
  return {
    counts,
    components: [...components].sort(compareStrings),
    newComponents,
    screens: [],
    tokens: {
      changed: counts['token.changed'] ?? 0,
      added: counts['token.added'] ?? 0,
      untokenized: questions.filter((question) => RAW_VALUE_CODES.has(question.code)).length,
    },
    content: { placeholders: 0 },
    questions: questions.length,
    headline,
  };
}

/** The managed component new ones mirror for their file layout: the first by sid with a module path. */
function referenceSource(index: SnapshotIndex): SetSource | undefined {
  const sets = index
    .topLevel()
    .map(({ node }) => node)
    .filter((node) => node.type === 'COMPONENT_SET' && node.data.sid !== undefined)
    .sort((a, b) => compareStrings(a.data.sid as string, b.data.sid as string));
  return sets.map((set) => index.source(set)).find((source) => source.componentPath !== undefined);
}

/**
 * Extracts the Design Change Request of a branch file (15 §4): the snapshot of the file after
 * the designer's edits, diffed against the baselines embedded at apply time (D-34). Throws a
 * `HolotypeError` with `DCR_NOT_BRANCH_FILE` when the file has no `branch:meta`.
 */
export function extractDcr(snapshot: FigmaSnapshot, baselines: readonly BaselineSnapshot[]): DesignChangeRequest {
  const meta = readBranchMeta(snapshot);
  const registry = readRegistry(snapshot);
  const index = new SnapshotIndex(snapshot);
  const scoped = scopedNodes(index, snapshot.scope, meta.baseFrames);
  const pending = scoped.newComponents.map((top) => ({ top, key: componentKey(index, top.node, top.page.name) }));
  const ctx: ExtractContext = {
    index,
    baselines: new BaselineIndex(baselines),
    tokens: new TokenIndex(snapshot.variables),
    config: meta.dcrConfig,
    newComponents: new Map(
      pending.map(({ top, key }) => [
        top.node.id,
        computeItemId({ kind: 'component.new', target: { key, figmaNodeId: top.node.id } }),
      ]),
    ),
  };
  const diagnostics: Diagnostic[] = [];
  const drafts: ItemDraft[] = [];
  for (const { node } of scoped.sets) drafts.push(...classifyComponent(ctx, node, diagnostics));
  const reference = referenceSource(index);
  for (const { top, key } of pending) drafts.push(newComponent(ctx, top.node, key, reference));
  for (const top of scoped.frames) drafts.push(unextractedFrame(top));
  if (scoped.variables) drafts.push(...classifyVariables(ctx.tokens));

  const items = identifyItems(drafts);
  const questions = numberQuestions(items);
  // Plugin-side extraction has no code locations; the CLI clears this when it attaches them.
  if (items.length > 0) diagnostics.push(dcrDiagnostic('DCR_PROVENANCE_MISSING'));
  return sealDcr({
    kind: 'holotype/dcr',
    dcrVersion: DCR_VERSION,
    header: header(snapshot, meta, registry, ctx.config),
    items: items.map(({ item }) => item),
    questions,
    summary: summary(items, questions, ctx),
    diagnostics,
  });
}
