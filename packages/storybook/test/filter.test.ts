import { describe, expect, it } from 'vitest';
import { filterStories, globToRegExp, type ParsedStoryEntry, parseStoryIndex } from '../src';
import { readFixtureJson, recordedIndex } from './support';

const ids = (entries: readonly ParsedStoryEntry[]) => entries.map((entry) => entry.story.id);

function entry(id: string, tags: string[], title = 'Components/Thing', isTest = false): ParsedStoryEntry {
  const sid = id.slice(0, id.indexOf('--'));
  return {
    story: { id, sid, title, titlePath: title.split('/'), name: id, importPath: './x.stories.tsx', tags },
    isTest,
    raw: {},
  };
}

describe('filterStories: tags (README §7)', () => {
  const recorded = recordedIndex().entries;

  it('treats a story without `figma` as opted out when the project opts in by tag', () => {
    // preview.tsx tags every story `figma`; Storybook resolves the gallery's `!figma` away.
    const { kept, excluded } = filterStories(recorded);
    expect(kept).toHaveLength(52);
    expect(excluded).toEqual([{ id: 'components-icon--gallery', title: 'Components/Icon', reason: 'tag-opt-out' }]);
  });

  it('keeps the same stories with requireTag, and names requireTag as the reason', () => {
    const { kept, excluded } = filterStories(recorded, { requireTag: true });
    expect(kept).toHaveLength(52);
    expect(excluded.map((story) => story.reason)).toEqual(['tag-required']);
  });

  it('keeps every story of a project that does not use the tag', () => {
    const parsed = parseStoryIndex(readFixtureJson('sb8-index-v4', 'index.json'));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(ids(filterStories(parsed.value.entries).kept)).toEqual([
      'forms-input--default',
      'forms-input--disabled',
      'layout-grid--basic',
    ]);
  });

  it('drops every untagged story with requireTag, even when no story is tagged', () => {
    const { kept, excluded } = filterStories([entry('a--one', []), entry('a--two', ['dev'])], { requireTag: true });
    expect(kept).toEqual([]);
    expect(excluded.map((story) => story.reason)).toEqual(['tag-required', 'tag-required']);
  });

  it('honours a literal `!figma` tag over `figma`', () => {
    const { kept, excluded } = filterStories([entry('a--one', ['figma', '!figma']), entry('a--two', [])]);
    expect(kept).toEqual([]);
    expect(excluded).toEqual([
      { id: 'a--one', title: 'Components/Thing', reason: 'tag-opt-out' },
      { id: 'a--two', title: 'Components/Thing', reason: 'tag-opt-out' },
    ]);
  });

  it('never keeps subtype "test" entries', () => {
    const { kept, excluded } = filterStories([entry('a--one', ['figma'], 'A', true), entry('a--two', ['figma'])]);
    expect(ids(kept)).toEqual(['a--two']);
    expect(excluded).toEqual([{ id: 'a--one', title: 'A', reason: 'test-entry' }]);
  });
});

describe('filterStories: include / exclude (16 §5)', () => {
  const recorded = recordedIndex().entries;

  it('matches include globs against the title path', () => {
    const { kept, excluded } = filterStories(recorded, { include: ['Micro/Flex'] });
    expect(ids(kept)).toEqual([
      'micro-flex--row',
      'micro-flex--column',
      'micro-flex--wrap',
      'micro-flex--gap',
      'micro-flex--justify-between',
      'micro-flex--align-center',
      'micro-flex--grow',
      'micro-flex--nested',
    ]);
    expect(excluded.filter((story) => story.reason === 'not-included')).toHaveLength(44);
  });

  it('matches globs against the story id', () => {
    const { kept } = filterStories(recorded, { include: ['components-button--*'], exclude: ['*--loading'] });
    expect(ids(kept)).toEqual([
      'components-button--primary',
      'components-button--secondary',
      'components-button--ghost',
      'components-button--small',
      'components-button--large',
      'components-button--with-icon',
      'components-button--disabled',
    ]);
  });

  it('lets exclude win over include, and tags win over both', () => {
    const { excluded } = filterStories(recorded, { include: ['Components/**'], exclude: ['Components/Icon'] });
    expect(excluded.find((story) => story.id === 'components-icon--default')?.reason).toBe('excluded');
    expect(excluded.find((story) => story.id === 'components-icon--gallery')?.reason).toBe('tag-opt-out');
    expect(excluded.find((story) => story.id === 'micro-flex--row')?.reason).toBe('not-included');
  });
});

describe('globToRegExp', () => {
  it.each([
    ['**', 'Components/Button', true],
    ['Components/*', 'Components/Button', true],
    ['Components/*', 'Components/Forms/Input', false],
    ['Components/**', 'Components/Forms/Input', true],
    ['**/Input', 'Input', true],
    ['**/Input', 'Components/Forms/Input', true],
    ['micro-?lex--row', 'micro-flex--row', true],
    ['micro-flex--row', 'micro-flex--row-2', false],
    ['components-button--*', 'Components-button--primary', false],
    ['a.b(c)', 'a.b(c)', true],
    ['a.b', 'axb', false],
  ])('%s matches %s: %s', (glob, value, expected) => {
    expect(globToRegExp(glob).test(value)).toBe(expected);
  });
});
