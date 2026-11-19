import {
  BUNDLE_VERSION,
  type BundleFeature,
  type BundleManifest,
  type BundleReport,
  canonicalJSON,
  checkManifestInvariants,
  SCENE_VERSION,
  type SceneComponent,
  sceneNumKind,
  sha256Hex,
} from '@holotype/ir';
import { assetRefs, countNodes, featuresOf, fontUses } from './scene-facts';

/** A component that made it into the bundle. Failed components are only in `report.json`. */
export interface BundleComponentInput {
  readonly scene: SceneComponent;
  /** `partial` when some variants failed (03 §5.3). */
  readonly status: 'ok' | 'partial';
  /** `h16` of the canonical `ComponentPlan`. */
  readonly planHash?: string;
}

export interface BundleAssetInput {
  readonly sha: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
  readonly natural?: { readonly w: number; readonly h: number };
}

/** Everything the bundle writer needs (02 §5.1, 06 §4). */
export interface BundleInput {
  readonly runId: string;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly generator: BundleManifest['generator'];
  readonly source: BundleManifest['source'];
  readonly configHash: string;
  readonly components: readonly BundleComponentInput[];
  /** Asset bytes by sha256; only the assets a component refers to are written. */
  readonly assets: ReadonlyMap<string, BundleAssetInput>;
  readonly report: BundleReport;
}

/** A bundle in memory: its manifest and every file, `manifest.json` first, the rest sorted. */
export interface Bundle {
  readonly manifest: BundleManifest;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export const MANIFEST_FILE = 'manifest.json';
export const REPORT_FILE = 'report.json';

const encoder = new TextEncoder();

/** The bytes of a bundle JSON file: canonical JSON (06 §5), Scene IR number kinds. */
export function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(canonicalJSON(value, { numKind: sceneNumKind }));
}

export const componentFile = (sid: string): string => `components/${sid}.json`;
export const assetFile = (sha: string): string => `assets/${sha}`;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function fontsOf(scenes: readonly SceneComponent[]): BundleManifest['fonts'] {
  const merged = new Map<string, { styles: Set<string>; isCustom: boolean }>();
  for (const font of scenes.flatMap(fontUses)) {
    const entry = merged.get(font.family) ?? { styles: new Set<string>(), isCustom: false };
    for (const style of font.styles) entry.styles.add(style);
    entry.isCustom ||= font.isCustom;
    merged.set(font.family, entry);
  }
  return [...merged]
    .sort(([a], [b]) => compare(a, b))
    .map(([family, { styles, isCustom }]) => ({ family, styles: [...styles].sort(compare), isCustom }));
}

/**
 * Builds a bundle (02 §5.1, 06 §4): `components/<sid>.json`, the referenced `assets/<sha>`,
 * `report.json`, then the manifest with `integrity` over every other file. Pure: the same
 * input always gives the same files. Throws a `RangeError` for input that cannot make a
 * valid bundle (two components with one `sid`, a referenced asset without bytes).
 */
export function createBundle(input: BundleInput): Bundle {
  const components = [...input.components].sort((a, b) => compare(a.scene.sid, b.scene.sid));
  const body = new Map<string, Uint8Array>();
  const entries: BundleManifest['components'] = [];
  const shas = new Set<string>();
  const features = new Set<BundleFeature>();

  for (const { scene, status, planHash } of components) {
    const file = componentFile(scene.sid);
    if (body.has(file)) throw new RangeError(`Two components share the id "${scene.sid}".`);
    const bytes = encodeJson(scene);
    body.set(file, bytes);
    for (const sha of assetRefs(scene)) shas.add(sha);
    for (const feature of featuresOf(scene)) features.add(feature);
    entries.push({
      sid: scene.sid,
      name: scene.meta.name,
      titlePath: scene.meta.titlePath,
      irh: scene.irh,
      file,
      bytes: bytes.byteLength,
      variants: scene.variants.length,
      nodes: countNodes(scene),
      dependencies: scene.dependencies,
      status,
      ...(planHash === undefined ? {} : { plan: { planHash } }),
    });
  }

  const assets: BundleManifest['assets'] = [];
  for (const sha of [...shas].sort(compare)) {
    const asset = input.assets.get(sha);
    if (asset === undefined) throw new RangeError(`A component refers to asset ${sha}, which was not captured.`);
    if (sha256Hex(asset.bytes) !== sha) throw new RangeError(`Asset ${sha} does not match its bytes.`);
    body.set(assetFile(sha), asset.bytes);
    assets.push({
      sha,
      mime: asset.mime,
      bytes: asset.bytes.byteLength,
      ...(asset.natural === undefined ? {} : { natural: { w: asset.natural.w, h: asset.natural.h } }),
    });
  }
  body.set(REPORT_FILE, encodeJson(input.report));

  const paths = [...body.keys()].sort(compare);
  const manifest: BundleManifest = {
    kind: 'holotype/bundle',
    bundleVersion: BUNDLE_VERSION,
    runId: input.runId,
    createdAt: input.createdAt,
    sceneVersion: SCENE_VERSION,
    features: [...features].sort(compare),
    generator: input.generator,
    createdBy: 'cli',
    source: input.source,
    config: { hash: input.configHash },
    components: entries,
    assets,
    fonts: fontsOf(components.map((component) => component.scene)),
    totals: {
      components: entries.length,
      variants: entries.reduce((sum, entry) => sum + entry.variants, 0),
      nodes: entries.reduce((sum, entry) => sum + entry.nodes, 0),
      assetBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    },
    integrity: {
      algo: 'sha256',
      files: Object.fromEntries(paths.map((path) => [path, sha256Hex(body.get(path) ?? new Uint8Array())])),
    },
  };
  const [violation] = checkManifestInvariants(manifest);
  if (violation) throw new RangeError(`Invalid manifest at ${violation.path}: ${violation.message}`);

  const files = new Map<string, Uint8Array>([[MANIFEST_FILE, encodeJson(manifest)]]);
  for (const path of paths) files.set(path, body.get(path) ?? new Uint8Array());
  return { manifest, files };
}
