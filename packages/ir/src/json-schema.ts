import { Kind, type TSchema } from '@sinclair/typebox';
import { BundleManifestSchema } from './schema/bundle';
import { CaptureDocSchema } from './schema/capture';
import { HolotypeConfigSchema } from './schema/config';
import { ProvenanceDocSchema } from './schema/provenance';
import { BundleReportSchema } from './schema/report';
import { SceneComponentSchema } from './schema/scene';
import { TokensDocSchema } from './schema/tokens';
import {
  BUNDLE_VERSION,
  CAPTURE_VERSION,
  CONFIG_VERSION,
  PROVENANCE_VERSION,
  parseMajor,
  SCENE_VERSION,
  TOKENS_VERSION,
} from './versions';

const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** A published JSON Schema: `schema/<name>.v<major>.json` (06 §7). */
export interface PublishedSchema {
  readonly name: string;
  readonly major: number;
  readonly schema: TSchema;
}

const major = (version: string): number => {
  const value = parseMajor(version);
  if (value === undefined) throw new Error(`Invalid schema version "${version}".`);
  return value;
};

/** The documents whose schemas are published. The `dcr` package publishes its own (15 §6). */
export const PUBLISHED_SCHEMAS: readonly PublishedSchema[] = [
  { name: 'capture', major: major(CAPTURE_VERSION), schema: CaptureDocSchema },
  { name: 'scene', major: major(SCENE_VERSION), schema: SceneComponentSchema },
  { name: 'tokens', major: major(TOKENS_VERSION), schema: TokensDocSchema },
  { name: 'bundle', major: major(BUNDLE_VERSION), schema: BundleManifestSchema },
  // The report ships inside a bundle and follows the bundle format's major.
  { name: 'report', major: major(BUNDLE_VERSION), schema: BundleReportSchema },
  { name: 'config', major: major(CONFIG_VERSION), schema: HolotypeConfigSchema },
  { name: 'provenance', major: PROVENANCE_VERSION, schema: ProvenanceDocSchema },
];

/**
 * A TypeBox schema as plain JSON Schema 2020-12. TypeBox-only kinds have no JSON form:
 * properties typed `Function` (`.ts`/`.js` configs only, 16 §1) are left out.
 */
export function toJsonSchema(schema: TSchema): Record<string, unknown> {
  const converted = convert(schema);
  if (converted === OMIT) throw new TypeError('toJsonSchema: the root schema has no JSON form.');
  return { $schema: JSON_SCHEMA_DIALECT, ...(converted as Record<string, unknown>) };
}

const OMIT = Symbol('omit');

function convert(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convert).filter((item) => item !== OMIT);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string | symbol, unknown>;
  if (record[Kind] === 'Function') return OMIT;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === 'properties' && item !== null && typeof item === 'object') {
      const properties: Record<string, unknown> = {};
      for (const [name, property] of Object.entries(item)) {
        const next = convert(property);
        if (next !== OMIT) properties[name] = next;
      }
      out.properties = properties;
      continue;
    }
    const next = convert(item);
    if (next !== OMIT) out[key] = next;
  }
  if (Array.isArray(out.required) && out.properties !== undefined) {
    const kept = out.properties as Record<string, unknown>;
    out.required = out.required.filter((name) => typeof name === 'string' && name in kept);
  }
  // TypeBox writes tuples the draft-07 way; draft 2020-12 spells them `prefixItems`.
  if (Array.isArray(out.items)) {
    out.prefixItems = out.items;
    out.items = out.additionalItems ?? false;
    delete out.additionalItems;
  }
  return out;
}

/**
 * The published JSON Schema files, keyed by file name (`scene.v0.json`, …), as written to
 * `schema/` by the build. A test keeps the committed files in sync.
 */
export function jsonSchemaFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const { name, major: version, schema } of PUBLISHED_SCHEMAS) {
    files[`${name}.v${version}.json`] = `${JSON.stringify(toJsonSchema(schema), null, 2)}\n`;
  }
  return files;
}
