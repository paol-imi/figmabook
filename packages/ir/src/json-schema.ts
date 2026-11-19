import type { TSchema } from '@sinclair/typebox';
import { BundleManifestSchema } from './schema/bundle';
import { CaptureDocSchema } from './schema/capture';
import { BundleReportSchema } from './schema/report';
import { SceneComponentSchema } from './schema/scene';
import { TokenSetSchema } from './schema/tokens';
import { BUNDLE_VERSION, CAPTURE_VERSION, parseMajor, SCENE_VERSION, TOKENS_VERSION } from './versions';

const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const DOCUMENTS: ReadonlyArray<readonly [name: string, version: string, schema: TSchema]> = [
  ['capture', CAPTURE_VERSION, CaptureDocSchema],
  ['scene', SCENE_VERSION, SceneComponentSchema],
  ['tokens', TOKENS_VERSION, TokenSetSchema],
  ['bundle', BUNDLE_VERSION, BundleManifestSchema],
  // The report ships inside a bundle and follows the bundle format's major.
  ['report', BUNDLE_VERSION, BundleReportSchema],
];

/**
 * The published JSON Schema files, keyed by file name (`scene.v0.json`, …), as written to
 * `schema/` by the build (06 §7). A test keeps the committed files in sync.
 */
export function jsonSchemaFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [name, version, schema] of DOCUMENTS) {
    const document = { $schema: JSON_SCHEMA_DIALECT, ...schema };
    files[`${name}.v${parseMajor(version)}.json`] = `${JSON.stringify(document, null, 2)}\n`;
  }
  return files;
}
