import { readFileSync } from 'node:fs';
import { type CaptureDoc, checkSceneHashes, checkSceneInvariants, validateSceneComponent } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { mapComponent } from '../src';
import { byKey, keys, layersCapture } from './build';
import { loadCapture, sceneSnapshot, singleInput } from './support';

/*
 * L3 golden tests (12 §1) on real Capture IR: the `@holotype/capture` e2e goldens of
 * ds-react stories (copied to `test/fixtures/capture/`), plus a built kitchen sink of the
 * synthetic layers, mapped to canonical Scene IR in `test/__golden__/`. Regenerate with
 * `pnpm -F @holotype/mapper test -u`, review the diff, then copy the changed files to
 * `packages/plugin/test/apply/mapper-scenes/`, where the plugin applies them to `figma-fake`.
 */

const captured = (story: string) => () => loadCapture(`capture/${story}`);

const STORIES: readonly { story: string; displayName: string; capture: () => CaptureDoc }[] = [
  { story: 'micro-flex--row', displayName: 'Flex', capture: captured('micro-flex--row') },
  { story: 'components-badge--default', displayName: 'Badge', capture: captured('components-badge--default') },
  { story: 'micro-text--single-line', displayName: 'Text', capture: captured('micro-text--single-line') },
  { story: 'micro-borders--uniform', displayName: 'Borders', capture: captured('micro-borders--uniform') },
  { story: 'micro-text--mixed-inline', displayName: 'Text', capture: captured('micro-text--mixed-inline') },
  { story: 'mapper-layers--kitchen-sink', displayName: 'Layers', capture: layersCapture },
];

describe.each(STORIES)('capture golden $story', ({ story, displayName, capture }) => {
  const map = () => mapComponent(singleInput(capture(), { displayName }));
  const golden = `./__golden__/${story}.scene.json`;

  it('maps to the golden Scene IR', async () => {
    await expect(sceneSnapshot(map().scene)).toMatchFileSnapshot(golden);
  });

  it('gives byte-identical output across runs', () => {
    const first = sceneSnapshot(map().scene);
    expect(sceneSnapshot(map().scene)).toBe(first);
    expect(sceneSnapshot(map().scene)).toBe(first);
  });

  it('validates, keeps the 06 §9 invariants and carries consistent hashes', () => {
    const { scene } = map();
    expect(validateSceneComponent(scene).ok).toBe(true);
    expect(checkSceneInvariants(scene)).toEqual([]);
    expect(checkSceneHashes(scene)).toEqual([]);
  });

  it('is the scene the plugin applies in its figma-fake test', () => {
    const copy = new URL(`../../plugin/test/apply/mapper-scenes/${story}.scene.json`, import.meta.url);
    expect(readFileSync(copy, 'utf8')).toBe(sceneSnapshot(map().scene));
  });
});

describe('capture goldens: mapping facts', () => {
  const root = (story: string, displayName = 'Fixture') =>
    mapComponent(singleInput(loadCapture(`capture/${story}`), { displayName })).scene.variants[0]?.root;

  it('keeps the flex row as absolute frames in DOM order', () => {
    const row = root('micro-flex--row');
    expect(row?.children?.map((child) => [child.nk, child.xy])).toEqual([
      ['root/div.item', { x: 8, y: 8 }],
      ['root/div.item#2', { x: 56, y: 8 }],
      ['root/div.item#3', { x: 104, y: 8 }],
    ]);
  });

  it('draws a uniform border as one INSIDE stroke', () => {
    expect(root('micro-borders--uniform')?.strokes).toMatchObject({
      align: 'INSIDE',
      weight: { t: 2, r: 2, b: 2, l: 2 },
    });
  });

  it('reduces the badge pill radius to half its height', () => {
    expect(root('components-badge--default')?.radius).toEqual({ tl: 10, tr: 10, br: 10, bl: 10 });
  });

  it('carries the capture’s unsupported inline background onto the text layer', () => {
    const { scene } = mapComponent(singleInput(loadCapture('capture/micro-text--mixed-inline')));
    const [variant] = scene.variants;
    const text = variant?.root.children?.[0];
    expect(text?.kind).toBe('text');
    expect(variant?.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'CAP_CSS_UNSUPPORTED', property: 'background-color', nodeKey: text?.nk }),
    );
  });

  it('builds every synthetic layer of the kitchen sink', () => {
    const layers = mapComponent(singleInput(layersCapture(), { displayName: 'Layers' })).scene.variants[0]?.root;
    if (layers === undefined) throw new Error('no variant');
    expect(keys(layers)).toEqual([
      'root/div.sides',
      'root/div.inset',
      'root/div.raised',
      'root/div.ring',
      'root/button',
      'root/button/outline',
      'root/section',
      'root/footer',
      'root/span',
      'root/section/div.badge/clip',
    ]);
    expect(keys(byKey(layers, 'root/div.sides'))).toEqual([
      'root/div.sides/border-t',
      'root/div.sides/border-r',
      'root/div.sides/border-b',
      'root/div.sides/border-l',
    ]);
    expect(keys(byKey(layers, 'root/div.inset'))).toEqual(['root/div.inset/bg']);
    expect(keys(byKey(layers, 'root/div.raised'))[0]).toBe('root/div.raised/shadow');
    expect(byKey(layers, 'root/div.ring').strokes?.align).toBe('OUTSIDE');
    expect(byKey(layers, 'root/span').kind).toBe('text');
  });
});
