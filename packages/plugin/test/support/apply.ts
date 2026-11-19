import type { SceneComponent } from '@holotype/ir';
import { type ApplyBundleOptions, type ApplyResult, applyBundle } from '../../src/apply/bundle';
import type { AssetBytes } from '../../src/apply/resources';
import { NO_SLICING } from '../../src/apply/slicer';
import { createFakeFigma, type FakeFigma, type FakeFigmaOptions } from './fake';
import { ASSETS, type Asset, bundleOf, FIXTURES } from './scenes';

export interface ApplyFixture {
  readonly scenes?: readonly SceneComponent[];
  readonly assets?: readonly Asset[];
  readonly fake?: FakeFigma | FakeFigmaOptions;
  readonly options?: Partial<ApplyBundleOptions>;
}

/** Applies scenes to a fake document, the way a session does, without the protocol. */
export async function applyToFake({ scenes = FIXTURES, assets = ASSETS, fake = {}, options = {} }: ApplyFixture = {}) {
  const figma = 'snapshot' in fake ? fake : createFakeFigma(fake);
  const { manifest } = bundleOf(scenes, assets);
  const byId = new Map(scenes.map((scene) => [scene.sid, scene]));
  const bySha = new Map(assets.map((asset) => [asset.sha, asset]));
  const assetRequests: string[] = [];
  const result: ApplyResult = await applyBundle({
    port: figma,
    manifest,
    loadComponent: async (entry) => {
      const scene = byId.get(entry.sid);
      if (scene === undefined) throw new Error(`No fixture ${entry.sid}`);
      return scene;
    },
    loadAsset: async (sha): Promise<AssetBytes> => {
      assetRequests.push(sha);
      const asset = bySha.get(sha);
      if (asset === undefined) throw new Error(`No asset ${sha}`);
      return asset;
    },
    slicer: NO_SLICING,
    isCancelled: () => false,
    now: () => 0,
    applyId: 'apply-fixture',
    ...options,
  });
  return { figma, result, assetRequests };
}
