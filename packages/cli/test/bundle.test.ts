import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkManifestInvariants,
  type SceneComponent,
  sha256Hex,
  validateBundleManifest,
  validateBundleReport,
  validateSceneComponent,
} from '@holotype/ir';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assetRefs,
  buildBundleReport,
  countNodes,
  createBundle,
  entryMethod,
  featuresOf,
  fontUses,
  outputKind,
  unzipBundle,
  writeBundle,
  zipBundle,
} from '../src';
import { bundleInput, goldenScene, PNG, PNG_SHA } from './support';

const decoder = new TextDecoder();
const json = (bytes: Uint8Array | undefined): unknown => JSON.parse(decoder.decode(bytes));

/** The golden Flex scene with an IMAGE fill on its root, so the bundle carries one asset. */
function withImage(scene: SceneComponent): SceneComponent {
  const [variant] = scene.variants;
  if (variant === undefined) throw new Error('no variant');
  const root = {
    ...variant.root,
    fills: [{ type: 'IMAGE' as const, asset: { sha: PNG_SHA }, scaleMode: 'FILL' as const }],
  };
  return { ...scene, variants: [{ ...variant, root }] };
}

/** Compression method of each local file header of a zip, in entry order. */
function zipMethods(zip: Uint8Array): Array<{ name: string; method: number }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const entries: Array<{ name: string; method: number }> = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(zip.subarray(offset + 30, offset + 30 + nameLength));
    entries.push({ name, method });
    offset += 30 + nameLength + extraLength + size;
  }
  return entries;
}

describe('createBundle (02 §5.1, 06 §4)', () => {
  it('writes the manifest first, then every other file sorted', () => {
    const { files } = createBundle(bundleInput());
    expect([...files.keys()]).toEqual([
      'manifest.json',
      'components/components-badge.json',
      'components/micro-flex.json',
      'report.json',
    ]);
  });

  it('lists every other file in integrity with its sha256', () => {
    const { manifest, files } = createBundle(bundleInput());
    const paths = [...files.keys()].filter((path) => path !== 'manifest.json');
    expect(Object.keys(manifest.integrity.files)).toEqual(paths);
    for (const path of paths)
      expect(manifest.integrity.files[path]).toBe(sha256Hex(files.get(path) ?? new Uint8Array()));
  });

  it('gives a manifest, scenes and report that validate', () => {
    const { manifest, files } = createBundle(bundleInput());
    const parsed = validateBundleManifest(json(files.get('manifest.json')));
    expect(parsed.ok && parsed.value).toEqual(manifest);
    expect(checkManifestInvariants(manifest)).toEqual([]);
    for (const entry of manifest.components) {
      const scene = validateSceneComponent(json(files.get(entry.file)));
      expect(scene.ok).toBe(true);
      expect(scene.ok && scene.value.irh).toBe(entry.irh);
      expect(entry.bytes).toBe(files.get(entry.file)?.byteLength);
    }
    expect(validateBundleReport(json(files.get('report.json'))).ok).toBe(true);
  });

  it('records components, totals and fonts', () => {
    const { manifest } = createBundle(bundleInput());
    expect(
      manifest.components.map(({ sid, name, titlePath, nodes, variants, status }) => ({
        sid,
        name,
        titlePath,
        nodes,
        variants,
        status,
      })),
    ).toEqual([
      {
        sid: 'components-badge',
        name: 'Badge',
        titlePath: ['Components', 'Badge'],
        nodes: 2,
        variants: 1,
        status: 'ok',
      },
      { sid: 'micro-flex', name: 'Flex', titlePath: ['Micro', 'Flex'], nodes: 4, variants: 1, status: 'ok' },
    ]);
    expect(manifest.totals).toEqual({ components: 2, variants: 2, nodes: 6, assetBytes: 0 });
    expect(manifest.fonts).toEqual([{ family: 'Inter', styles: ['Medium'], isCustom: false }]);
    expect(manifest.features).toEqual([]);
    expect(manifest.kind).toBe('holotype/bundle');
    expect(manifest.createdBy).toBe('cli');
  });

  it('carries the referenced assets only, named by their sha256', () => {
    const flex = withImage(goldenScene('micro-flex--row'));
    const unused = new Uint8Array([1, 2, 3]);
    const { manifest, files } = createBundle(
      bundleInput({
        components: [{ scene: flex, status: 'ok', planHash: '0011223344556677' }],
        assets: new Map([
          [PNG_SHA, { sha: PNG_SHA, mime: 'image/png', bytes: PNG, natural: { w: 1, h: 1 } }],
          [sha256Hex(unused), { sha: sha256Hex(unused), mime: 'image/png', bytes: unused }],
        ]),
      }),
    );
    expect(manifest.assets).toEqual([
      { sha: PNG_SHA, mime: 'image/png', bytes: PNG.byteLength, natural: { w: 1, h: 1 } },
    ]);
    expect(files.get(`assets/${PNG_SHA}`)).toEqual(PNG);
    expect(manifest.integrity.files[`assets/${PNG_SHA}`]).toBe(PNG_SHA);
    expect(manifest.totals.assetBytes).toBe(PNG.byteLength);
    expect(manifest.components[0]?.plan).toEqual({ planHash: '0011223344556677' });
  });

  it('refuses input that cannot make a valid bundle', () => {
    const flex = goldenScene('micro-flex--row');
    expect(() =>
      createBundle(
        bundleInput({
          components: [
            { scene: flex, status: 'ok' },
            { scene: flex, status: 'ok' },
          ],
        }),
      ),
    ).toThrow('Two components share the id "micro-flex".');
    expect(() => createBundle(bundleInput({ components: [{ scene: withImage(flex), status: 'ok' }] }))).toThrow(
      `A component refers to asset ${PNG_SHA}, which was not captured.`,
    );
    const wrong = new Map([[PNG_SHA, { sha: PNG_SHA, mime: 'image/png', bytes: new Uint8Array([0]) }]]);
    expect(() =>
      createBundle(bundleInput({ components: [{ scene: withImage(flex), status: 'ok' }], assets: wrong })),
    ).toThrow(`Asset ${PNG_SHA} does not match its bytes.`);
  });
});

