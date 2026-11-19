import { describe, expect, it } from 'vitest';
import {
  bundleFingerprint,
  canonicalJSON,
  checkSceneHashes,
  DEFAULT_DCR_CONFIG,
  dcrConfigHash,
  h16,
  type SceneComponent,
  type SceneNode,
  sceneComponentIrh,
  sceneNodeIrh,
  type TokensDoc,
  tokensIrh,
  variantKey,
  withSceneHashes,
} from '../src';
import { validDoc } from './corpus';

const button = () => structuredClone(validDoc('scene', 'button.json')) as SceneComponent;
const label = (scene: SceneComponent): SceneNode => {
  const node = scene.variants[0]?.root.children?.[1];
  if (!node) throw new Error('fixture: no label node');
  return node;
};

describe('variantKey (06 §6)', () => {
  it('is h16 of the canonical render inputs, independent of key order', () => {
    const input = {
      storyId: 'components-button--primary',
      args: { label: 'Save' },
      globals: {},
      state: null,
      viewport: { w: 1280, h: 800 },
    };
    expect(variantKey(input)).toBe('4e6c1d1c8f394a90');
    expect(
      variantKey({
        viewport: { h: 800, w: 1280 },
        state: null,
        globals: {},
        args: { label: 'Save' },
        storyId: input.storyId,
      }),
    ).toBe('4e6c1d1c8f394a90');
  });
});

describe('node irh', () => {
  it.each<[string, (node: SceneNode) => void]>([
    ['source', (node) => (node.source = { path: 'x', tag: 'p' })],
    ['diagnostics', (node) => (node.diagnostics = [{ code: 'TEXT_X', severity: 'info', message: 'm' }])],
    ['expect', (node) => (node.expect = { x: 1, y: 1, w: 1, h: 1 })],
    ['child.intent', (node) => node.child && Object.assign(node.child, { intent: { h: 'fixed' } })],
    ['text.lines in reflow mode', (node) => node.text && Object.assign(node.text, { lines: [] })],
    ['irh itself', (node) => (node.irh = 'ffffffffffffffff')],
    ['float noise below 1/1000 px', (node) => (node.size = { w: 64.0001, h: 20 })],
  ])('ignores %s', (_field, mutate) => {
    const scene = button();
    const before = sceneNodeIrh(label(scene));
    mutate(label(scene));
    expect(sceneNodeIrh(label(scene))).toBe(before);
  });

  it.each<[string, (node: SceneNode) => void]>([
    ['name', (node) => (node.name = 'Caption')],
    ['visible', (node) => (node.visible = false)],
    ['size', (node) => (node.size = { w: 65, h: 20 })],
    ['text.characters', (node) => node.text && Object.assign(node.text, { characters: 'Save' })],
    ['propRefs', (node) => (node.propRefs = {})],
    [
      'text.lines in locked-lines mode',
      (node) => node.text && Object.assign(node.text, { wrapMode: 'locked-lines', lines: [] }),
    ],
  ])('changes with %s', (_field, mutate) => {
    const scene = button();
    const before = sceneNodeIrh(label(scene));
    mutate(label(scene));
    expect(sceneNodeIrh(label(scene))).not.toBe(before);
  });

  it('includes the fallback, which the plugin may apply, but not layout.verified or instance.match', () => {
    const scene = button();
    const root = scene.variants[0]?.root as SceneNode;
    const before = sceneNodeIrh(root);
    if (root.layout) root.layout.verified = { ...root.layout.verified, maxDelta: 0.5 };
    expect(sceneNodeIrh(root)).toBe(before);
    if (root.fallback) root.fallback.size = { w: 97, h: 40 };
    expect(sceneNodeIrh(root)).not.toBe(before);

    const icon = root.children?.[0] as SceneNode;
    const iconBefore = sceneNodeIrh(icon);
    if (icon.instance) icon.instance.match = { method: 'name', maxDelta: 3 };
    expect(sceneNodeIrh(icon)).toBe(iconBefore);
  });
});

