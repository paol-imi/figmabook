import { describe, expect, it } from 'vitest';
import { parseStoriesJsonV3, parseStoryIndex } from '../src';
import { readFixtureJson, recordedIndex } from './support';

describe('parseStoryIndex: recorded Storybook 10 index (v5)', () => {
  const index = recordedIndex();

  it('reads all 53 story entries of fixtures/ds-react in index order', () => {
    expect(index.format).toBe('v5');
    expect(index.version).toBe(5);
    expect(index.entries).toHaveLength(53);
    expect(index.entries[0]?.story.id).toBe('components-badge--default');
    expect(index.entries.at(-1)?.story.id).toBe('micro-text--mixed-inline');
    expect(index.entries.some((entry) => entry.isTest)).toBe(false);
  });

  it('normalizes a component story', () => {
    const button = index.entries.find((entry) => entry.story.id === 'components-button--primary');
    expect(button?.story).toEqual({
      id: 'components-button--primary',
      sid: 'components-button',
      title: 'Components/Button',
      titlePath: ['Components', 'Button'],
      name: 'Primary',
      importPath: './src/components/Button/Button.stories.tsx',
      tags: ['dev', 'test', 'manifest', 'figma'],
      exportName: 'Primary',
      componentPath: './src/components/Button/Button.tsx',
    });
  });

  it('leaves componentPath out for stories without a component', () => {
    const row = index.entries.find((entry) => entry.story.id === 'micro-flex--row');
    expect(row?.story).not.toHaveProperty('componentPath');
    expect(row?.story.exportName).toBe('Row');
  });

  it('keeps the raw entry for the index hash', () => {
    const gallery = index.entries.find((entry) => entry.story.id === 'components-icon--gallery');
    expect(gallery?.raw).toMatchObject({ type: 'story', subtype: 'story', tags: ['dev', 'test', 'manifest'] });
  });
});

describe('parseStoryIndex: v4 and edge cases', () => {
  it('reads v4 with tags ?? [] and drops docs entries', () => {
    const parsed = parseStoryIndex(readFixtureJson('sb8-index-v4', 'index.json'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.format).toBe('v4');
    expect(parsed.value.entries.map((entry) => [entry.story.id, entry.story.tags])).toEqual([
      ['forms-input--default', []],
      ['forms-input--disabled', ['autodocs']],
      ['layout-grid--basic', []],
    ]);
  });

  it('flags subtype "test" entries', () => {
    const parsed = parseStoryIndex(readFixtureJson('sb11-beta', 'index.json'));
    expect(parsed.ok && parsed.value.entries.map((entry) => [entry.story.id, entry.isTest])).toEqual([
      ['components-button--primary', false],
      ['components-button--clicks', true],
    ]);
  });

  it('reads a newer index version as v5', () => {
    const parsed = parseStoryIndex({ v: 6, entries: {} });
    expect(parsed.ok && parsed.value).toEqual({ format: 'v5', version: 6, entries: [] });
  });

  const story = { type: 'story', id: 'a--b', name: 'B', title: 'A', importPath: './a.stories.ts' };
  it.each([
    ['not an object', [], 'index.json is not a JSON object'],
    ['no version', { entries: {} }, 'index.json has no integer "v" field'],
    ['v3 under index.json', { v: 3, entries: {} }, 'index.json has version 3; only 4 and newer are read'],
    ['no entries', { v: 5 }, 'index.json has no "entries" object'],
    ['unknown type', { v: 5, entries: { x: { ...story, type: 'page' } } }, 'entry "x" has unknown type "page"'],
    ['bad id', { v: 5, entries: { x: { ...story, id: 'nodashes' } } }, 'entry "x": "id" is not a story id'],
    ['no title', { v: 5, entries: { x: { ...story, title: '' } } }, 'entry "x": "title" is missing'],
    ['bad tags', { v: 5, entries: { x: { ...story, tags: 'figma' } } }, 'entry "x": "tags" is not an array of strings'],
  ])('rejects %s', (_label, json, message) => {
    expect(parseStoryIndex(json)).toEqual({ ok: false, error: message });
  });
});

describe('parseStoriesJsonV3', () => {
  it('maps kind/story/parameters.__id and skips docs-only entries', () => {
    const parsed = parseStoriesJsonV3(readFixtureJson('sb6-stories-v3', 'stories.json'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.format).toBe('v3');
    expect(parsed.value.entries.map((entry) => entry.story)).toEqual([
      {
        id: 'example-button--primary',
        sid: 'example-button',
        title: 'Example/Button',
        titlePath: ['Example', 'Button'],
        name: 'Primary',
        importPath: './src/Button.stories.js',
        tags: [],
      },
      {
        id: 'example-header--logged-in',
        sid: 'example-header',
        title: 'Example/Header',
        titlePath: ['Example', 'Header'],
        name: 'Logged In',
        importPath: './src/Header.stories.js',
        tags: [],
      },
    ]);
  });

  it.each([
    ['not an object', null, 'stories.json is not a JSON object'],
    ['wrong version', { v: 4, stories: {} }, 'stories.json is not version 3'],
    ['no stories', { v: 3 }, 'stories.json has no "stories" object'],
  ])('rejects %s', (_label, json, message) => {
    expect(parseStoriesJsonV3(json)).toEqual({ ok: false, error: message });
  });
});
