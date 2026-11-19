import type { JsonValue } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import {
  canonicalDcr,
  extractDcr,
  type FigmaSnapshot,
  normalizePlugin,
  type PluginNodeRead,
  type PluginReadback,
  SnapshotReadError,
  serializeDcr,
} from '../src';
import { loadInput } from './cases';

/*
 * `normalizePlugin` (15 §4.1): the plugin read-back, with Figma's float noise, aliases as the
 * Plugin API returns them, instance sublayers, baseline chunks and submitted requests, becomes
 * the snapshot the golden cases hold, byte for byte.
 */

const isColor = (value: Record<string, unknown>) => ['r', 'g', 'b'].every((key) => typeof value[key] === 'number');

/** Adds noise below the normalizer's step: 1e-4 on lengths, 1e-5 on color channels. */
function noisy(value: JsonValue, color = false): JsonValue {
  if (typeof value === 'number') return value + (color ? 1e-5 : 1e-4);
  if (Array.isArray(value)) return value.map((item) => noisy(item));
  if (value === null || typeof value !== 'object') return value;
  const colorObject = isColor(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, noisy(item, colorObject)]));
}

/** What plugin main would send for a snapshot: the case's nodes, read raw. */
function readbackOf(snapshot: FigmaSnapshot): PluginReadback {
  const nodes: PluginNodeRead[] = Object.values(snapshot.nodes)
    .reverse()
    .map((node) => ({
      ...node,
      data: { ...node.data, 'base:0': 'eJwrSS0uAQAEXQHB' },
      groups: noisy(node.groups as JsonValue) as never,
    }));
  const instance = nodes.find((node) => node.type === 'INSTANCE');
  if (!instance) throw new Error('the case has no instance');
  const sublayer = `I${instance.id};9:9`;
  const withSublayer = nodes.map((node) => (node === instance ? { ...node, children: [sublayer] } : node));
  withSublayer.push({ id: sublayer, type: 'TEXT', name: 'Label', parent: instance.id, data: {}, groups: {} });
  return {
    fileKey: snapshot.fileKey,
    scope: snapshot.scope,
    pages: snapshot.pages,
    nodes: withSublayer,
    variables: Object.values(snapshot.variables).map((variable) => ({
      ...variable,
      valuesByMode: Object.fromEntries(
        Object.entries(variable.valuesByMode).map(([mode, value]) => {
          const alias = (value as { alias?: unknown }).alias;
          return [mode, typeof alias === 'string' ? { type: 'VARIABLE_ALIAS', id: alias } : noisy(value)];
        }),
      ),
    })),
    rootData: { ...snapshot.rootData, 'request:0': 'H4sIAAAA' },
  };
}

describe('normalizePlugin', () => {
  it('gives the golden snapshot from a raw plugin read-back', () => {
    const { branch, baseline } = loadInput('node-added');
    const normalized = normalizePlugin(readbackOf(branch));
    expect(canonicalDcr(normalized)).toBe(canonicalDcr(branch));
    expect(serializeDcr(extractDcr(normalized, baseline))).toBe(serializeDcr(extractDcr(branch, baseline)));
  });

  it('skips instance sublayers and lists no instance children', () => {
    const { branch } = loadInput('node-added');
    const normalized = normalizePlugin(readbackOf(branch));
    expect(Object.keys(normalized.nodes).some((id) => id.startsWith('I'))).toBe(false);
    expect(normalized.nodes['31:90']?.children).toBeUndefined();
  });

  it('rejects a read-back that is not a snapshot, listing the issues', () => {
    const { branch } = loadInput('no-change');
    const raw = { ...readbackOf(branch), fileKey: '' };
    expect(() => normalizePlugin(raw)).toThrow(SnapshotReadError);
    try {
      normalizePlugin(raw);
    } catch (error) {
      expect((error as SnapshotReadError).issues.some((issue) => issue.startsWith('/fileKey'))).toBe(true);
    }
  });
});