describe('Merkle hashes', () => {
  it('withSceneHashes is idempotent and agrees with checkSceneHashes', () => {
    const hashed = withSceneHashes(button());
    expect(withSceneHashes(hashed)).toEqual(hashed);
    expect(checkSceneHashes(hashed)).toEqual([]);
  });

  it('a child edit propagates to the variant and component hashes only', () => {
    const scene = withSceneHashes(button());
    const edited = structuredClone(scene);
    label(edited).name = 'Caption';
    const rehashed = withSceneHashes(edited);
    expect(rehashed.irh).not.toBe(scene.irh);
    expect(rehashed.variants[0]?.irh).not.toBe(scene.variants[0]?.irh);
    expect(rehashed.variants[1]?.irh).toBe(scene.variants[1]?.irh);
    expect(rehashed.variants[0]?.root.children?.[0]?.irh).toBe(scene.variants[0]?.root.children?.[0]?.irh);
  });

  it('checkSceneHashes points at the node whose content changed', () => {
    // Each level hashes its children's stored `irh`, so only the edited node is stale.
    const scene = withSceneHashes(button());
    label(scene).visible = false;
    expect(checkSceneHashes(scene)).toEqual([
      { path: '/variants/0/root/children/1/irh', expected: sceneNodeIrh(label(scene)), actual: label(scene).irh },
    ]);
    const variant = scene.variants[1];
    if (variant) variant.irh = '0000000000000000';
    expect(checkSceneHashes(scene).map((mismatch) => mismatch.path)).toEqual([
      '/variants/0/root/children/1/irh',
      '/variants/1/irh',
      '/irh',
    ]);
  });

  it('hashes an instance fallback subtree as part of the instance', () => {
    const card = structuredClone(validDoc('scene', 'card-kitchen-sink.json')) as SceneComponent;
    expect(checkSceneHashes(card)).toEqual([]);
    const fallback = card.variants[0]?.root.children?.[0]?.instance?.fallback as SceneNode;
    fallback.size = { w: 25, h: 24 };
    expect(checkSceneHashes(card).map((m) => m.path)).toContain('/variants/0/root/children/0/instance/fallback/irh');
    const rehashed = withSceneHashes(card);
    expect(checkSceneHashes(rehashed)).toEqual([]);
  });

  it('the component hash ignores the Storybook origin of links, not their path', () => {
    const scene = withSceneHashes(button());
    const moved = structuredClone(scene);
    moved.meta.links = [{ label: 'Storybook', url: 'https://ds.example.com/?path=/docs/components-button--docs' }];
    expect(sceneComponentIrh(moved)).toBe(scene.irh);
    moved.meta.links = [{ label: 'Storybook', url: 'https://ds.example.com/?path=/docs/other--docs' }];
    expect(sceneComponentIrh(moved)).not.toBe(scene.irh);
  });
});

describe('tokens irh, bundle fingerprint, config hash', () => {
  const tokens = validDoc('tokens', 'ds-react.json') as TokensDoc;

  it('tokens irh ignores usage counts and the plugin preflight match', () => {
    const changed = structuredClone(tokens);
    const variable = changed.variables[0];
    if (!variable) throw new Error('fixture');
    variable.provenance.usedBy = 999;
    variable.match = { kind: 'local', id: 'VariableID:1:2', by: 'name' };
    expect(tokensIrh(changed)).toBe(tokens.irh);
    variable.codeSyntax = { WEB: 'var(--renamed)' };
    expect(tokensIrh(changed)).not.toBe(tokens.irh);
  });

  it('bundleFingerprint does not depend on component order', () => {
    const entry = (irh: string) => ({ irh }) as never;
    const config = { hash: '41ab09cd77e01f23' };
    const tokensEntry = { file: 'tokens.json', irh: '0c9d33a1f2e4b560', variables: 1, collections: 1 } as const;
    const a = bundleFingerprint({
      components: [entry('bbbb000000000000'), entry('aaaa000000000000')],
      tokens: tokensEntry,
      config,
    });
    const b = bundleFingerprint({
      components: [entry('aaaa000000000000'), entry('bbbb000000000000')],
      tokens: tokensEntry,
      config,
    });
    expect(a).toBe(b);
    expect(a).toBe(h16('aaaa000000000000bbbb0000000000000c9d33a1f2e4b56041ab09cd77e01f23'));
  });

  it('dcrConfigHash is h16 of the canonical resolved config', () => {
    expect(dcrConfigHash(DEFAULT_DCR_CONFIG)).toBe(h16(canonicalJSON(DEFAULT_DCR_CONFIG)));
    expect(dcrConfigHash({ ...DEFAULT_DCR_CONFIG, scope: 'all' })).not.toBe(dcrConfigHash(DEFAULT_DCR_CONFIG));
  });
});