describe('zipBundle', () => {
  const bundle = createBundle(
    bundleInput({
      components: [{ scene: withImage(goldenScene('micro-flex--row')), status: 'ok' }],
      assets: new Map([[PNG_SHA, { sha: PNG_SHA, mime: 'image/png', bytes: PNG }]]),
    }),
  );

  it('gives the same bytes for the same files', () => {
    const a = zipBundle(bundle.files);
    const b = zipBundle(
      createBundle(
        bundleInput({
          components: [{ scene: withImage(goldenScene('micro-flex--row')), status: 'ok' }],
          assets: new Map([[PNG_SHA, { sha: PNG_SHA, mime: 'image/png', bytes: PNG }]]),
        }),
      ).files,
    );
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it('stores images and deflates JSON, manifest first', () => {
    expect(zipMethods(zipBundle(bundle.files))).toEqual([
      { name: 'manifest.json', method: 8 },
      { name: `assets/${PNG_SHA}`, method: 0 },
      { name: 'components/micro-flex.json', method: 8 },
      { name: 'report.json', method: 8 },
    ]);
    expect(entryMethod('assets/x', new Uint8Array([0x3c, 0x73, 0x76]))).toBe('deflate');
    expect(entryMethod('assets/x', new Uint8Array([0xff, 0xd8, 0xff]))).toBe('store');
    expect(entryMethod('assets/x', new Uint8Array([0x47, 0x49, 0x46]))).toBe('store');
    expect(entryMethod('report.json', PNG)).toBe('deflate');
  });

  it('round-trips through unzip', () => {
    const files = unzipBundle(zipBundle(bundle.files));
    expect(Object.keys(files)).toEqual([...bundle.files.keys()]);
    for (const [path, bytes] of bundle.files) expect(files[path]).toEqual(bytes);
  });

  it('needs a manifest', () => {
    expect(() => zipBundle(new Map())).toThrow('A bundle needs manifest.json.');
  });
});

describe('writeBundle', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('picks the zip form from the .holotype.zip suffix', () => {
    expect(outputKind('out/run.holotype.zip')).toBe('zip');
    expect(outputKind('OUT/RUN.HOLOTYPE.ZIP')).toBe('zip');
    expect(outputKind('out/run.zip')).toBe('dir');
    expect(outputKind('out/bundle')).toBe('dir');
  });

  it('writes a zip, creating its folder', async () => {
    dir = await mkdtemp(join(tmpdir(), 'holotype-cli-'));
    const bundle = createBundle(bundleInput());
    const written = await writeBundle(bundle, 'nested/smoke.holotype.zip', dir);
    expect(written).toEqual({
      path: join(dir, 'nested/smoke.holotype.zip'),
      kind: 'zip',
      bytes: zipBundle(bundle.files).byteLength,
    });
    expect(new Uint8Array(await readFile(written.path))).toEqual(zipBundle(bundle.files));
    expect(await readdir(join(dir, 'nested'))).toEqual(['smoke.holotype.zip']);
  });

  it('writes the directory form and replaces an earlier bundle there', async () => {
    dir = await mkdtemp(join(tmpdir(), 'holotype-cli-'));
    await writeBundle(createBundle(bundleInput()), 'bundle', dir);
    const flexOnly = createBundle(
      bundleInput({ components: [{ scene: goldenScene('micro-flex--row'), status: 'ok' }] }),
    );
    const written = await writeBundle(flexOnly, 'bundle', dir);
    expect(written.kind).toBe('dir');
    expect((await readdir(join(dir, 'bundle'))).sort()).toEqual(['components', 'manifest.json', 'report.json']);
    expect(await readdir(join(dir, 'bundle/components'))).toEqual(['micro-flex.json']);
    expect(new Uint8Array(await readFile(join(dir, 'bundle/manifest.json')))).toEqual(
      flexOnly.files.get('manifest.json'),
    );
  });
});

describe('scene facts', () => {
  it('counts nodes, assets, fonts and features', () => {
    const badge = goldenScene('components-badge--default');
    expect(countNodes(badge)).toBe(2);
    expect(assetRefs(badge)).toEqual([]);
    expect(assetRefs(withImage(goldenScene('micro-flex--row')))).toEqual([PNG_SHA]);
    expect(fontUses(badge).map((font) => ({ ...font, styles: [...font.styles] }))).toEqual([
      { family: 'Inter', styles: ['Medium'], isCustom: false },
    ]);
    expect(featuresOf(badge)).toEqual([]);
  });

  it('flags locked-lines text as a feature', () => {
    const badge = goldenScene('components-badge--default');
    const [variant] = badge.variants;
    const [text] = variant?.root.children ?? [];
    if (variant === undefined || text?.text === undefined) throw new Error('no text');
    const locked = { ...text, text: { ...text.text, wrapMode: 'locked-lines' as const } };
    const scene = { ...badge, variants: [{ ...variant, root: { ...variant.root, children: [locked] } }] };
    expect(featuresOf(scene)).toEqual(['locked-lines']);
  });
});

describe('buildBundleReport (06 §4.4)', () => {
  it('summarizes components and counts diagnostics by code', () => {
    const warn = { code: 'CAP_CSS_UNSUPPORTED', severity: 'warn' as const, message: 'b' };
    const error = { code: 'SB_STORY_MISSING', severity: 'error' as const, message: 'a' };
    const report = buildBundleReport([
      { sid: 'micro-flex', diagnostics: [warn, { ...warn, message: 'a' }], scene: goldenScene('micro-flex--row') },
      { sid: 'components-nope', diagnostics: [error], skipped: 'the story could not be planned' },
    ]);
    expect(validateBundleReport(report).ok).toBe(true);
    expect(report.summary).toEqual({
      components: 1,
      variants: 1,
      warnings: 2,
      errors: 1,
      autoLayoutCoverage: 0,
      propertyQuality: 1,
      rasterizedNodes: 0,
    });
    expect(report.byCode).toEqual({ CAP_CSS_UNSUPPORTED: 2, SB_STORY_MISSING: 1 });
    expect(report.components.map((c) => c.sid)).toEqual(['components-nope', 'micro-flex']);
    expect(report.components[0]?.skipped).toEqual({ reason: 'the story could not be planned' });
    expect(report.components[1]?.diagnostics.map((d) => d.message)).toEqual(['a', 'b']);
  });

  it('reports the planner budget when there is one', () => {
    const report = buildBundleReport([
      {
        sid: 'micro-flex',
        diagnostics: [],
        scene: goldenScene('micro-flex--row'),
        budget: { requested: 1, emitted: 1, strategy: 'auto', droppedAxes: [] },
      },
    ]);
    expect(report.components[0]?.planner).toEqual({
      budget: { requested: 1, emitted: 1, strategy: 'auto' },
      droppedAxes: [],
    });
  });
});
