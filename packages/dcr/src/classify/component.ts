import type { JsonValue } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { bindFieldOf, fieldInfo } from '../diff/field-info';
import { changedGroupsOf, diffNode } from '../diff/index';
import {
  type ComponentModel,
  type DerivedVariant,
  identifyComponent,
  type ManagedVariant,
} from '../identify/components';
import { field, sameJson } from '../identify/json';
import { walkVariant } from '../identify/nodes';
import type { Acceptance, DcrChange, PartialNodeGroups, SnapNode, VariantValues } from '../schema';
import { type ComponentNames, componentNames, dcrDiagnostic, type ExtractContext, type ItemDraft } from './context';
import { codePhrase, designerPhrase, phrasesOf } from './phrases';
import { classifyProperties, isAbsorbedReference, type PropertyChanges } from './properties';
import { rawValues } from './raw-values';
import { ARROW, argName, argsText, capFirst, DOT, figmaValue, kebab, lowerFirst, plural, valuesText } from './text';
import { UsageBuilder } from './usage';

/*
 * Classification of a managed component (15 §4.4): `component.modified` (one item per node,
 * field changes grouped), `variant.added` / `variant.removed`, `property.added` /
 * `property.changed`, `node.added` / `node.removed` inside managed variants, and `unknown` for
 * the rest (`DCR_UNKNOWN_CHANGE`, listed raw).
 */

/** Fields a designer edit can change that have no code meaning the extractor knows yet. */
const UNCLASSIFIED_FIELDS = /^vis\.name$/;

/** One variant's words: `variant=secondary, size=md` for code, `Variant=Secondary, Size=Md` for designers. */
interface VariantWords {
  readonly args: string;
  readonly values: string;
}

/** Acceptance tolerances (15 §9.2): ±0.5px for lengths, 1e-3 for color channels, 0.01 for ratios. */
function tolerance(change: DcrChange, nodeType: string): number | undefined {
  const { kind } = fieldInfo(change.field, nodeType);
  if (kind === 'color') return 0.001;
  if (typeof change.after !== 'number') return undefined;
  return kind === 'ratio' ? 0.01 : 0.5;
}

function fieldsAcceptance(changes: readonly DcrChange[], nodeType: string): Acceptance {
  const fields = changes.map((change) => {
    const tol = tolerance(change, nodeType);
    return { field: change.field, expect: change.after, ...(tol === undefined ? {} : { tol }) };
  });
  const token = changes.flatMap((change) => {
    const bind = bindFieldOf(change.field, nodeType);
    return change.token?.after !== undefined && bind !== undefined ? [{ field: bind, expect: change.token.after }] : [];
  });
  return { type: 'fields', fields, ...(token.length > 0 ? { token } : {}), story: 'existing' };
}

/** Acceptance of a structural change to existing code. */
const existingStructure = (): Acceptance => ({ type: 'structure', story: 'existing' });

/** Acceptance of a new variant: a story must implement it; the visual check is advisory (D-55). */
const newVariant = () =>
  ({
    type: 'structure',
    story: 'must-add',
    visual: { sMaskedMin: 0.97, boxDeltaMax: 1 },
  }) as const satisfies Acceptance;

/** Classifies one managed set and everything inside it. */
export function classifyComponent(ctx: ExtractContext, set: SnapNode, diagnostics: Diagnostic[]): ItemDraft[] {
  const model = identifyComponent(ctx.index, ctx.baselines, set);
  const names = componentNames(model);
  const properties = classifyProperties(model, names);
  const drafts: ItemDraft[] = [...properties.drafts, ...setChanges(ctx, model, names)];
  for (const node of model.unbased) {
    diagnostics.push(
      dcrDiagnostic('DCR_BASELINE_MISSING', { sid: model.sid, variantKey: node.data.vk, nodeKey: 'root' }),
    );
  }
  for (const variant of model.managed) drafts.push(...managedVariant(ctx, model, names, variant, properties));
  for (const derived of model.derived) drafts.push(variantAdded(ctx, model, names, derived, properties));
  for (const removed of model.removed)
    drafts.push(variantRemoved(model, names, removed.vk, removed.values, removed.args));
  for (const node of model.unkeyed) drafts.push(unkeyedVariant(model, names, node));
  return drafts;
}

