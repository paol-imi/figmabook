import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStorybook, readStoryIndex, type StoryIndex, sortedStoryIds } from '../support/storybook.ts';

/**
 * Story ids are API: capture, mapper and DCR tests address stories by id (BUILD §2.3).
 * `test/story-ids.json` is the committed snapshot. New stories add lines; a removed or renamed
 * id fails here and must never be "fixed" by editing the snapshot.
 */
const snapshotPath = new URL('../story-ids.json', import.meta.url);

let outDir = '';
let index: StoryIndex;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'ds-react-sb-'));
  await buildStorybook(outDir);
  index = await readStoryIndex(outDir);
});

afterAll(async () => {
  if (outDir !== '') await rm(outDir, { recursive: true, force: true });
});

describe('storybook build index.json', () => {
  it('is a Storybook 10 index (v5)', () => {
    expect(index.v).toBe(5);
  });

  it('has exactly the committed story ids', async () => {
    const expected = JSON.parse(await readFile(snapshotPath, 'utf8')) as string[];
    expect(expected).toEqual([...expected].sort());
    expect(sortedStoryIds(index)).toEqual(expected);
  });

  it('derives ids from titles: Components/<Name> and Micro/<Group>', () => {
    for (const entry of Object.values(index.entries)) {
      const [section, name] = entry.title.split('/');
      expect(['Components', 'Micro']).toContain(section);
      expect(entry.id.startsWith(`${section?.toLowerCase()}-${name?.toLowerCase()}--`)).toBe(true);
    }
  });

  it('opts every story in to Figma except the icon gallery (`!figma`)', () => {
    const optedOut = Object.values(index.entries)
      .filter((entry) => !(entry.tags ?? []).includes('figma'))
      .map((entry) => entry.id);
    expect(optedOut).toEqual(['components-icon--gallery']);
  });
});
