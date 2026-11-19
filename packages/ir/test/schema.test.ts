import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type BundleManifest, jsonSchemaFiles, migrateScene, validateBundleManifest, validateSceneComponent } from '../src';

const manifest: BundleManifest = {
  kind: 'holotype/bundle',
  bundleVersion: '0.1.0',
  sceneVersion: '0.1.0',
  features: [],
  generator: { name: '@holotype/cli', version: '0.0.0', mapper: '0.0.0', capture: '0.0.0', chromium: '140.0.0.0', playwright: '1.63.0' },
  createdBy: 'cli',
  source: { storybookVersion: '10.6.7', origin: 'http://localhost:6006/', fingerprint: 'a'.repeat(64) },
  config: { hash: '0123456789abcdef' },
  components: [],
  assets: [],
  fonts: [],
  totals: { components: 0, variants: 0, nodes: 0, assetBytes: 0 },
};

describe('schema validation', () => {
  it('accepts a valid bundle manifest and ignores unknown fields', () => {
    expect(validateBundleManifest(manifest).ok).toBe(true);
    expect(validateBundleManifest({ ...manifest, addedInAMinor: true }).ok).toBe(true);
  });

  it('reports JSON pointers for invalid documents', () => {
    const result = validateBundleManifest({ ...manifest, createdBy: 'robot', totals: { ...manifest.totals, nodes: -1 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.map((issue) => issue.path)).toEqual(expect.arrayContaining(['/createdBy', '/totals/nodes']));
  });
});

describe('migrateScene', () => {
  const scene = {
    kind: 'holotype/scene-component',
    sceneVersion: '0.1.0',
    sid: 'components-button',
    irh: '0123456789abcdef',
    variants: [{ vk: 'fedcba9876543210', irh: '0123456789abcdef', values: { Size: 'md' } }],
    dependencies: [],
    diagnostics: [],
  };

  it('passes the current major through, ready for validation', () => {
    const migrated = migrateScene(scene);
    expect(migrated.ok && validateSceneComponent(migrated.value).ok).toBe(true);
  });

  it.each([{ ...scene, sceneVersion: '7.0.0' }, { ...scene, sceneVersion: 'latest' }, 'not a document'])(
    'rejects unsupported versions with APPLY_IR_VERSION_UNSUPPORTED',
    (input) => {
      const result = migrateScene(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error[0]).toMatchObject({ code: 'APPLY_IR_VERSION_UNSUPPORTED', severity: 'error' });
    },
  );
});

describe('JSON Schema emission (06 §7)', () => {
  it('committed schema/*.json files match the TypeBox sources (run `pnpm build` to regenerate)', () => {
    const expected = jsonSchemaFiles();
    const dir = new URL('../schema/', import.meta.url);
    expect(readdirSync(dir).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, contents] of Object.entries(expected)) {
      expect(readFileSync(new URL(name, dir), 'utf8'), name).toBe(contents);
    }
  });
});
