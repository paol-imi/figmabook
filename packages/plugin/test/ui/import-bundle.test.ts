import type { BundleManifest } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { createUiChannel } from '../../src/channel';
import { readBundle } from '../../src/ui/import/bundle';
import { serveBundle, splitUtf8 } from '../../src/ui/import/serve';
import { BUNDLE_LIMITS, unzipBundle } from '../../src/ui/import/unzip';
import { createRecordingTransport, envelope, SESSION } from '../fixtures';
import { ASSETS, badge, bundleOf, FIXTURES, PNG_SHA, zipOf } from '../support/scenes';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

async function read(files: Record<string, Uint8Array>) {
  return readBundle('test.holotype.zip', zipOf(files));
}

async function errorOf(files: Record<string, Uint8Array>) {
  const result = await read(files);
  if (result.ok) throw new Error('expected the bundle to be refused');
  return result.error;
}

/** A bundle whose manifest is replaced (its integrity is kept). */
function withManifest(patch: (manifest: BundleManifest) => unknown) {
  const { manifest, files } = bundleOf();
  return { ...files, 'manifest.json': encode(patch(manifest)) };
}

describe('readBundle (11 §2.3)', () => {
  it('accepts a valid bundle: manifest, component JSON and assets', async () => {
    const result = await read(bundleOf().files);
    if (!result.ok) throw new Error(result.error.message);
    const bundle = result.value;
    expect(bundle.fileName).toBe('test.holotype.zip');
    expect([...bundle.components.keys()]).toEqual(FIXTURES.map((scene) => scene.sid));
    expect(JSON.parse(bundle.components.get('components-badge') ?? '')).toEqual(badge);
    expect([...bundle.assets.keys()].sort()).toEqual(ASSETS.map((asset) => asset.sha).sort());
    expect(bundle.totals).toEqual({ components: 3, variants: 4 });
  });

  it('leaves out components the CLI marked failed', async () => {
    const files = withManifest((manifest) => ({
      ...manifest,
      components: manifest.components.map((entry) =>
        entry.sid === 'components-card' ? { ...entry, status: 'failed' } : entry,
      ),
    }));
    const result = await read(files);
    expect(result.ok && [...result.value.components.keys()]).toEqual(['micro-flex', 'components-badge']);
  });

  it.each([
    ['not a zip', () => new TextEncoder().encode('just text'), 'APPLY_BUNDLE_CORRUPT', /not a zip/],
    ['an empty zip', () => zipOf({}), 'APPLY_BUNDLE_CORRUPT', /empty/],
  ])('refuses %s', async (_name, bytes, code, reason) => {
    const result = await readBundle('x.zip', bytes());
    expect(result.ok ? undefined : result.error).toMatchObject({
      code,
      data: { reason: expect.stringMatching(reason) },
    });
  });

  it.each([
    ['no manifest', () => ({ 'components/x.json': encode({}) }), /manifest.json is missing/],
    ['a manifest that is not JSON', () => ({ 'manifest.json': new TextEncoder().encode('{') }), /not UTF-8 JSON/],
    [
      'another document as manifest',
      () => ({ 'manifest.json': encode({ kind: 'holotype/report' }) }),
      /not a Holotype bundle/,
    ],
    ['an invalid manifest', () => withManifest((m) => ({ ...m, runId: '' })), /manifest.json: \/runId/],
  ])('refuses %s (APPLY_BUNDLE_CORRUPT)', async (_name, files, reason) => {
    expect(await errorOf(files())).toMatchObject({
      code: 'APPLY_BUNDLE_CORRUPT',
      data: { reason: expect.stringMatching(reason) },
    });
  });

  it.each([
    ['bundle format', (m: BundleManifest) => ({ ...m, bundleVersion: '3.0.0' }), 'Bundle format version 3.0.0'],
    ['component format', (m: BundleManifest) => ({ ...m, sceneVersion: '2.1.0' }), 'Component format version 2.1.0'],
  ])('refuses an unknown %s major (APPLY_IR_VERSION_UNSUPPORTED)', async (_name, patch, message) => {
    expect(await errorOf(withManifest(patch))).toMatchObject({
      code: 'APPLY_IR_VERSION_UNSUPPORTED',
      message: expect.stringContaining(message),
    });
  });

  it('refuses features this plugin cannot apply (APPLY_UNSUPPORTED_FEATURE)', async () => {
    expect(await errorOf(withManifest((m) => ({ ...m, features: ['tokens', 'slots'] })))).toMatchObject({
      code: 'APPLY_UNSUPPORTED_FEATURE',
      value: 'tokens, slots',
    });
  });

  it('refuses a file whose checksum differs (APPLY_BUNDLE_CORRUPT)', async () => {
    const { files } = bundleOf();
    const tampered = { ...files, 'components/components-badge.json': encode({ ...badge, sid: 'x' }) };
    expect(await errorOf(tampered)).toMatchObject({
      code: 'APPLY_BUNDLE_CORRUPT',
      sid: 'components-badge',
      value: 'components/components-badge.json',
      data: { reason: expect.stringContaining('does not match its checksum') },
    });
  });

  it('refuses a missing file, or one without a checksum', async () => {
    const { files } = bundleOf();
    const { [`assets/${PNG_SHA}`]: _png, ...missing } = files;
    expect(await errorOf(missing)).toMatchObject({ data: { reason: `assets/${PNG_SHA} is missing from the file` } });
    expect(
      await errorOf(
        withManifest((m) => {
          const { [`assets/${PNG_SHA}`]: _sum, ...rest } = m.integrity.files;
          return { ...m, integrity: { ...m.integrity, files: rest } };
        }),
      ),
    ).toMatchObject({ data: { reason: `assets/${PNG_SHA} has no checksum in the manifest` } });
  });

  it('refuses an asset whose checksum is not its name', async () => {
    const other = 'e'.repeat(64);
    const files = withManifest((m) => ({
      ...m,
      integrity: { ...m.integrity, files: { ...m.integrity.files, [`assets/${PNG_SHA}`]: other } },
    }));
    expect(await errorOf(files)).toMatchObject({
      data: { reason: expect.stringContaining('is not the asset it names') },
    });
  });

  it('refuses a component that is not valid Scene IR, or not the one listed', async () => {
    const broken = bundleOf([{ ...badge, variants: [] }]);
    expect(await errorOf(broken.files)).toMatchObject({
      code: 'APPLY_BUNDLE_CORRUPT',
      sid: 'components-badge',
      data: { reason: expect.stringContaining('/variants') },
    });
    const swapped = bundleOf([badge], ASSETS, (m) => ({
      ...m,
      components: m.components.map((entry) => ({ ...entry, sid: 'components-other' })),
    }));
    expect(await errorOf(swapped.files)).toMatchObject({
      data: { reason: expect.stringContaining('holds component') },
    });
    const future = bundleOf([{ ...badge, sceneVersion: '1.0.0' }]);
    expect(await errorOf(future.files)).toMatchObject({
      code: 'APPLY_IR_VERSION_UNSUPPORTED',
      sid: 'components-badge',
    });
  });
});

