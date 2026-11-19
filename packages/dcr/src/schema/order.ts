import { canonicalJSON, type IrDiagnostic } from '@holotype/ir';
import type { DesignChangeRequest } from './dcr';
import { DCR_ITEM_KINDS, type DcrChange, type DcrItem, type DcrItemKind, type DcrNote } from './item';
import type { DcrScope } from './scope';
import type { A11yAnnotation, DcrInteraction, ScreenVariant } from './screen';
import type { TextHint, TokenOrValue, UsageNode } from './usage';

/*
 * Canonical order (15 §4.9 "Stable order"): every array whose order carries no meaning is
 * sorted, so a shuffled input gives the same bytes. Arrays whose order *is* meaning are
 * kept: frame children, screen variants, deltas, axes and properties, headline lines.
 * Strings compare by UTF-16 code unit, never by locale.
 */

const KIND_ORDER: ReadonlyMap<DcrItemKind, number> = new Map(DCR_ITEM_KINDS.map((kind, i) => [kind, i]));

type Key = string | number;

/** Compares two strings or numbers; strings by code unit. */
function compare(a: Key, b: Key): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareKeys(a: readonly Key[], b: readonly Key[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = compare(a[i] as Key, b[i] as Key);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

function sortedBy<T>(items: readonly T[], key: (item: T) => readonly Key[]): T[] {
  return items
    .map((item) => ({ item, key: key(item) }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map(({ item }) => item);
}

/** A deep copy of plain JSON data (isomorphic; `structuredClone` is not in the ES2022 lib). */
export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const sortedStrings = (values: readonly string[]): string[] => [...values].sort(compare);

/** The canonical item order key: `(kindOrder, sid, vk, nk/key, id)`. */
export function itemOrderKey(item: DcrItem): readonly Key[] {
  const { sid = '', vk = '', nk, key } = item.target;
  return [KIND_ORDER.get(item.kind) ?? DCR_ITEM_KINDS.length, sid, vk, nk ?? key ?? '', item.id];
}

/** Compares two items in canonical order (15 §4.9). */
export function compareItems(a: DcrItem, b: DcrItem): number {
  return compareKeys(itemOrderKey(a), itemOrderKey(b));
}

/**
 * Returns a copy of the request in canonical order. Pure and idempotent; the input is not
 * changed. `dcrHash` and the canonical bytes are computed over this order.
 */
export function sortDcr<T extends Omit<DesignChangeRequest, 'id' | 'dcrHash'>>(dcr: T): T {
  const out = cloneJson(dcr);
  out.items = sortedBy(out.items.map(sortItem), itemOrderKey);
  const index = new Map(out.items.map((item, i) => [item.id, i]));
  const at = (itemId: string) => index.get(itemId) ?? out.items.length;
  out.questions = sortedBy(out.questions, (q) => [at(q.itemId), q.id]);
  out.diagnostics = sortDiagnostics(out.diagnostics);
  out.header.scope = sortScope(out.header.scope);
  const { summary } = out;
  summary.components = sortedStrings(summary.components);
  summary.newComponents = sortedBy(summary.newComponents, (entry) => [at(entry.itemId), entry.itemId]);
  summary.screens = sortedBy(summary.screens, (entry) => [at(entry.itemId), entry.itemId]);
  return out;
}

function sortScope(scope: DcrScope): DcrScope {
  return scope.kind === 'selection' ? { ...scope, ids: [...new Set(scope.ids)].sort(compare) } : scope;
}

function sortDiagnostics(diagnostics: readonly IrDiagnostic[]): IrDiagnostic[] {
  return sortedBy(diagnostics, (d) => [d.code, canonicalJSON(d, { numKind: 'ratio' })]);
}

/** Sorts the order-free arrays inside one item (mutates the clone `sortDcr` made). */
function sortItem(item: DcrItem): DcrItem {
  if (item.diagnostics) item.diagnostics = sortDiagnostics(item.diagnostics);
  if (item.notes) item.notes = sortedBy(item.notes, (note: DcrNote) => [note.source, note.text]);
  const { acceptance } = item;
  if (acceptance.fields) acceptance.fields = sortedBy(acceptance.fields, (f) => [f.field]);
  if (acceptance.token) acceptance.token = sortedBy(acceptance.token, (t) => [t.field, t.expect]);
  if (acceptance.usage) {
    acceptance.usage.mustImport = sortedStrings(acceptance.usage.mustImport);
    if (acceptance.usage.mustNotImport) acceptance.usage.mustNotImport = sortedStrings(acceptance.usage.mustNotImport);
  }
  if ('changes' in item && item.changes) item.changes = sortChanges(item.changes);
  switch (item.kind) {
    case 'component.new':
      item.structure.forEach(sortUsage);
      if (item.nearest) item.nearest = sortedBy(item.nearest, (n) => [-n.score, n.sid]);
      if (item.variantStructure) {
        for (const deltas of Object.values(item.variantStructure)) {
          for (const delta of deltas) if (delta.op === 'added') sortUsage(delta.node);
        }
      }
      break;
    case 'node.added':
      item.structure?.forEach(sortUsage);
      break;
    case 'screen':
      item.screen.variants.forEach(sortVariant);
      break;
    case 'instance.outdated':
    case 'instance.deprecated': {
      const ref = item.instanceRef;
      ref.occurrences = sortedBy(ref.occurrences, (o) => [o.screenItemId, o.key]);
      if (ref.visualChanges) ref.visualChanges = sortedBy(ref.visualChanges, (c) => [c.field, c.group]);
      break;
    }
    default:
      break;
  }
  return item;
}

function sortChanges(changes: readonly DcrChange[]): DcrChange[] {
  for (const change of changes) {
    if (change.token?.candidates) change.token.candidates = sortedStrings(change.token.candidates);
    if (change.reach) {
      change.reach.sameOriginVariants = sortedStrings(change.reach.sameOriginVariants);
      change.reach.designerChangedIn = sortedStrings(change.reach.designerChangedIn);
    }
  }
  return sortedBy(changes, (c) => [c.field, c.group]);
}

function sortVariant(variant: ScreenVariant): void {
  variant.structure.forEach(sortUsage);
  for (const delta of variant.delta ?? []) if (delta.op === 'added') sortUsage(delta.node);
  variant.interactions = sortedBy(variant.interactions, (i: DcrInteraction) => [i.from, i.trigger, i.action.kind]);
  variant.a11y = sortedBy(variant.a11y, (a: A11yAnnotation) => [
    a.focusOrder === undefined ? 1 : 0,
    a.focusOrder ?? 0,
    a.key,
  ]);
}

function sortTokenOrValue(value: TokenOrValue | undefined): void {
  if (value && 'candidates' in value && value.candidates) value.candidates = sortedStrings(value.candidates);
}

function sortTextHint(style: TextHint): void {
  if (style.candidates) style.candidates = sortedStrings(style.candidates);
}

/** Sorts candidate lists and `defaults` inside a usage tree; child order is kept. */
function sortUsage(node: UsageNode): void {
  switch (node.t) {
    case 'frame':
      sortTokenOrValue(node.layout?.gap);
      node.layout?.padding?.forEach(sortTokenOrValue);
      node.fills?.forEach(sortTokenOrValue);
      sortTokenOrValue(node.radius);
      node.children.forEach(sortUsage);
      break;
    case 'text':
      sortTextHint(node.style);
      break;
    case 'instance': {
      const { inst } = node;
      if (inst.defaults) inst.defaults = sortedStrings(inst.defaults);
      if (inst.deviations) inst.deviations = sortedBy(inst.deviations, (c) => [c.field, c.group]);
      for (const children of Object.values(inst.slots ?? {})) children.forEach(sortUsage);
      break;
    }
    default:
      break;
  }
}
