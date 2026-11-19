import { readFileSync } from 'node:fs';
import type { JsonValue } from '@holotype/ir';
import {
  type BaselineSnapshot,
  cloneJson,
  type DcrItem,
  type DcrItemKind,
  type DesignChangeRequest,
  type FigmaSnapshot,
  type SnapNode,
  validateBaselineSnapshot,
  validateFigmaSnapshot,
} from '../src';

/*
 * Inputs for the extractor's unit tests: the B-68 golden cases (`fixtures/dcr/<case>/`), read
 * as files, and small edits on them, the way a designer would change the file.
 */

const root = new URL('../../../fixtures/dcr/', import.meta.url);

export interface CaseInput {
  readonly branch: FigmaSnapshot;
  readonly baseline: BaselineSnapshot[];
}

/** A golden case's branch snapshot and baselines, validated, as a fresh copy. */
export function loadInput(name: string): CaseInput {
  const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`${name}/${file}`, root), 'utf8'));
  const branch = validateFigmaSnapshot(read('branch.json'));
  if (!branch.ok) throw new Error(`${name}/branch.json is invalid`);
  const baseline = (read('baseline.json') as unknown[]).map((item) => {
    const result = validateBaselineSnapshot(item);
    if (!result.ok) throw new Error(`${name}/baseline.json is invalid`);
    return result.value;
  });
  return { branch: cloneJson(branch.value), baseline: cloneJson(baseline) };
}

/** A node of the snapshot; throws when it is missing. */
export function node(snapshot: FigmaSnapshot, id: string): SnapNode {
  const found = snapshot.nodes[id];
  if (!found) throw new Error(`no node ${id}`);
  return found;
}

/** Sets a value inside a node's group, e.g. `set(n, 'layout', 'paddingTop', 4)`. */
export function setGroupValue(target: SnapNode, group: keyof SnapNode['groups'], key: string, value: JsonValue): void {
  const current = (target.groups[group] ?? {}) as Record<string, JsonValue>;
  target.groups[group] = { ...current, [key]: value };
}

/** The items of one kind. */
export function itemsOf<K extends DcrItemKind>(request: DesignChangeRequest, kind: K): Extract<DcrItem, { kind: K }>[] {
  return request.items.filter((item): item is Extract<DcrItem, { kind: K }> => item.kind === kind);
}

/** The single item of a request; throws when there is not exactly one. */
export function onlyItem(request: DesignChangeRequest): DcrItem {
  if (request.items.length !== 1) {
    throw new Error(`expected one item, got ${request.items.map((item) => `${item.kind} ${item.title}`).join('; ')}`);
  }
  return request.items[0] as DcrItem;
}
