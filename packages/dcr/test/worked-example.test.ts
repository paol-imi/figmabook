import { describe, expect, it } from 'vitest';
import {
  canonicalDcr,
  checkDcrHash,
  computeDcrHash,
  type DcrItemOf,
  type DesignChangeRequest,
  dcrCore,
  dcrId,
  sealDcr,
  serializeDcr,
} from '../src';
import { validDoc } from './corpus';

/** The `feat/price-tag` request of 15 §6.1, as the CLI writes it (provenance attached). */
const cli = validDoc('dcr', 'worked-example.json') as DesignChangeRequest;
/** The same request as the plugin submits it: no provenance, no head commit, no version id. */
const plugin = validDoc('dcr', 'worked-example-plugin.json') as DesignChangeRequest;

function itemOf<K extends DesignChangeRequest['items'][number]['kind']>(dcr: DesignChangeRequest, kind: K) {
  const found = dcr.items.find((item): item is DcrItemOf<K> => item.kind === kind);
  if (!found) throw new Error(`No ${kind} item.`);
  return found;
}

describe('worked example (15 §6.1)', () => {
  it('Button padding: Figma 13 → 17 (1px border included), CSS 12 → 16, Space/3 → Space/4', () => {
    const item = itemOf(cli, 'component.modified');
    expect(item.target).toMatchObject({ sid: 'components-button', nk: 'root' });
    expect(item.changes.map((c) => [c.field, c.before, c.after, c.css?.after, c.token?.after])).toEqual([
      ['layout.paddingLeft', 13, 17, '16px', '--space-4'],
      ['layout.paddingRight', 13, 17, '16px', '--space-4'],
    ]);
    expect(item.changes[0]?.origin?.transform).toBe('border-included');
    expect(item.acceptance.fields?.map((f) => f.expect)).toEqual([17, 17]);
    expect(item.acceptance.story).toBe('existing');
  });

  it('Button gets tone=danger, derived from tone=primary, with an inferred arg and a must-add story', () => {
    const item = itemOf(cli, 'variant.added');
    expect(item.variant).toEqual({
      values: { Tone: 'Danger', Size: 'md' },
      args: { tone: 'danger', size: 'md' },
      inferred: true,
    });
    expect(item.derivedFrom.values).toEqual({ Tone: 'Primary', Size: 'md' });
    expect(item.acceptance.story).toBe('must-add');
  });

  it('PriceTag is a new component whose nearest existing component is Badge (0.82)', () => {
    const item = itemOf(cli, 'component.new');
    expect(item.nearest?.map((n) => [n.sid, n.score])).toEqual([['components-badge', 0.82]]);
    expect(item.suggested?.exportName).toBe('PriceTag');
    expect(cli.summary.newComponents).toEqual([{ itemId: item.id, name: 'PriceTag', nearest: 'components-badge' }]);
    expect(cli.questions.filter((q) => q.itemId === item.id).map((q) => q.code)).toEqual([
      'DCR_VALUE_UNTOKENIZED',
      'DCR_NEAREST_COMPONENT',
    ]);
  });

  it('the Checkout screen points at PriceTag through a new-component-ref and lists 3 variants', () => {
    const screen = itemOf(cli, 'screen');
    const priceTag = itemOf(cli, 'component.new');
    expect(screen.screen.variants.map((v) => `${v.breakpoint.name}·${v.state}`)).toEqual([
      'Desktop·default',
      'Mobile·default',
      'Mobile·empty',
    ]);
    expect(JSON.stringify(screen.screen.variants[0]?.structure)).toContain(`"itemId":"${priceTag.id}"`);
    expect(screen.acceptance.usage?.mustNotImport).toEqual(['components-legacyalert']);
  });
});

