import { APPLIED_HASH_LENGTH, appliedHash, changedGroups, normalizeGroups } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { baselineGroupsOf, caseDir, listCases, loadCaseInput } from '../src/index.ts';

/*
 * The `ah` of every managed node is what the shared normalizer computes from the node's applied
 * groups (06 §6 "ah", D-31, B-58): `appliedHash(normalizeGroups(baseline groups))`, computed here
 * with `@holotype/ir` directly rather than through the seal helpers. Read back against the branch
 * groups, the sub-hashes name exactly the groups the designer edited.
 */

/** Per case, the managed nodes whose read-back differs from their `ah`, with the groups that differ. */
const EDITED: Readonly<Record<string, readonly string[]>> = {
  'modified-color': ['12:2 paint,bind'],
  'modified-padding': ['12:11 geom,layout'],
  'modified-radius': ['30:2 paint,bind'],
  'modified-text': ['12:8 geom', '12:10 geom,text,bind'],
  'noise-only': ['12:2 geom', '12:4 geom', '20:5 geom', '20:7 geom'],
  'property-added': ['30:4 bind', '30:12 bind', '30:19 bind'],
  'property-renamed': ['12:3', '12:6', '12:9', '12:12', '12:15', '12:18', '12:21', '12:24', '12:27'].map(
    (id) => `${id} bind`,
  ),
  'token-changed': ['20:8 paint'],
  'variant-added': ['12:90 paint,vis,bind'],
};

describe.each(listCases())('%s: ah', (name) => {
  const { branch, baseline } = loadCaseInput(caseDir(name));
  const managed = Object.values(branch.nodes).filter((node) => node.data.ah !== undefined);

  it('is the applied hash of each managed node’s baseline groups', () => {
    expect(managed.length).toBeGreaterThan(0);
    for (const node of managed) {
      // A duplicated variant keeps the plugin data, and so the baseline, of its original.
      const groups = baselineGroupsOf(branch, baseline, node);
      expect(groups, `${node.id} has no baseline groups`).toBeDefined();
      expect(node.data.ah, node.id).toHaveLength(APPLIED_HASH_LENGTH);
      expect(node.data.ah, node.id).toBe(appliedHash(normalizeGroups(groups ?? {})));
    }
  });

  it('differs from the branch read-back only in the groups the designer edited', () => {
    const edited = managed.flatMap((node) => {
      const groups = changedGroups(node.data.ah ?? '', appliedHash(normalizeGroups(node.groups)));
      return groups.length === 0 ? [] : [`${node.id} ${groups.join(',')}`];
    });
    expect(edited).toEqual(EDITED[name] ?? []);
  });
});
