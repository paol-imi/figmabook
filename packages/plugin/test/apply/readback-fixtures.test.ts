/*
 * `readGroups` reads what `fixtures/dcr` assumes (B-68 "read-back conventions"): the component
 * sets of the `no-change` case are built in the fake from their groups, read back, and must
 * give the same normalized groups and the same `ah` as the snapshot. Sizes that Figma's text
 * engine decides (hug, fill) differ in the fake's approximate metrics, so for those nodes
 * only the `geom` fields are compared, not their values.
 *
 * One known divergence: the Card variants hug vertically while their content fills that axis.
 * The fake switches such a parent to FIXED (layout-sim assumption `fill-breaks-hug`, to be
 * confirmed by S-05), so for those nodes the fake's sizing is expected instead.
 */
import { appliedHash, changedGroups, type NodeGroups, normalizeGroups } from '@holotype/ir/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { readGroups } from '../../src/apply/readback';
import { createFakeFigma } from '../support/fake';
import { type Built, buildSnapshot, loadSnapshot, type SnapNode } from '../support/snapshot-fake';

const snapshot = loadSnapshot('no-change');
const ROOTS = ['12:1', '20:1', '30:1'];

function subtree(id: string): SnapNode[] {
  const node = snapshot.nodes[id];
  if (!node) return [];
  return [node, ...(node.children ?? []).flatMap(subtree)];
}

const NODES = ROOTS.flatMap(subtree);

/** Whether the snapshot's own sizes are reproducible in the fake: fixed on both axes. */
function fixedSize(node: SnapNode): boolean {
  const layout = node.groups.layout ?? {};
  const fixed = (axis: string) => layout[axis] === undefined || layout[axis] === 'FIXED';
  const text = node.groups.text ?? {};
  return fixed('layoutSizingHorizontal') && fixed('layoutSizingVertical') && text.textAutoResize !== 'WIDTH_AND_HEIGHT';
}

const SIZING = { h: 'layoutSizingHorizontal', v: 'layoutSizingVertical' } as const;

/** The axes on which `node` hugs while a child fills: Figma cannot keep both (see above). */
function fillInHug(node: SnapNode): Array<keyof typeof SIZING> {
  return (['h', 'v'] as const).filter(
    (axis) =>
      node.groups.layout?.[SIZING[axis]] === 'HUG' &&
      (node.children ?? []).some((child) => snapshot.nodes[child]?.groups.layout?.[SIZING[axis]] === 'FILL'),
  );
}

/** The groups to compare: hug and fill sizes keep their keys, not their values. */
function comparable(groups: NodeGroups, node: SnapNode): NodeGroups {
  if (fixedSize(node)) return groups;
  const geom = Object.fromEntries(Object.keys(groups.geom as object).map((key) => [key, 'measured']));
  return { ...groups, geom };
}

/** The snapshot's groups as the fake can build them. */
function buildable(node: SnapNode): NodeGroups {
  const groups = normalizeGroups(node.groups);
  const axes = fillInHug(node);
  if (axes.length === 0) return groups;
  const layout = { ...(groups.layout as Record<string, string>) };
  for (const axis of axes) layout[SIZING[axis]] = 'FIXED';
  return { ...groups, layout };
}

describe('readGroups reads the fixtures/dcr conventions', () => {
  let built: Built;
  const read = new Map<string, NodeGroups>();

  beforeAll(async () => {
    const figma = createFakeFigma();
    built = await buildSnapshot(figma, snapshot, ROOTS);
    for (const node of NODES) {
      const fake = built.nodes.get(node.id);
      if (!fake) throw new Error(`${node.id} was not built`);
      read.set(node.id, normalizeGroups(built.toFixture(await readGroups(fake)) as Record<string, never>));
    }
  });

  it('builds every node of the three sets', () => {
    expect(NODES.length).toBeGreaterThan(50);
    expect(read.size).toBe(NODES.length);
  });

  it.each(NODES.map((node) => [`${node.id} ${node.type} ${node.data.nk ?? ''}`, node] as const))(
    'gives the snapshot groups of %s',
    (_label, node) => {
      const actual = read.get(node.id);
      if (!actual) throw new Error(`${node.id} was not read`);
      expect(comparable(actual, node)).toEqual(comparable(buildable(node), node));
    },
  );

  it('meets the fill-in-hug divergence only on the Card variants', () => {
    expect(NODES.filter((node) => fillInHug(node).length > 0).map((node) => node.id)).toEqual([
      '30:2',
      '30:9',
      '30:17',
    ]);
  });

  it('gives the stored ah of every managed node with a reproducible size', () => {
    const managed = NODES.filter((node) => node.data.ah !== undefined && fixedSize(node));
    expect(managed.length).toBeGreaterThan(10);
    for (const node of managed) {
      const actual = read.get(node.id);
      if (!actual || !node.data.ah) throw new Error(`${node.id} was not read`);
      expect(changedGroups(node.data.ah, appliedHash(actual)), node.id).toEqual([]);
    }
  });

  it('differs from a stored ah at most in geom for measured nodes', () => {
    const measured = NODES.filter((item) => item.data.ah !== undefined && !fixedSize(item) && !fillInHug(item).length);
    expect(measured.length).toBeGreaterThan(10);
    for (const node of measured) {
      const actual = read.get(node.id);
      if (!actual || !node.data.ah) throw new Error(`${node.id} was not read`);
      const changed = changedGroups(node.data.ah, appliedHash(actual));
      expect(
        changed.every((group) => group === 'geom'),
        `${node.id}: ${changed.join(', ')}`,
      ).toBe(true);
    }
  });
});
