/*
 * Reads a `.holotype.zip` in the UI (11 §2.3, 09 §3.2 "Integrity"): unzip within the safety
 * limits, then the manifest (kind, versions, schema, features), then every file the import
 * needs against `integrity.files`, then each component against the Scene IR schema. Nothing
 * reaches main before the whole bundle checks out, so a bad file changes nothing in Figma.
 */
import {
  type BundleManifest,
  type SceneComponent,
  type ValidationIssue,
  validateBundleManifest,
  validateSceneComponent,
} from '@holotype/ir';
import { checkVersion, SUPPORTED_BUNDLE_MAJORS, SUPPORTED_SCENE_MAJORS, sha256Hex } from '@holotype/ir/core';
import { createDiagnostic, type Diagnostic, diagnostic, err, ok, type Result } from '@holotype/shared';
import { unsupportedFeatures } from '../../apply/features';
import { notAZip, type Unzip, unzipBundle, type ZipLimits } from './unzip';

export const MANIFEST_FILE = 'manifest.json';

export interface BundleAsset {
  readonly mime: string;
  readonly bytes: Uint8Array;
}

/** A bundle that passed every check, ready to be served to main. */
export interface LoadedBundle {
  readonly fileName: string;
  readonly manifest: BundleManifest;
  /** Component Scene IR JSON text by `sid`, as stored (main parses it once all parts arrive). */
  readonly components: ReadonlyMap<string, string>;
  /** Asset bytes by sha256. */
  readonly assets: ReadonlyMap<string, BundleAsset>;
  readonly totals: { readonly components: number; readonly variants: number };
}

export interface ReadBundleOptions {
  readonly limits?: ZipLimits;
  readonly unzip?: Unzip;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

function corrupt(reason: string, details: { readonly file?: string; readonly sid?: string } = {}): Diagnostic {
  return createDiagnostic(diagnostic('APPLY_BUNDLE_CORRUPT'), undefined, {
    ...(details.sid === undefined ? {} : { sid: details.sid }),
    ...(details.file === undefined ? {} : { value: details.file }),
    data: { reason },
  });
}

const describeIssues = (issues: readonly ValidationIssue[]): string =>
  issues
    .slice(0, 3)
    .map((issue) => `${issue.path || '/'}: ${issue.message}`)
    .join('; ');

function parseJson(bytes: Uint8Array, file: string): Result<{ text: string; value: unknown }, Diagnostic> {
  try {
    const text = decoder.decode(bytes);
    return ok({ text, value: JSON.parse(text) });
  } catch (error) {
    return err(
      corrupt(`${file} is not UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`, { file }),
    );
  }
}

const hasKind = (value: unknown, kind: string): boolean =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === kind;

const versionOf = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined;

/** Manifest checks, in the order that gives the most useful error first. */
function readManifest(files: Readonly<Record<string, Uint8Array>>): Result<BundleManifest, Diagnostic> {
  const bytes = files[MANIFEST_FILE];
  if (bytes === undefined) return err(corrupt(`${MANIFEST_FILE} is missing: this is not a Holotype file`));
  const parsed = parseJson(bytes, MANIFEST_FILE);
  if (!parsed.ok) return parsed;
  const { value } = parsed.value;
  if (!hasKind(value, 'holotype/bundle')) return err(corrupt(`${MANIFEST_FILE} is not a Holotype bundle manifest`));
  // Versions before the schema: another major may have another shape (06 §7).
  const version =
    checkVersion('Bundle format', versionOf(value, 'bundleVersion'), SUPPORTED_BUNDLE_MAJORS) ??
    checkVersion('Component format', versionOf(value, 'sceneVersion'), SUPPORTED_SCENE_MAJORS);
  if (version) return err(version);
  const manifest = validateBundleManifest(value);
  if (!manifest.ok) return err(corrupt(`${MANIFEST_FILE}: ${describeIssues(manifest.error)}`));
  const features = unsupportedFeatures(manifest.value.features);
  if (features.length > 0) {
    return err(
      createDiagnostic(diagnostic('APPLY_UNSUPPORTED_FEATURE'), undefined, {
        property: 'features',
        value: features.join(', '),
      }),
    );
  }
  return ok(manifest.value);
}

/** `integrity.files[path]` must list the file and match its sha256 (06 §4.2). */
function checkIntegrity(
  manifest: BundleManifest,
  files: Readonly<Record<string, Uint8Array>>,
  path: string,
  sid?: string,
): Result<Uint8Array, Diagnostic> {
  const bytes = files[path];
  const expected = manifest.integrity.files[path];
  const where = { file: path, ...(sid === undefined ? {} : { sid }) };
  if (bytes === undefined) return err(corrupt(`${path} is missing from the file`, where));
  if (expected === undefined) return err(corrupt(`${path} has no checksum in the manifest`, where));
  if (sha256Hex(bytes) !== expected) return err(corrupt(`${path} does not match its checksum`, where));
  return ok(bytes);
}

function readComponent(
  manifest: BundleManifest,
  files: Readonly<Record<string, Uint8Array>>,
  entry: BundleManifest['components'][number],
): Result<{ text: string; scene: SceneComponent }, Diagnostic> {
  const bytes = checkIntegrity(manifest, files, entry.file, entry.sid);
  if (!bytes.ok) return bytes;
  const parsed = parseJson(bytes.value, entry.file);
  if (!parsed.ok) return parsed;
  const { text, value } = parsed.value;
  const version = checkVersion('Component format', versionOf(value, 'sceneVersion'), SUPPORTED_SCENE_MAJORS);
  if (version) return err({ ...version, sid: entry.sid });
  const scene = validateSceneComponent(value);
  if (!scene.ok)
    return err(corrupt(`${entry.file}: ${describeIssues(scene.error)}`, { file: entry.file, sid: entry.sid }));
  if (scene.value.sid !== entry.sid) {
    return err(corrupt(`${entry.file} holds component ${scene.value.sid}, not ${entry.sid}`, { file: entry.file }));
  }
  return ok({ text, scene: scene.value });
}

/** Reads and checks a bundle zip. The error is the first problem found, as a diagnostic. */
export async function readBundle(
  fileName: string,
  zip: Uint8Array,
  options: ReadBundleOptions = {},
): Promise<Result<LoadedBundle, Diagnostic>> {
  const unzipped = await unzipBundle(zip, options.limits, options.unzip);
  if (!unzipped.ok) return unzipped;
  const files = unzipped.value;
  if (Object.keys(files).length === 0) return err(notAZip('the archive is empty'));
  const manifest = readManifest(files);
  if (!manifest.ok) return manifest;

  const components = new Map<string, string>();
  let variants = 0;
  for (const entry of manifest.value.components) {
    if (entry.status === 'failed') continue; // not built by the CLI; nothing to import
    const component = readComponent(manifest.value, files, entry);
    if (!component.ok) return component;
    components.set(entry.sid, component.value.text);
    variants += component.value.scene.variants.length;
  }
  const assets = new Map<string, BundleAsset>();
  for (const asset of manifest.value.assets) {
    const path = `assets/${asset.sha}`;
    // An asset is named by its own sha256, so its checksum must be its name.
    const listed = manifest.value.integrity.files[path];
    if (listed !== undefined && listed !== asset.sha) {
      return err(corrupt(`${path} is not the asset it names`, { file: path }));
    }
    const bytes = checkIntegrity(manifest.value, files, path);
    if (!bytes.ok) return bytes;
    assets.set(asset.sha, { mime: asset.mime, bytes: bytes.value });
  }
  return ok({
    fileName,
    manifest: manifest.value,
    components,
    assets,
    totals: { components: components.size, variants },
  });
}
