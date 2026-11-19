import { createValidator, type ValidationIssue, type Validator } from '@holotype/ir';
import { canonicalDcr, computeDcrHash, computeItemId, dcrId } from './core';
import { DCR_REFERENCES, type DesignChangeRequest, DesignChangeRequestSchema } from './dcr';
import type { DcrItem, DcrItemKind } from './item';
import { sortDcr } from './order';
import { type DcrAnswers, DcrAnswersSchema, type DcrDecisions, DcrDecisionsSchema } from './sidecar';
import { type BaselineSnapshot, BaselineSnapshotSchema, type FigmaSnapshot, FigmaSnapshotSchema } from './snapshot';
import type { UsageNode } from './usage';

/** Validates `dcr.json` against the schema (shape only; see `checkDcrIntegrity`). */
export const validateDcr: Validator<DesignChangeRequest> = createValidator(DesignChangeRequestSchema, {
  references: DCR_REFERENCES,
});
export const validateFigmaSnapshot: Validator<FigmaSnapshot> = createValidator(FigmaSnapshotSchema);
export const validateBaselineSnapshot: Validator<BaselineSnapshot> = createValidator(BaselineSnapshotSchema);
export const validateDcrAnswers: Validator<DcrAnswers> = createValidator(DcrAnswersSchema);
export const validateDcrDecisions: Validator<DcrDecisions> = createValidator(DcrDecisionsSchema);

const issue = (path: string, message: string): ValidationIssue => ({ path, kind: 'invalid', message });

/**
 * Checks what the schema cannot: ids and the hash match the content, references resolve,
 * the summary matches the items, and everything is in canonical order (15 §4.9). Returns no
 * issues for a request made by `sealDcr`. Run it after `validateDcr` succeeds.
 */
export function checkDcrIntegrity(dcr: DesignChangeRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const kinds = new Map<string, DcrItemKind>();
  dcr.items.forEach((item, i) => {
    if (kinds.has(item.id)) issues.push(issue(`/items/${i}/id`, `Duplicate item id ${item.id}.`));
    kinds.set(item.id, item.kind);
    const expected = computeItemId(item);
    if (item.id !== expected) issues.push(issue(`/items/${i}/id`, `Item id ${item.id} should be ${expected}.`));
  });
  issues.push(...checkReferences(dcr, kinds));
  issues.push(...checkSummary(dcr));
  const dcrHash = computeDcrHash(dcr);
  if (dcr.dcrHash !== dcrHash) issues.push(issue('/dcrHash', `dcrHash ${dcr.dcrHash} should be ${dcrHash}.`));
  const { repo, branch, figma } = dcr.header;
  const id = dcrId({ repo, branch, fileKey: figma.fileKey, dcrHash: dcr.dcrHash });
  if (dcr.id !== id) issues.push(issue('/id', `Request id ${dcr.id} should be ${id}.`));
  if (dcr.header.parent === dcr.id) issues.push(issue('/header/parent', 'A request cannot be its own parent.'));
  if (canonicalDcr(sortDcr(dcr)) !== canonicalDcr(dcr)) {
    issues.push(issue('', 'Arrays are not in canonical order (15 §4.9); write the request with serializeDcr.'));
  }
  return issues;
}

function checkReferences(dcr: DesignChangeRequest, kinds: ReadonlyMap<string, DcrItemKind>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const expectKind = (path: string, itemId: string, kind: DcrItemKind) => {
    const found = kinds.get(itemId);
    if (found === undefined) issues.push(issue(path, `No item has id ${itemId}.`));
    else if (found !== kind) issues.push(issue(path, `Item ${itemId} is ${found}, expected ${kind}.`));
  };
  const questionIds = new Set<string>();
  dcr.questions.forEach((question, i) => {
    if (questionIds.has(question.id)) issues.push(issue(`/questions/${i}/id`, `Duplicate question id ${question.id}.`));
    questionIds.add(question.id);
    if (!kinds.has(question.itemId)) issues.push(issue(`/questions/${i}/itemId`, `No item has id ${question.itemId}.`));
  });
  for (const [i, entry] of dcr.summary.newComponents.entries()) {
    expectKind(`/summary/newComponents/${i}/itemId`, entry.itemId, 'component.new');
  }
  for (const [i, entry] of dcr.summary.screens.entries()) {
    expectKind(`/summary/screens/${i}/itemId`, entry.itemId, 'screen');
  }
  for (const [i, item] of dcr.items.entries()) {
    if (item.kind === 'instance.outdated' || item.kind === 'instance.deprecated') {
      for (const [o, occurrence] of item.instanceRef.occurrences.entries()) {
        expectKind(`/items/${i}/instanceRef/occurrences/${o}/screenItemId`, occurrence.screenItemId, 'screen');
      }
    }
    for (const [path, node] of usageNodes(item)) {
      if (node.t === 'new-component-ref') expectKind(`/items/${i}${path}/itemId`, node.itemId, 'component.new');
    }
  }
  return issues;
}

function checkSummary(dcr: DesignChangeRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const counts = new Map<DcrItemKind, number>();
  for (const item of dcr.items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const stated = dcr.summary.counts as Partial<Record<DcrItemKind, number>>;
  for (const kind of new Set([...counts.keys(), ...(Object.keys(stated) as DcrItemKind[])])) {
    if ((stated[kind] ?? 0) !== (counts.get(kind) ?? 0)) {
      issues.push(
        issue(`/summary/counts/${kind}`, `${counts.get(kind) ?? 0} ${kind} items, summary says ${stated[kind] ?? 0}.`),
      );
    }
  }
  if (dcr.summary.questions !== dcr.questions.length) {
    issues.push(
      issue('/summary/questions', `${dcr.questions.length} questions, summary says ${dcr.summary.questions}.`),
    );
  }
  return issues;
}

/** Every usage node of an item with its JSON pointer below the item. */
function* usageNodes(item: DcrItem): Generator<[string, UsageNode]> {
  if (item.kind === 'component.new' || item.kind === 'node.added') {
    yield* walk(item.structure ?? [], '/structure');
  }
  if (item.kind === 'screen') {
    for (const [v, variant] of item.screen.variants.entries()) {
      yield* walk(variant.structure, `/screen/variants/${v}/structure`);
      for (const [d, delta] of (variant.delta ?? []).entries()) {
        if (delta.op === 'added') yield* walk([delta.node], `/screen/variants/${v}/delta/${d}/node`, true);
      }
    }
  }
}

function* walk(nodes: readonly UsageNode[], at: string, single = false): Generator<[string, UsageNode]> {
  for (const [i, node] of nodes.entries()) {
    const path = single ? at : `${at}/${i}`;
    yield [path, node];
    if (node.t === 'frame') yield* walk(node.children, `${path}/children`);
    if (node.t === 'instance') {
      for (const [arg, children] of Object.entries(node.inst.slots ?? {})) {
        yield* walk(children, `${path}/inst/slots/${arg.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      }
    }
  }
}
