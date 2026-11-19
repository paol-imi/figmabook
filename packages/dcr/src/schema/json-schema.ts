import { type PublishedSchema, toJsonSchema } from '@holotype/ir';
import { DesignChangeRequestSchema } from './dcr';
import { DcrAnswersSchema, DcrDecisionsSchema } from './sidecar';
import { BaselineSnapshotSchema, FigmaSnapshotSchema } from './snapshot';
import { DCR_VERSION, SNAPSHOT_VERSION } from './versions';

const DCR_MAJOR = Number(DCR_VERSION.split('.')[0]);

/**
 * The JSON Schema files the `dcr` package publishes (D-07): `schema/<name>.v<major>.json`.
 * The sidecar files (`answers.json`, `decisions.json`) follow the DCR major.
 */
export const DCR_PUBLISHED_SCHEMAS: readonly PublishedSchema[] = [
  { name: 'dcr', major: DCR_MAJOR, schema: DesignChangeRequestSchema },
  { name: 'figma-snapshot', major: SNAPSHOT_VERSION, schema: FigmaSnapshotSchema },
  { name: 'baseline', major: SNAPSHOT_VERSION, schema: BaselineSnapshotSchema },
  { name: 'answers', major: DCR_MAJOR, schema: DcrAnswersSchema },
  { name: 'decisions', major: DCR_MAJOR, schema: DcrDecisionsSchema },
];

/**
 * The published files keyed by file name (`dcr.v1.json`, …), as the build writes them to
 * `schema/`. A test keeps the committed files in sync.
 */
export function dcrJsonSchemaFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const { name, major, schema } of DCR_PUBLISHED_SCHEMAS) {
    files[`${name}.v${major}.json`] = `${JSON.stringify(toJsonSchema(schema), null, 2)}\n`;
  }
  return files;
}