describe('core hash (15 §4.9, D-50)', () => {
  it('plugin and CLI compute the same dcrHash and id from the same snapshot', () => {
    expect(computeDcrHash(plugin)).toBe(cli.dcrHash);
    expect(plugin.dcrHash).toBe(cli.dcrHash);
    expect(plugin.id).toBe(cli.id);
    expect(canonicalDcr(dcrCore(plugin))).toBe(canonicalDcr(dcrCore(cli)));
  });

  it('leaves out header.generated, fileVersion, headCommit and every CLI-added field', () => {
    const core = dcrCore(cli) as unknown as Record<string, unknown>;
    expect(core).not.toHaveProperty('id');
    expect(core).not.toHaveProperty('dcrHash');
    const text = canonicalDcr(core);
    for (const key of [
      '"generated"',
      '"fileVersion"',
      '"headCommit"',
      '"origin"',
      '"css"',
      '"reach"',
      '"varDefinition"',
    ]) {
      expect(text).not.toContain(key);
    }
    const items = (core as unknown as DesignChangeRequest).items;
    expect(items.every((item) => item.target.code === undefined)).toBe(true);
    // Code identities inside usage trees stay: the plugin reads them from the set's `src` key.
    expect(text).toContain('"exportName":"Banner"');
    expect(dcrCore(cli)).toEqual(dcrCore(dcrCore(cli)));
  });

  it('does not change the input', () => {
    const before = JSON.stringify(cli);
    dcrCore(cli);
    computeDcrHash(cli);
    expect(JSON.stringify(cli)).toBe(before);
  });

  it('changes when anything in the core changes', () => {
    const edited = structuredClone(cli);
    const item = edited.items[0];
    if (item?.kind === 'component.modified' && item.changes[0]) item.changes[0].after = 18;
    expect(computeDcrHash(edited)).not.toBe(cli.dcrHash);
    const rescoped = structuredClone(cli);
    rescoped.header.scope = { kind: 'all' };
    expect(computeDcrHash(rescoped)).not.toBe(cli.dcrHash);
  });

  it('is unchanged by what the CLI adds on import: head commit, version id, provenance diagnostics', () => {
    const enriched = structuredClone(plugin);
    enriched.header.headCommit = 'ffffffff';
    enriched.header.figma.fileVersion = '99';
    enriched.diagnostics.push({ code: 'DCR_PROVENANCE_STALE', severity: 'warn', message: 'moved' });
    const first = enriched.items[0];
    if (first) first.diagnostics = [{ code: 'DCR_PROVENANCE_MINIFIED', severity: 'info', message: 'built CSS' }];
    expect(computeDcrHash(enriched)).toBe(cli.dcrHash);
    // Other diagnostics are part of the core.
    enriched.diagnostics.push({ code: 'DCR_TOO_LARGE', severity: 'warn', message: 'big' });
    expect(computeDcrHash(enriched)).not.toBe(cli.dcrHash);
  });

  it('id = h16(repo ∥ branch ∥ fileKey ∥ dcrHash)', () => {
    const { repo, branch, figma } = cli.header;
    expect(dcrId({ repo, branch, fileKey: figma.fileKey, dcrHash: cli.dcrHash })).toBe(cli.id);
    expect(dcrId({ repo, branch: 'feat/other', fileKey: figma.fileKey, dcrHash: cli.dcrHash })).not.toBe(cli.id);
  });

  it('sealDcr reproduces the stored request byte for byte', () => {
    const { id: _id, dcrHash: _hash, ...draft } = cli;
    expect(serializeDcr(sealDcr(draft))).toBe(serializeDcr(cli));
  });

  it('checkDcrHash accepts a sealed request and reports a tampered one with both hashes', () => {
    expect(checkDcrHash(cli)).toBeUndefined();
    const tampered = structuredClone(cli);
    tampered.summary.headline = ['Something else'];
    const diagnostic = checkDcrHash(tampered);
    expect(diagnostic).toMatchObject({ code: 'DCR_SNAPSHOT_PARITY', property: 'dcrHash' });
    expect(diagnostic?.data).toEqual({ field: 'dcrHash', stored: cli.dcrHash, computed: computeDcrHash(tampered) });
    const renamed = structuredClone(cli);
    renamed.id = '0000000000000000';
    expect(checkDcrHash(renamed)).toMatchObject({
      property: 'id',
      data: { stored: '0000000000000000', computed: cli.id },
    });
  });
});
