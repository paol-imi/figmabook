import { h16 } from '@holotype/ir';
import type { ItemDraft } from '../classify/context';
import { compareStrings } from '../identify/json';
import {
  canonicalDcr,
  compareItems,
  computeItemId,
  type DcrItem,
  type DcrQuestion,
  type FigmaSnapshot,
  type SnapNode,
} from '../schema';

/*
 * Stable ids (15 §4.9): an item's id is `h16(kind ∥ target ∥ sorted field paths)`, so the
 * same change keeps its id across re-extractions; its asset role ids derive from it
 * (`<itemId>:before`); questions are numbered `q1…` in canonical item order. The snapshot hash
 * is taken over the snapshot with its order-free arrays sorted and without `fileVersion`.
 */

export interface SealedItem {
  readonly item: DcrItem;
  readonly draft: ItemDraft;
}

/** Stamps ids and asset role ids, and sorts the items in canonical order. */
export function identifyItems(drafts: readonly ItemDraft[]): SealedItem[] {
  return drafts
    .map((draft) => {
      const id = computeItemId(draft.item as DcrItem);
      const assets = draft.before ? { before: `${id}:before`, after: `${id}:after` } : { after: `${id}:after` };
      return { item: { ...draft.item, id, assets } as DcrItem, draft };
    })
    .sort((a, b) => compareItems(a.item, b.item));
}

/** The open questions, numbered `q1…` in item order, then in the order each item raised them. */
export function numberQuestions(items: readonly SealedItem[]): DcrQuestion[] {
  const out: DcrQuestion[] = [];
  for (const { item, draft } of items) {
    for (const question of draft.questions) {
      out.push({
        id: `q${out.length + 1}`,
        itemId: item.id,
        code: question.code,
        text: question.text,
        ...(question.options === undefined ? {} : { options: [...question.options] }),
      });
    }
  }
  return out;
}

function sortedBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareStrings(key(a), key(b)));
}

function canonicalNode(node: SnapNode): SnapNode {
  const out: SnapNode = { ...node };
  if (node.annotations)
    out.annotations = sortedBy(node.annotations, (a) => JSON.stringify([a.label, a.category ?? '']));
  if (node.instance) {
    out.instance = {
      ...node.instance,
      overrides: sortedBy(
        node.instance.overrides.map((o) => ({ ...o, fields: [...o.fields].sort(compareStrings) })),
        (o) => o.id,
      ),
    };
  }
  return out;
}

/**
 * The snapshot in canonical array order (12 §2.4): pages by id, top-level ids, annotations,
 * overrides and their fields sorted; `fileVersion` left out (D-48). Snapshots that differ only
 * in those orders, or in object key order, are equal here.
 */
export function canonicalSnapshot(snapshot: FigmaSnapshot): FigmaSnapshot {
  const { fileVersion: _version, ...rest } = snapshot;
  return {
    ...rest,
    pages: sortedBy(
      snapshot.pages.map((page) => ({ ...page, topLevel: [...page.topLevel].sort(compareStrings) })),
      (page) => page.id,
    ),
    nodes: Object.fromEntries(Object.entries(snapshot.nodes).map(([id, node]) => [id, canonicalNode(node)])),
  };
}

/** `header.figma.snapshotHash`: `h16` of the canonical snapshot. */
export const snapshotHash = (snapshot: FigmaSnapshot): string => h16(canonicalDcr(canonicalSnapshot(snapshot)));
