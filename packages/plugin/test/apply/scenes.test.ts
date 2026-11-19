import {
  checkManifestInvariants,
  checkSceneHashes,
  checkSceneInvariants,
  validateBundleManifest,
  validateSceneComponent,
} from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { bundleOf, FIXTURES } from '../support/scenes';

describe('applier fixtures', () => {
  it.each(FIXTURES.map((scene) => [scene.sid, scene] as const))('%s is valid Scene IR', (_sid, scene) => {
    expect(validateSceneComponent(scene)).toEqual({ ok: true, value: scene });
    expect(checkSceneInvariants(scene)).toEqual([]);
    expect(checkSceneHashes(scene)).toEqual([]);
  });

  it('make a bundle with a valid manifest', () => {
    const { manifest } = bundleOf();
    expect(validateBundleManifest(manifest).ok).toBe(true);
    expect(checkManifestInvariants(manifest)).toEqual([]);
  });
});
