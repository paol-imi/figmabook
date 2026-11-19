import { err, ok, type Result } from '@holotype/shared';
import { componentIdFromStoryId, isStoryId } from './story-id';
import type { IndexFormat, IndexStory } from './types';

/*
 * Story index parsing (03 §2.2). `index.json` v4 (SB 7–8.0) and v5 (SB ≥8.1) are read the same
 * way, with `tags ?? []`; v5 only adds the automatic `dev` / `test` tags. A v3 `stories.json`
 * (SB 6/7, unsupported) is read only so the error can name the stories that are skipped.
 */

/** A story entry of the index, with the raw JSON it came from (hashed into `indexHash`). */
export interface ParsedStoryEntry {
  readonly story: IndexStory;
  /** `subtype: 'test'` entries are tests, not stories (03 §2.2). */
  readonly isTest: boolean;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface ParsedIndex {
  readonly format: IndexFormat;
  /** The `v` field as read; above 5 means a newer index than this adapter knows. */
  readonly version: number;
  /** Story entries in index order. Docs entries are dropped. */
  readonly entries: readonly ParsedStoryEntry[];
}

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function readTags(value: unknown, where: string): Result<string[], string> {
  if (value === undefined) return ok([]);
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === 'string')) {
    return err(`${where}: "tags" is not an array of strings`);
  }
  return ok([...value]);
}

interface StoryFields {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly name?: unknown;
  readonly importPath?: unknown;
  readonly tags?: unknown;
}

function readStory(key: string, raw: Json, fields: StoryFields): Result<IndexStory, string> {
  const where = `entry "${key}"`;
  const { id, title, name, importPath } = fields;
  if (typeof id !== 'string' || !isStoryId(id)) return err(`${where}: "id" is not a story id`);
  if (typeof title !== 'string' || title === '') return err(`${where}: "title" is missing`);
  if (typeof name !== 'string') return err(`${where}: "name" is missing`);
  if (typeof importPath !== 'string') return err(`${where}: "importPath" is missing`);
  const tags = readTags(fields.tags, where);
  if (!tags.ok) return tags;
  const exportName = optionalString(raw.exportName);
  const componentPath = optionalString(raw.componentPath);
  return ok({
    id,
    sid: componentIdFromStoryId(id),
    title,
    titlePath: title.split('/'),
    name,
    importPath,
    tags: tags.value,
    ...(exportName === undefined ? {} : { exportName }),
    ...(componentPath === undefined ? {} : { componentPath }),
  });
}

/** Parses `index.json` (v4, v5; a higher `v` is read as v5). The error explains what is wrong. */
export function parseStoryIndex(json: unknown): Result<ParsedIndex, string> {
  if (!isObject(json)) return err('index.json is not a JSON object');
  const { v, entries } = json;
  if (typeof v !== 'number' || !Number.isInteger(v)) return err('index.json has no integer "v" field');
  if (v < 4) return err(`index.json has version ${v}; only 4 and newer are read`);
  if (!isObject(entries)) return err('index.json has no "entries" object');

  const parsed: ParsedStoryEntry[] = [];
  for (const [key, raw] of Object.entries(entries)) {
    if (!isObject(raw)) return err(`entry "${key}" is not an object`);
    if (raw.type === 'docs') continue;
    if (raw.type !== 'story') return err(`entry "${key}" has unknown type ${JSON.stringify(raw.type)}`);
    const story = readStory(key, raw, raw);
    if (!story.ok) return story;
    parsed.push({ story: story.value, isTest: raw.subtype === 'test', raw });
  }
  return ok({ format: v === 4 ? 'v4' : 'v5', version: v, entries: parsed });
}

/**
 * Parses a v3 `stories.json` the way Storybook's `transformStoryIndexV3toV4` does: `kind` is the
 * title, `story` the name, `parameters.__id` the id and `parameters.fileName` the import path.
 */
export function parseStoriesJsonV3(json: unknown): Result<ParsedIndex, string> {
  if (!isObject(json)) return err('stories.json is not a JSON object');
  if (json.v !== 3) return err('stories.json is not version 3');
  if (!isObject(json.stories)) return err('stories.json has no "stories" object');

  const parsed: ParsedStoryEntry[] = [];
  for (const [key, raw] of Object.entries(json.stories)) {
    if (!isObject(raw)) return err(`entry "${key}" is not an object`);
    const parameters = isObject(raw.parameters) ? raw.parameters : {};
    if (parameters.docsOnly === true) continue;
    const story = readStory(key, raw, {
      id: parameters.__id ?? raw.id ?? key,
      title: raw.kind ?? raw.title,
      name: raw.story ?? raw.name,
      importPath: parameters.fileName ?? raw.importPath ?? '',
      tags: raw.tags,
    });
    if (!story.ok) return story;
    parsed.push({ story: story.value, isTest: false, raw });
  }
  return ok({ format: 'v3', version: 3, entries: parsed });
}