function words(model: ComponentModel, values: VariantValues, args: Readonly<Record<string, JsonValue>>): VariantWords {
  return { args: argsText(values, model.axes, args), values: valuesText(values, model.axes) };
}

/** The set's own changes (its name): `unknown`, since a rename has no code meaning yet. */
function setChanges(ctx: ExtractContext, model: ComponentModel, names: ComponentNames): ItemDraft[] {
  const before = model.setBaseline?.nodes.set;
  if (before === undefined) return [];
  const groups = changedGroupsOf(model.set.data.ah, model.set.groups);
  if (groups.length === 0) return [];
  const changes = diffNode({ nodeType: model.set.type, before, after: model.set.groups, groups }, ctx.tokens);
  if (changes.length === 0) return [];
  const rename = changes.length === 1 && changes[0]?.field === 'vis.name' ? changes[0] : undefined;
  return [
    unknownItem({
      target: { sid: model.sid, nk: 'set', figmaNodeId: model.set.id },
      changes,
      code: names.code,
      designer: rename
        ? `${names.designer} ${DOT} component renamed to ${figmaValue(rename.after)}`
        : `${names.designer} ${DOT} ${changes.map((change) => change.field).join(', ')} changed`,
      subject: names.designer,
      where: { sid: model.sid, nk: 'set' },
    }),
  ];
}

interface UnknownInput {
  readonly target: { sid?: string; vk?: string; nk?: string; key?: string; figmaNodeId: string };
  readonly changes: readonly DcrChange[];
  /** Code-side subject: `Button` or `Button · variant=primary, size=md`. */
  readonly code: string;
  readonly designer: string;
  /** Headline subject: `Button` or `Button (Variant=Primary, Size=Md)`. */
  readonly subject: string;
  readonly where: { sid?: string; vk?: string; nk?: string };
}

/** An `unknown` item: the changes listed raw, one `DCR_UNKNOWN_CHANGE` per field. */
export function unknownItem({ target, changes, code, designer, subject, where }: UnknownInput): ItemDraft {
  const fields = changes.map((change) => change.field);
  return {
    item: {
      kind: 'unknown',
      title: `${code} ${DOT} unclassified change: ${fields.join(', ')}`,
      designerTitle: designer,
      target,
      changes: [...changes],
      acceptance: existingStructure(),
      diagnostics: fields.map((property) =>
        dcrDiagnostic('DCR_UNKNOWN_CHANGE', { nodeKey: where.nk, property, sid: where.sid, variantKey: where.vk }),
      ),
    },
    before: false,
    questions: [],
    headline: `${subject}: ${plural(fields.length, 'change')} Holotype cannot classify (${fields.join(', ')})`,
  };
}

/** Child order of a managed node against its baseline (15 §4.3 "Ordering"). */
function orderChange(
  ctx: ExtractContext,
  node: SnapNode,
  nk: string,
  order: Readonly<Record<string, readonly string[]>>,
  managed: ReadonlyMap<string, SnapNode>,
): DcrChange | undefined {
  const applied = order[nk];
  if (!applied || applied.length < 2) return undefined;
  const current = ctx.index
    .children(node)
    .flatMap((child) => (child.data.nk !== undefined && managed.get(child.data.nk) === child ? [child.data.nk] : []));
  const kept = new Set(current);
  const before = applied.filter((child) => kept.has(child));
  const present = new Set(applied);
  const after = current.filter((child) => present.has(child));
  return sameJson(before, after) ? undefined : { group: 'layout', field: 'layout.children.order', before, after };
}

