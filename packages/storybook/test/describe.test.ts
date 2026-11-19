import { afterEach, describe, expect, it } from 'vitest';
import {
  codeRefOf,
  type IndexStory,
  parseComponentsManifest,
  type RawStoryMeta,
  readStoryMetas,
  SAFE_LIMITS,
  toStoryMeta,
} from '../src';
import { readFixtureJson, recordedIndex } from './support';

const stories: IndexStory[] = recordedIndex().entries.map((entry) => entry.story);
const story = (id: string): IndexStory => {
  const found = stories.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no story ${id}`);
  return found;
};
const parsedManifest = parseComponentsManifest(readFixtureJson('sb10-manifest', 'components.json'));
if (parsedManifest === undefined) throw new Error('the recorded manifest does not parse');
const manifest = parsedManifest;

describe('codeRefOf (15 §5.3)', () => {
  it('takes the CSF and component paths from the index and the export and package from the manifest', () => {
    expect(codeRefOf(story('components-badge--tones'), stories, manifest, 'BadgeDisplayName')).toEqual({
      sid: 'components-badge',
      exportName: 'Badge',
      importPath: './src/components/Badge/Badge.tsx',
      storiesPath: './src/components/Badge/Badge.stories.tsx',
      storyIds: ['components-badge--default', 'components-badge--tones', 'components-badge--with-dot'],
      package: '@holotype/fixture-ds-react',
    });
  });

  it('falls back to the docgen name without a manifest', () => {
    const code = codeRefOf(story('components-button--primary'), stories, undefined, 'Button');
    expect(code.exportName).toBe('Button');
    expect(code).not.toHaveProperty('package');
  });

  it('has no export name for a story without a component', () => {
    const code = codeRefOf(story('micro-flex--row'), stories, manifest, undefined);
    expect(code).not.toHaveProperty('exportName');
    expect(code.storiesPath).toBe('./src/micro/Flex.stories.tsx');
  });
});

describe('toStoryMeta (03 §4.4)', () => {
  const raw: RawStoryMeta = {
    id: 'components-button--primary',
    title: 'Components/Button',
    name: 'Primary',
    tags: ['dev', 'test', 'figma'],
    parameters: { layout: 'padded', holotype: { keepLayout: true, colums: 2 } },
    argTypes: { size: { control: 'inline-radio', options: ['sm', 'md'] }, onClick: { type: { name: 'function' } } },
    initialArgs: { size: 'md', label: 'Button' },
    storyArgs: { label: 'Button' },
    storyGlobals: {},
    declaredArgTypes: ['size'],
    docgenProps: ['onClick', 'size'],
    componentName: 'Button',
    subcomponents: [],
    hasPlay: false,
    usesMount: false,
  };

  it('normalizes argTypes, applies the config layers and reports parameter problems', () => {
    const meta = toStoryMeta(
      story('components-button--primary'),
      raw,
      { stories, manifest },
      {
        defaults: { matrix: 'pairwise' },
      },
    );
    expect(meta).toMatchObject({
      id: 'components-button--primary',
      sid: 'components-button',
      titlePath: ['Components', 'Button'],
      exportName: 'Primary',
      importPath: './src/components/Button/Button.stories.tsx',
      componentPath: './src/components/Button/Button.tsx',
      holotype: { matrix: 'pairwise', keepLayout: true },
      args: { label: 'Button' },
      initialArgs: { size: 'md', label: 'Button' },
      code: { exportName: 'Button', package: '@holotype/fixture-ds-react' },
    });
    expect(meta.argTypes).toEqual({
      onClick: { name: 'onClick', origin: 'docgen-inline', type: { name: 'function' }, control: false },
      size: { name: 'size', origin: 'story', control: { type: 'inline-radio' }, options: ['sm', 'md'] },
    });
    expect(meta.diagnostics.map((d) => [d.code, d.data?.suggestion])).toEqual([['PLAN_PARAM_UNKNOWN_KEY', undefined]]);
  });
});

describe('readStoryMetas (in-page, 03 §4.1)', () => {
  const host = globalThis as unknown as Record<string, unknown>;
  afterEach(() => {
    delete host.window;
  });

  it('serializes non-JSON values into markers', async () => {
    const cycle: Record<string, unknown> = { name: 'loop' };
    cycle.self = cycle;
    class Thing {}
    const element = { $$typeof: Symbol.for('react.element'), type: { displayName: 'Star' }, props: {} };
    const story = {
      id: 'a--b',
      title: 'A',
      name: 'B',
      tags: ['figma', 3],
      parameters: { fn: function named() {}, re: /x+/gi, date: new Date('2026-01-02T03:04:05Z'), nan: Number.NaN },
      argTypes: { icon: { mapping: { star: element } } },
      initialArgs: { icon: element, missing: undefined, thing: new Thing(), sym: Symbol('s'), cycle, big: 10n },
      storyGlobals: { theme: 'dark' },
      component: { __docgenInfo: { displayName: 'Probe', props: { label: {}, tone: {} } } },
      subcomponents: { Item: {} },
      moduleExport: { args: { label: 'x' } },
      playFunction: async () => {},
      usesMount: false,
    };
    const preview = {
      ready: async () => {},
      loadStory: async ({ storyId }: { storyId: string }) => {
        if (storyId === 'broken--story') throw new Error('import failed');
        return { ...story, id: storyId };
      },
      storyStoreValue: {
        projectAnnotations: { argTypes: { theme: {} } },
        loadCSFFileByStoryId: async () => ({
          meta: { argTypes: { tone: {} } },
          stories: { 'a--b': { argTypes: { icon: {} } } },
        }),
      },
    };
    host.window = { __STORYBOOK_PREVIEW__: preview };
    const read = await readStoryMetas({ ids: ['a--b', 'broken--story'], limits: { ...SAFE_LIMITS, maxArray: 1 } });
    expect(read['broken--story']).toEqual({ error: expect.stringContaining('import failed') });
    expect(read['a--b']).toEqual({
      id: 'a--b',
      title: 'A',
      name: 'B',
      tags: ['figma'],
      parameters: {
        fn: { $fn: 'named' },
        re: { $regexp: '/x+/gi' },
        date: { $date: '2026-01-02T03:04:05.000Z' },
        nan: { $num: 'NaN' },
      },
      argTypes: { icon: { mapping: { star: { $node: 'react', type: 'Star' } } } },
      initialArgs: {
        icon: { $node: 'react', type: 'Star' },
        missing: { $undef: true },
        thing: { $obj: 'Thing' },
        sym: { $sym: 's' },
        cycle: { name: 'loop', self: { $cycle: true } },
        big: { $bigint: '10' },
      },
      storyArgs: { label: 'x' },
      storyGlobals: { theme: 'dark' },
      declaredArgTypes: ['icon', 'theme', 'tone'],
      docgenProps: ['label', 'tone'],
      componentName: 'Probe',
      subcomponents: ['Item'],
      hasPlay: true,
      usesMount: false,
    });
  });

  it('truncates long arrays and deep values', async () => {
    const deep = { a: { b: { c: 1 } } };
    const preview = {
      loadStory: async () => ({ id: 'a--b', title: 'A', name: 'B', initialArgs: { list: [1, 2, 3], deep } }),
    };
    host.window = { __STORYBOOK_PREVIEW__: preview };
    const read = await readStoryMetas({ ids: ['a--b'], limits: { maxDepth: 3, maxArray: 2 } });
    expect(read['a--b']).toMatchObject({
      initialArgs: { list: [1, 2, { $truncated: 1 }], deep: { a: { b: { $truncated: 'depth' } } } },
      tags: [],
      hasPlay: false,
    });
  });
});
