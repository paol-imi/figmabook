import { checkSceneHashes, checkSceneInvariants, validateSceneComponent, variantKey } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { mapComponent } from '../src';
import { loadCapture, sceneSnapshot, singleInput } from './support';

/*
 * L3 golden tests (12 §1): hand-built Capture IR → canonical Scene IR. Regenerate with
 * `pnpm -F @holotype/mapper test -u` and review the diff like code.
 */

const FIXTURES = [
  { name: 'button', displayName: 'Button' },
  { name: 'card', displayName: 'Card' },
  { name: 'paints', displayName: 'Swatches' },
  { name: 'texts', displayName: 'Texts' },
] as const;

describe.each(FIXTURES)('fixture $name', ({ name, displayName }) => {
  const capture = loadCapture(name);
  const map = () => mapComponent(singleInput(capture, { displayName }));

  it('is keyed by the 06 §6 variant key of its render', () => {
    const { storyId, args, globals, state, viewport } = capture.target;
    expect(capture.target.vk).toBe(variantKey({ storyId, args, globals, state, viewport }));
  });

  it('maps to the golden Scene IR', async () => {
    await expect(sceneSnapshot(map().scene)).toMatchFileSnapshot(`./__snapshots__/${name}.scene.json.snap`);
  });

  it('gives byte-identical output on a second run', () => {
    expect(sceneSnapshot(map().scene)).toBe(sceneSnapshot(map().scene));
  });

  it('validates, keeps the 06 §9 invariants and carries consistent hashes', () => {
    const { scene } = map();
    expect(validateSceneComponent(scene).ok).toBe(true);
    expect(checkSceneInvariants(scene)).toEqual([]);
    expect(checkSceneHashes(scene)).toEqual([]);
  });

  it('returns every diagnostic of the scene, component level first', () => {
    const { scene, diagnostics } = map();
    expect(diagnostics).toEqual([...scene.diagnostics, ...scene.variants.flatMap((variant) => variant.diagnostics)]);
  });
});