/** The changes of every managed node of a variant, plus its added and removed layers. */
function managedVariant(
  ctx: ExtractContext,
  model: ComponentModel,
  names: ComponentNames,
  variant: ManagedVariant,
  properties: PropertyChanges,
): ItemDraft[] {
  const { baseline, node: root, vk } = variant;
  const layers = walkVariant(ctx.index, root, baseline);
  const say = words(model, variant.values, ctx.index.args(root));
  const drafts: ItemDraft[] = [];
  for (const [nk, node] of [...layers.managed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const before = baseline.nodes[nk];
    if (before === undefined) continue;
    const groups = changedGroupsOf(node.data.ah, node.groups);
    let changes =
      groups.length === 0 ? [] : diffNode({ nodeType: node.type, before, after: node.groups, groups }, ctx.tokens);
    if (nk === 'root') changes = changes.filter((change) => change.field !== 'vis.name');
    changes = changes.filter((change) => !isAbsorbedReference(change, properties));
    const order = orderChange(ctx, node, nk, baseline.order, layers.managed);
    if (order) changes.push(order);
    if (changes.length === 0) continue;
    const unclassified = changes.filter((change) => UNCLASSIFIED_FIELDS.test(change.field));
    const modified = changes.filter((change) => !UNCLASSIFIED_FIELDS.test(change.field));
    const target = { sid: model.sid, vk, nk, figmaNodeId: node.id };
    const layer = nk === 'root' ? '' : `${node.name} `;
    if (modified.length > 0) drafts.push(componentModified(ctx, model, names, say, node, target, modified, layer));
    if (unclassified.length > 0) {
      drafts.push(
        unknownItem({
          target,
          changes: unclassified,
          code: `${names.code} ${DOT} ${say.args}`,
          designer: `${names.designer} ${DOT} ${say.values} ${DOT} ${unclassified
            .map((change) =>
              change.field === 'vis.name'
                ? `layer ${figmaValue(change.before)} renamed to ${figmaValue(change.after)}`
                : `${change.field} ${figmaValue(change.before)} ${ARROW} ${figmaValue(change.after)}`,
            )
            .join(', ')}`,
          subject: `${names.designer} (${say.values})`,
          where: { sid: model.sid, vk, nk },
        }),
      );
    }
  }
  for (const added of layers.added) drafts.push(nodeAdded(ctx, model, names, say, variant, added, layers.managed));
  for (const nk of layers.removed) drafts.push(nodeRemoved(model, names, say, variant, nk));
  return drafts;
}

function componentModified(
  ctx: ExtractContext,
  model: ComponentModel,
  names: ComponentNames,
  say: VariantWords,
  node: SnapNode,
  target: { sid: string; vk: string; nk: string; figmaNodeId: string },
  changes: readonly DcrChange[],
  layer: string,
): ItemDraft {
  const subject = `${names.designer} (${say.values})`;
  const found = rawValues(changes, node.type, node.groups, ctx.tokens, {
    sid: model.sid,
    vk: target.vk,
    nk: target.nk,
    subject,
    layer: lowerFirst(layer),
  });
  const phrases = phrasesOf(found.changes, node.type, node.groups);
  const designer = phrases.map((phrase) => designerPhrase(phrase, ctx.tokens)).join(', ');
  const short =
    phrases.length > 1 ? phrases.map((phrase) => designerPhrase(phrase, ctx.tokens, false)).join(', ') : designer;
  const codeLayer = target.nk === 'root' ? '' : `${target.nk.slice(target.nk.lastIndexOf('/') + 1)} `;
  return {
    item: {
      kind: 'component.modified',
      title: `${names.code} ${DOT} ${say.args} ${DOT} ${codeLayer}${phrases.map(codePhrase).join(', ')}`,
      designerTitle: `${names.designer} ${DOT} ${say.values} ${DOT} ${capFirst(`${layer}${designer}`)}`,
      target,
      changes: found.changes,
      acceptance: fieldsAcceptance(found.changes, node.type),
      ...(found.diagnostics.length > 0 ? { diagnostics: found.diagnostics } : {}),
    },
    before: true,
    questions: found.questions,
    headline: `${subject}: ${lowerFirst(`${layer}${short}`)}`,
  };
}

function nodeAdded(
  ctx: ExtractContext,
  model: ComponentModel,
  names: ComponentNames,
  say: VariantWords,
  variant: ManagedVariant,
  added: { node: SnapNode; parent: SnapNode; copiedFrom?: string },
  managed: ReadonlyMap<string, SnapNode>,
): ItemDraft {
  const { node, parent } = added;
  const parentNk = [...managed].find(([, candidate]) => candidate === parent)?.[0] ?? 'root';
  const index = (parent.children ?? []).indexOf(node.id);
  const usage = new UsageBuilder(ctx);
  const structure = [usage.build(node, `${parentNk}/${node.name}:${index}`)];
  const diagnostics = [...usage.findings.diagnostics];
  if (added.copiedFrom !== undefined) {
    diagnostics.unshift(
      dcrDiagnostic('DCR_NODE_AMBIGUOUS', { nodeKey: added.copiedFrom, sid: model.sid, variantKey: variant.vk }),
    );
  }
  const parentName = parentNk === 'root' ? names.designer : parent.name;
  return {
    item: {
      kind: 'node.added',
      title: `${names.code} ${DOT} ${say.args} ${DOT} new element ${node.name} in ${parentNk}`,
      designerTitle: `${names.designer} ${DOT} ${say.values} ${DOT} new layer ${node.name} in ${parentName}`,
      target: { sid: model.sid, vk: variant.vk, figmaNodeId: node.id },
      ...(added.copiedFrom === undefined ? {} : { copiedFrom: added.copiedFrom }),
      structure,
      acceptance: existingStructure(),
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    },
    before: true,
    questions: usage.findings.questions,
    headline: `${names.designer} (${say.values}): new layer ${node.name}`,
  };
}

function nodeRemoved(
  model: ComponentModel,
  names: ComponentNames,
  say: VariantWords,
  variant: ManagedVariant,
  nk: string,
): ItemDraft {
  const applied = field(variant.baseline.nodes[nk]?.vis, 'name');
  const name = typeof applied === 'string' ? applied : nk.slice(nk.lastIndexOf('/') + 1);
  return {
    item: {
      kind: 'node.removed',
      title: `${names.code} ${DOT} ${say.args} ${DOT} element ${nk} removed`,
      designerTitle: `${names.designer} ${DOT} ${say.values} ${DOT} layer ${name} removed`,
      target: { sid: model.sid, vk: variant.vk, nk, figmaNodeId: variant.node.id },
      acceptance: existingStructure(),
    },
    before: true,
    questions: [],
    headline: `${names.designer} (${say.values}): layer ${name} removed`,
  };
}

/** Arg values of a new variant: the derived variant's where a value is kept, else inferred (15 §6 notes). */
function inferArgs(
  model: ComponentModel,
  derived: DerivedVariant,
): { args: Record<string, JsonValue>; inferred: boolean } {
  const args: Record<string, JsonValue> = {};
  let inferred = false;
  for (const axis of model.axes) {
    if (!axis.key.startsWith('arg:')) continue;
    const value = derived.values[axis.name];
    if (value === undefined) continue;
    const name = argName(axis.key);
    const known = derived.from.args[name];
    if (value === derived.from.values[axis.name] && known !== undefined) {
      args[name] = known;
    } else {
      args[name] = kebab(value);
      inferred = true;
    }
  }
  return { args, inferred };
}

function variantAdded(
  ctx: ExtractContext,
  model: ComponentModel,
  names: ComponentNames,
  derived: DerivedVariant,
  properties: PropertyChanges,
): ItemDraft {
  const { node, from } = derived;
  const before = from.baseline.nodes.root ?? {};
  const changes = diffNode({ nodeType: node.type, before, after: node.groups }, ctx.tokens).filter(
    (change) => change.field !== 'vis.name' && !isAbsorbedReference(change, properties),
  );
  const found = rawValues(changes, node.type, node.groups, ctx.tokens, {
    sid: model.sid,
    nk: 'root',
    subject: `${names.designer} (${valuesText(derived.values, model.axes)})`,
    layer: '',
  });
  const diagnostics = [...found.diagnostics, ...derivedLayerChanges(ctx, model, derived, properties)];
  const { args, inferred } = inferArgs(model, derived);
  const newArgs = argsText(derived.values, model.axes, args);
  const fromArgs = argsText(from.values, model.axes, from.args);
  const differing = model.axes
    .map((axis) => axis.name)
    .filter((name) => derived.values[name] !== from.values[name] && from.values[name] !== undefined)
    .map((name) => from.values[name] as string);
  return {
    item: {
      kind: 'variant.added',
      title: `${names.code} ${DOT} new variant ${newArgs} (from ${fromArgs})`,
      designerTitle: `${names.designer} ${DOT} new variant ${valuesText(derived.values, model.axes)} (from ${valuesText(from.values, model.axes)})`,
      target: { sid: model.sid, figmaNodeId: node.id },
      derivedFrom: { vk: from.vk, values: { ...from.values } },
      variant: { values: { ...derived.values }, args, ...(inferred ? { inferred: true as const } : {}) },
      ...(found.changes.length > 0 ? { changes: found.changes } : {}),
      acceptance: newVariant(),
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    },
    before: true,
    questions: found.questions,
    headline: `${names.designer}: new variant ${valuesText(derived.values, model.axes)}${
      differing.length > 0 ? ` (from ${differing.join(', ')})` : ''
    }`,
  };
}

/**
 * Changes inside a new variant's layers. A field change has no node path in the item, so
 * each is listed as `DCR_UNKNOWN_CHANGE` on the layer's `nk` (the copy keeps its source's keys).
 */
function derivedLayerChanges(
  ctx: ExtractContext,
  model: ComponentModel,
  derived: DerivedVariant,
  properties: PropertyChanges,
): Diagnostic[] {
  const layers = walkVariant(ctx.index, derived.node, derived.from.baseline);
  const out: Diagnostic[] = [];
  for (const [nk, node] of [...layers.managed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (nk === 'root') continue;
    const before = derived.from.baseline.nodes[nk] as PartialNodeGroups;
    const changes = diffNode({ nodeType: node.type, before, after: node.groups }, ctx.tokens).filter(
      (change) => !isAbsorbedReference(change, properties),
    );
    for (const change of changes) {
      out.push(dcrDiagnostic('DCR_UNKNOWN_CHANGE', { nodeKey: nk, property: change.field, sid: model.sid }));
    }
  }
  for (const added of layers.added) {
    out.push(
      dcrDiagnostic('DCR_UNKNOWN_CHANGE', { nodeKey: added.node.name, property: 'layer added', sid: model.sid }),
    );
  }
  for (const nk of layers.removed) {
    out.push(dcrDiagnostic('DCR_UNKNOWN_CHANGE', { nodeKey: nk, property: 'layer removed', sid: model.sid }));
  }
  return out;
}

function variantRemoved(
  model: ComponentModel,
  names: ComponentNames,
  vk: string,
  values: VariantValues,
  args: Readonly<Record<string, JsonValue>>,
): ItemDraft {
  const text = valuesText(values, model.axes);
  return {
    item: {
      kind: 'variant.removed',
      title: `${names.code} ${DOT} variant removed: ${argsText(values, model.axes, args)}`,
      designerTitle: `${names.designer} ${DOT} ${text} removed`,
      target: { sid: model.sid, vk, figmaNodeId: model.set.id },
      variant: { values: { ...values } },
      acceptance: existingStructure(),
    },
    before: true,
    questions: [],
    headline: `${names.designer}: variant ${text} removed`,
  };
}

/** A component in a managed set without `vk`: Figma duplicates carry one, so this is listed raw. */
function unkeyedVariant(model: ComponentModel, names: ComponentNames, node: SnapNode): ItemDraft {
  return {
    item: {
      kind: 'unknown',
      title: `${names.code} ${DOT} unclassified change: component without a variant key`,
      designerTitle: `${names.designer} ${DOT} new component ${node.name} in the set`,
      target: { sid: model.sid, figmaNodeId: node.id },
      acceptance: existingStructure(),
      diagnostics: [dcrDiagnostic('DCR_UNKNOWN_CHANGE', { sid: model.sid, value: node.name })],
    },
    before: false,
    questions: [],
    headline: `${names.designer}: 1 change Holotype cannot classify (${node.name})`,
  };
}
