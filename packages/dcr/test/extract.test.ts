import { HolotypeError } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import {
  canonicalDcr,
  checkDcrIntegrity,
  type DesignChangeRequest,
  dcrCore,
  extractDcr,
  type FigmaSnapshot,
  serializeDcr,
  sortDcr,
  validateDcr,
} from '../src';
import { type CaseInput, itemsOf, loadInput, node, onlyItem, setGroupValue } from './cases';

/*
 * The extraction rules of 15 §4.2–§4.4, §4.7, one edit at a time on the `no-change` golden
 * case (Button 12:*, Badge 20:*, Card 30:*, every token a variable). The golden cases of
 * `fixtures/dcr` check the whole requests; these check each rule and diagnostic.
 */

function extract({ branch, baseline }: CaseInput): DesignChangeRequest {
  const request = extractDcr(branch, baseline);
  const valid = validateDcr(request);
  if (!valid.ok) throw new Error(`invalid request: ${valid.error.map((i) => `${i.path} ${i.message}`).join('; ')}`);
  expect(checkDcrIntegrity(request)).toEqual([]);
  return request;
}

const codes = (request: DesignChangeRequest) => [
  ...request.diagnostics.map((d) => d.code),
  ...request.items.flatMap((item) => (item.diagnostics ?? []).map((d) => d.code)),
];

/** The `no-change` case, scope `changed`. */
function changed(): CaseInput {
  const input = loadInput('no-change');
  input.branch.scope = { kind: 'changed' };
  return input;
}

describe('extractDcr: identity and the empty request', () => {
  it('gives an empty request for an untouched branch file', () => {
    const request = extract(loadInput('no-change'));
    expect(request.items).toEqual([]);
    expect(request.questions).toEqual([]);
    expect(request.diagnostics).toEqual([]);
    expect(request.summary.headline).toEqual([]);
  });

  it('is deterministic and leaves the file version out of the core', () => {
    const input = loadInput('modified-padding');
    const first = extract(input);
    const again = extract({ ...input, branch: { ...input.branch, fileVersion: '42' } });
    expect(serializeDcr(extract(input))).toBe(serializeDcr(first));
    expect(again.header.figma.fileVersion).toBe('42');
    expect(again.dcrHash).toBe(first.dcrHash);
    expect(canonicalDcr(dcrCore(sortDcr(again)))).toBe(canonicalDcr(dcrCore(sortDcr(first))));
  });

  it('refuses a file without branch:meta (DCR_NOT_BRANCH_FILE)', () => {
    const { branch, baseline } = changed();
    delete branch.rootData['branch:meta'];
    let thrown: unknown;
    try {
      extractDcr(branch, baseline);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HolotypeError);
    expect((thrown as HolotypeError).code).toBe('DCR_NOT_BRANCH_FILE');
  });

  it('reports a variant without a baseline (DCR_BASELINE_MISSING) and skips it', () => {
    const { branch, baseline } = changed();
    const input = { branch, baseline: baseline.filter((b) => !(b.vk === '0ea44dbf4e7b9668' && b.props === undefined)) };
    setGroupValue(node(input.branch, '12:2'), 'layout', 'paddingTop', 9);
    const request = extract(input);
    expect(request.diagnostics.map((d) => [d.code, d.variantKey])).toEqual([
      ['DCR_BASELINE_MISSING', '0ea44dbf4e7b9668'],
    ]);
    expect(request.items).toEqual([]);
  });

  it('lists a component in a managed set without a variant key as unknown', () => {
    const input = changed();
    const set = node(input.branch, '12:1');
    const copy = { ...node(input.branch, '12:2'), id: '12:99', data: {}, children: [] };
    input.branch.nodes['12:99'] = copy;
    set.children = [...(set.children ?? []), '12:99'];
    const item = onlyItem(extract(input));
    expect(item.kind).toBe('unknown');
    expect(item.diagnostics?.map((d) => d.code)).toEqual(['DCR_UNKNOWN_CHANGE']);
  });

  it('reads a renamed variant as a new variant plus a removed one (15 §4.2)', () => {
    const input = changed();
    const variant = node(input.branch, '12:20');
    variant.component = { ...variant.component, variantValues: { Variant: 'Outline', Size: 'Md' } };
    variant.name = 'Variant=Outline, Size=Md';
    const request = extract(input);
    expect(request.items.map((item) => item.kind)).toEqual(['variant.added', 'variant.removed']);
    const [added] = itemsOf(request, 'variant.added');
    expect(added?.variant).toEqual({
      values: { Variant: 'Outline', Size: 'Md' },
      args: { size: 'md', variant: 'outline' },
      inferred: true,
    });
    expect(added?.derivedFrom.vk).toBe('83575a6a0b901b0e');
  });
});

