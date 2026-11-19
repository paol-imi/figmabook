import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type ParsedIndex, parseStoryIndex } from '../src';

/** Absolute path of a directory under `test/fixtures/`. */
export function fixtureDir(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));
}

export function readFixtureJson(name: string, file: string): unknown {
  return JSON.parse(readFileSync(`${fixtureDir(name)}${file}`, 'utf8')) as unknown;
}

/** The `index.json` recorded from a `fixtures/ds-react` Storybook 10.6.7 build. */
export function recordedIndex(): ParsedIndex {
  const parsed = parseStoryIndex(readFixtureJson('sb10-ds-react', 'index.json'));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}