describe('unzipBundle: safety limits (06 §8)', () => {
  const zip = zipOf(bundleOf().files);

  it('unzips with fflate (Web Workers, or the synchronous fallback)', async () => {
    const result = await unzipBundle(zip);
    expect(result.ok && Object.keys(result.value)).toContain('manifest.json');
    expect(BUNDLE_LIMITS).toEqual({
      maxCompressedBytes: 200 * 2 ** 20,
      maxUncompressedBytes: 2 * 2 ** 30,
      maxRatio: 100,
    });
  });

  it.each([
    ['too large to read', { ...BUNDLE_LIMITS, maxCompressedBytes: 100 }, /the limit is 100/],
    ['too large uncompressed', { ...BUNDLE_LIMITS, maxUncompressedBytes: 100 }, /more than 100 bytes uncompressed/],
    ['compressed too well', { ...BUNDLE_LIMITS, maxRatio: 1 }, /compression ratio above 1/],
  ])('refuses a bundle %s (APPLY_BUNDLE_REJECTED)', async (_name, limits, reason) => {
    const result = await unzipBundle(zip, limits);
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: 'APPLY_BUNDLE_REJECTED',
      data: { reason: expect.stringMatching(reason) },
    });
  });
});

describe('serveBundle (09 §3.3, UI side)', () => {
  it('splits UTF-8 at character boundaries within the part size', () => {
    const text = 'a😀é'.repeat(50);
    const parts = splitUtf8(text, 10);
    expect(parts.join('')).toBe(text);
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(10);
    expect(splitUtf8('', 10)).toEqual(['']);
    expect(() => splitUtf8('x', 3)).toThrow(RangeError);
  });

  it('answers need with component parts, assets, and empty units for what it lacks', async () => {
    const result = await read(bundleOf().files);
    if (!result.ok) throw new Error(result.error.message);
    const { transport, posted, receive } = createRecordingTransport();
    const stop = serveBundle(createUiChannel(transport, SESSION), result.value, 4096);
    receive({ ...envelope, t: 'need', unit: { kind: 'component', sid: 'components-card' } });
    receive({ ...envelope, t: 'need', unit: { kind: 'asset', sha256: PNG_SHA } });
    receive({ ...envelope, t: 'need', unit: { kind: 'component', sid: 'missing' } });
    receive({ ...envelope, t: 'need', unit: { kind: 'tokens' } });
    const units = posted.map(
      (message) => message as { t: string; seq: number; last: boolean; unit: Record<string, unknown> },
    );
    const card = units.filter((message) => message.unit.sid === 'components-card');
    expect(card.length).toBeGreaterThan(1);
    expect(card.map((message) => message.unit.json).join('')).toBe(result.value.components.get('components-card'));
    expect(card.map((message) => message.last)).toEqual(card.map((_, i) => i === card.length - 1));
    expect(units.map((message) => message.seq)).toEqual(units.map((_, i) => i));
    expect(units.find((message) => message.unit.kind === 'asset')?.unit).toMatchObject({
      sha256: PNG_SHA,
      mime: 'image/png',
    });
    expect(units.find((message) => message.unit.sid === 'missing')?.unit).toMatchObject({
      json: '',
      part: 0,
      parts: 1,
    });
    expect(units.at(-1)?.unit).toEqual({ kind: 'tokens', json: '' });
    stop();
    receive({ ...envelope, t: 'need', unit: { kind: 'tokens' } });
    expect(posted).toHaveLength(units.length);
  });
});