describe('extractDcr: field changes (component.modified)', () => {
  it('drops derived geometry and keeps a size on a FIXED axis', () => {
    const input = changed();
    const root = node(input.branch, '12:2');
    setGroupValue(root, 'geom', 'width', 120);
    expect(extract(input).items).toEqual([]);
    setGroupValue(root, 'geom', 'height', 40);
    const item = onlyItem(extract(input));
    expect(item.kind).toBe('component.modified');
    if (item.kind !== 'component.modified') return;
    expect(item.changes.map((c) => c.field)).toEqual(['geom.height']);
    expect(item.acceptance.fields).toEqual([{ field: 'geom.height', expect: 40, tol: 0.5 }]);
  });

  it('reports a new child order as layout.children.order with nk lists', () => {
    const input = changed();
    const actions = node(input.branch, '30:6');
    actions.children = [...(actions.children ?? [])].reverse();
    const item = onlyItem(extract(input));
    if (item.kind !== 'component.modified') throw new Error(item.kind);
    expect(item.target.nk).toBe('root/content/actions');
    expect(item.changes).toEqual([
      {
        group: 'layout',
        field: 'layout.children.order',
        before: ['root/content/actions/button', 'root/content/actions/button#1'],
        after: ['root/content/actions/button#1', 'root/content/actions/button'],
      },
    ]);
  });

  it('lists a renamed layer as unknown (DCR_UNKNOWN_CHANGE)', () => {
    const input = changed();
    setGroupValue(node(input.branch, '30:4'), 'vis', 'name', 'Heading');
    const item = onlyItem(extract(input));
    expect(item.kind).toBe('unknown');
    expect(item.designerTitle).toBe('Card · Story=Default · layer Title renamed to Heading');
    expect(item.diagnostics?.[0]).toMatchObject({ code: 'DCR_UNKNOWN_CHANGE', nodeKey: 'root/content/title' });
  });

  it('asks for a token when a raw value matches none (DCR_VALUE_NO_TOKEN)', () => {
    const input = changed();
    const content = node(input.branch, '30:3');
    setGroupValue(content, 'layout', 'paddingTop', 13);
    const { paddingTop: _unbound, ...bind } = content.groups.bind as Record<string, string>;
    content.groups.bind = bind;
    const request = extract(input);
    const item = onlyItem(request);
    if (item.kind !== 'component.modified') throw new Error(item.kind);
    expect(item.changes).toEqual([
      { group: 'layout', field: 'layout.paddingTop', before: 16, after: 13, token: { before: '--space-4' } },
    ]);
    expect(item.title).toBe('Card · story=default · content padding-top 16 → 13');
    expect(item.designerTitle).toBe('Card · Story=Default · Content padding top 16 → 13 (space/4 → no variable)');
    expect(request.questions).toEqual([
      {
        id: 'q1',
        itemId: item.id,
        code: 'DCR_VALUE_NO_TOKEN',
        text: 'Card (Story=Default) content padding top is 13px and matches no token. Add a token, or keep the value?',
        options: ['add a token', 'keep 13px'],
      },
    ]);
    expect(request.summary.tokens.untokenized).toBe(1);
  });

  it('lists every matching token, sorted, when several match (DCR_VALUE_UNTOKENIZED)', () => {
    const input = changed();
    const root = node(input.branch, '30:2');
    const bind = { ...(root.groups.bind as Record<string, unknown>) };
    for (const corner of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'])
      delete bind[corner];
    root.groups.bind = bind as never;
    const request = extract(input);
    const item = onlyItem(request);
    if (item.kind !== 'component.modified') throw new Error(item.kind);
    expect(item.changes.map((c) => c.token)).toEqual(
      Array(4).fill({ before: '--card-radius', candidates: ['--card-radius', '--radius-lg'] }),
    );
    expect(item.designerTitle).toBe('Card · Story=Default · Corner radius 10 → 10 (card/radius → no variable)');
    expect(request.questions[0]?.text).toBe(
      'Card (Story=Default) corner radius is 10px and is not bound to a variable. 2 tokens match: --card-radius, --radius-lg. Which one?',
    );
    expect(request.questions[0]?.options).toEqual(['--card-radius', '--radius-lg', 'keep 10px']);
    expect(item.diagnostics?.map((d) => d.code)).toEqual(Array(4).fill('DCR_VALUE_UNTOKENIZED'));
  });

  it('asks about a field with no CSS equivalent (DCR_FIELD_UNMAPPABLE)', () => {
    const input = changed();
    setGroupValue(node(input.branch, '30:2'), 'paint', 'cornerSmoothing', 0.6);
    const request = extract(input);
    expect(codes(request)).toContain('DCR_FIELD_UNMAPPABLE');
    expect(request.questions.map((q) => q.code)).toEqual(['DCR_FIELD_UNMAPPABLE']);
  });

  it('skips a locked layer (designer-owned, 15 §3.2)', () => {
    const input = changed();
    const body = node(input.branch, '30:5');
    body.data = { ...body.data, lock: '1' };
    setGroupValue(body, 'text', 'characters', 'Rewritten by the designer');
    expect(extract(input).items).toEqual([]);
  });

  it('caps the headline at 8 lines, the last one counting the rest', () => {
    const input = changed();
    for (const id of ['12:2', '12:5', '12:8', '12:11', '12:14', '12:17', '12:20', '12:23', '12:26']) {
      setGroupValue(node(input.branch, id), 'paint', 'opacity', 0.5);
    }
    const { summary, items } = extract(input);
    expect(items).toHaveLength(9);
    expect(summary.headline).toHaveLength(8);
    expect(summary.headline[7]).toBe('and 2 more changes');
  });
});

describe('extractDcr: layers (node.added, node.removed)', () => {
  it('reads a later copy of a duplicated nk as node.added with copiedFrom (DCR_NODE_AMBIGUOUS)', () => {
    const input = changed();
    const content = node(input.branch, '30:3');
    input.branch.nodes['30:99'] = { ...node(input.branch, '30:4'), id: '30:99' };
    content.children = [...(content.children ?? []), '30:99'];
    const item = onlyItem(extract(input));
    if (item.kind !== 'node.added') throw new Error(item.kind);
    expect(item.copiedFrom).toBe('root/content/title');
    expect(item.diagnostics?.[0]).toMatchObject({ code: 'DCR_NODE_AMBIGUOUS', nodeKey: 'root/content/title' });
    expect(item.structure?.[0]).toMatchObject({
      t: 'text',
      key: 'root/content/Title:3',
      characters: 'Mountain retreat',
    });
  });

  it('keeps an instance of a component that is not in the file as a frame (DCR_REMOTE_COMPONENT_UNRESOLVED)', () => {
    const input = loadInput('node-added');
    const badge = node(input.branch, '31:90');
    badge.instance = { ...(badge.instance as NonNullable<typeof badge.instance>), mainId: '99:1', mainKey: 'lib-key' };
    const item = onlyItem(extract(input));
    if (item.kind !== 'node.added') throw new Error(item.kind);
    expect(item.structure).toEqual([{ t: 'frame', key: 'root/content/Badge:0', name: 'Badge', children: [] }]);
    expect(item.diagnostics).toEqual([
      expect.objectContaining({ code: 'DCR_REMOTE_COMPONENT_UNRESOLVED', value: 'lib-key' }),
    ]);
  });

  it('keeps an instance of a component with no code identity as a frame (DCR_IMPORT_UNRESOLVED)', () => {
    const input = loadInput('node-added');
    const badgeSet = node(input.branch, '20:1');
    const { src: _src, ...data } = badgeSet.data;
    badgeSet.data = data;
    const item = onlyItem(extract(input));
    if (item.kind !== 'node.added') throw new Error(item.kind);
    expect(item.structure?.[0]?.t).toBe('frame');
    expect(item.diagnostics).toEqual([
      expect.objectContaining({ code: 'DCR_IMPORT_UNRESOLVED', sid: 'components-badge' }),
    ]);
  });

  it('flags edits inside the layers of a new variant, which have no node path in the item', () => {
    const input = loadInput('variant-added');
    setGroupValue(node(input.branch, '12:92'), 'text', 'textCase', 'UPPER');
    const [item] = itemsOf(extract(input), 'variant.added');
    expect(item?.diagnostics).toEqual([
      expect.objectContaining({ code: 'DCR_UNKNOWN_CHANGE', nodeKey: 'root/label', property: 'text.textCase' }),
    ]);
  });

  it('marks an instance property with no arg as unmapped (DCR_PROPERTY_UNMAPPED)', () => {
    const input = loadInput('node-added');
    const badge = node(input.branch, '31:90');
    const instance = badge.instance as NonNullable<typeof badge.instance>;
    instance.properties = { ...instance.properties, 'Icon name#99:1': { type: 'TEXT', value: 'star' } };
    const request = extract(input);
    const item = onlyItem(request);
    if (item.kind !== 'node.added') throw new Error(item.kind);
    const usage = item.structure?.[0];
    expect(usage?.t === 'instance' && usage.inst.props.iconName).toEqual({ unmapped: 'star' });
    expect(request.questions.map((q) => q.code)).toEqual(['DCR_PROPERTY_UNMAPPED']);
  });

  it('lists an override no property explains as an unknown change', () => {
    const input = loadInput('node-added');
    const badge = node(input.branch, '31:90');
    const instance = badge.instance as NonNullable<typeof badge.instance>;
    instance.overrides = [{ id: 'I31:90;20:6', fields: ['fills'] }, ...instance.overrides];
    const item = onlyItem(extract(input));
    expect(item.diagnostics).toEqual([
      expect.objectContaining({
        code: 'DCR_UNKNOWN_CHANGE',
        nodeKey: 'root/content/Badge:0',
        property: 'overrides.fills',
      }),
    ]);
  });

  it('reports only the top-most removed layer', () => {
    const input = changed();
    const content = node(input.branch, '30:3');
    content.children = (content.children ?? []).filter((id) => id !== '30:6');
    for (const id of ['30:6', '30:7', '30:8']) delete input.branch.nodes[id];
    const item = onlyItem(extract(input));
    expect(item).toMatchObject({ kind: 'node.removed', target: { nk: 'root/content/actions', figmaNodeId: '30:2' } });
    expect(item.designerTitle).toBe('Card · Story=Default · layer Actions removed');
  });
});

describe('extractDcr: properties', () => {
  const defs = (snapshot: FigmaSnapshot, id: string) => {
    const set = node(snapshot, id);
    return set.component?.propertyDefs as Record<string, Record<string, unknown>>;
  };

  it('reports a new default as property.changed with the previous default', () => {
    const input = changed();
    const label = defs(input.branch, '12:1')['Label#13:0'] as Record<string, unknown>;
    label.defaultValue = 'Click';
    const item = onlyItem(extract(input));
    expect(item).toMatchObject({
      kind: 'property.changed',
      target: { key: 'arg:label' },
      property: { name: 'Label', type: 'TEXT', default: 'Click', previous: { default: 'Button' } },
      title: 'Button · property label default Button → Click',
    });
  });

  it('lists a removed property as unknown: no item kind deletes a prop (D-20)', () => {
    const input = changed();
    delete defs(input.branch, '12:1')['Show icon#13:1'];
    const item = onlyItem(extract(input));
    expect(item).toMatchObject({ kind: 'unknown', target: { key: 'arg:showIcon' } });
  });

  it('reports a new variant axis as property.added with its values', () => {
    const input = changed();
    defs(input.branch, '30:1').Density = {
      type: 'VARIANT',
      defaultValue: 'Comfortable',
      variantOptions: ['Comfortable', 'Compact'],
    };
    const item = onlyItem(extract(input));
    expect(item).toMatchObject({
      kind: 'property.added',
      target: { key: 'Density' },
      property: { type: 'VARIANT', name: 'Density', values: ['Comfortable', 'Compact'], default: 'Comfortable' },
      acceptance: { story: 'must-add' },
    });
  });
});

describe('extractDcr: tokens and scope', () => {
  it('reports a variable created by the designer as token.added', () => {
    const input = changed();
    input.branch.variables['VariableID:9:1'] = {
      id: 'VariableID:9:1',
      name: 'Color/Brand accent',
      collection: 'Tokens',
      resolvedType: 'COLOR',
      valuesByMode: { '1:0': { r: 1, g: 0.5, b: 0, a: 1 } },
      data: {},
    };
    const item = onlyItem(extract(input));
    expect(item).toMatchObject({
      kind: 'token.added',
      target: { key: '--color-brand-accent', figmaNodeId: 'VariableID:9:1' },
      title: 'New token --color-brand-accent · #ff8000',
      variable: { modes: { '1:0': { after: { r: 1, g: 0.5, b: 0, a: 1 } } } },
    });
  });

  it('keeps only the value after when the value before cannot be recovered', () => {
    const input = changed();
    const space = input.branch.variables['VariableID:1:40'];
    if (!space) throw new Error('space/4');
    space.valuesByMode = { '1:0': 18 };
    const items = itemsOf(extract(input), 'token.changed');
    expect(items).toHaveLength(1);
    expect(items[0]?.variable.modes).toEqual({ '1:0': { after: 18 } });
    expect(items[0]?.title).toBe('Token --space-4 · 18');
  });

  it('lists a new top-level frame as unknown until screens are extracted', () => {
    const input = changed();
    input.branch.nodes['70:1'] = {
      id: '70:1',
      type: 'FRAME',
      name: 'Checkout',
      parent: '0:1',
      data: {},
      groups: { vis: { name: 'Checkout', visible: true } },
    };
    input.branch.pages[0]?.topLevel.push('70:1');
    expect(onlyItem(extract(input))).toMatchObject({ kind: 'unknown', target: { figmaNodeId: '70:1' } });
    const meta = JSON.parse(input.branch.rootData['branch:meta'] as string);
    input.branch.rootData['branch:meta'] = JSON.stringify({ ...meta, baseFrames: ['70:1'] });
    expect(extract(input).items).toEqual([]);
  });

  it('limits a page or selection scope to its components', () => {
    const input = changed();
    setGroupValue(node(input.branch, '12:2'), 'geom', 'height', 50);
    setGroupValue(node(input.branch, '30:2'), 'paint', 'opacity', 0.5);
    expect(extract(input).items).toHaveLength(2);
    input.branch.scope = { kind: 'selection', ids: ['30:4'] };
    expect(onlyItem(extract(input)).target.sid).toBe('components-card');
    input.branch.scope = { kind: 'page', name: 'Elsewhere' };
    expect(extract(input).items).toEqual([]);
    input.branch.scope = { kind: 'ready' };
    expect(extract(input).items).toEqual([]);
  });
});
