import { canonicalJSON, variantKey } from '@holotype/ir';
import type { IndexStory, SbCapabilities, StorybookModel } from '@holotype/storybook';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEWPORT, frameworkOf, identityOf, planSingleStory } from '../src';

const caps: SbCapabilities = {
  version: '10.6.7',
  indexFormat: 'v5',
  storyFinishedEvent: true,
  awaitsAnimations: true,
  pauseAnimationsInTestRunner: true,
  docgenServer: false,
  componentsManifest: true,
  argTypesInfoEvent: true,
  storyGlobals: true,
  pseudoStatesGlobal: true,
  framework: '@storybook/react-vite',
  renderer: '@storybook/react',
  builder: 'vite',
};

const story = (id: string, title: string, extra: Partial<IndexStory> = {}): IndexStory => ({
  id,
  sid: id.slice(0, id.indexOf('--')),
  title,
  titlePath: title.split('/'),
  name: 'Row',
  importPath: './src/micro/Flex.stories.tsx',
  tags: ['dev', 'test'],
  ...extra,
});

const model: StorybookModel = {
  baseUrl: 'http://127.0.0.1:6006/',
  caps,
  stories: [
    story('micro-flex--row', 'Micro/Flex'),
    story('components-badge--default', 'Components/Badge', {
      importPath: './src/components/Badge/Badge.stories.tsx',
      componentPath: './src/components/Badge/Badge.tsx',
    }),
  ],
  excluded: [{ id: 'micro-flex--hidden', title: 'Micro/Flex', reason: 'tag-opt-out' }],
  indexHash: 'a'.repeat(64),
};

describe('planSingleStory', () => {
  it('plans one default variant with the story args and the D-24 viewport', () => {
    const plan = planSingleStory(model, 'micro-flex--row');
    if (!plan.ok) throw new Error(plan.error.message);
    const [variant] = plan.value.variants;
    expect(plan.value).toMatchObject({
      sid: 'micro-flex',
      baseStoryId: 'micro-flex--row',
      axes: [],
      properties: [],
      probes: [],
      modes: null,
      budget: { requested: 1, emitted: 1, strategy: 'auto', droppedAxes: [] },
      identity: {
        sid: 'micro-flex',
        displayName: 'Flex',
        importPath: './src/micro/Flex.stories.tsx',
        framework: 'react',
      },
    });
    expect(plan.value.variants).toHaveLength(1);
    expect(variant).toEqual({
      vk: variantKey({ storyId: 'micro-flex--row', args: {}, globals: {}, state: null, viewport: { w: 1280, h: 800 } }),
      values: {},
      isDefault: true,
      render: { storyId: 'micro-flex--row', args: {}, globals: {}, viewport: { width: 1280, height: 800 } },
    });
  });

  it('is deterministic', () => {
    const a = planSingleStory(model, 'components-badge--default');
    const b = planSingleStory(model, 'components-badge--default');
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
    expect(a.ok && a.value.identity.componentPath).toBe('./src/components/Badge/Badge.tsx');
  });

  it('keys the variant by the viewport it renders at', () => {
    const wide = planSingleStory(model, 'micro-flex--row', { viewport: { width: 1440, height: 900 } });
    const plain = planSingleStory(model, 'micro-flex--row');
    if (!wide.ok || !plain.ok) throw new Error('plan failed');
    expect(wide.value.variants[0]?.render.viewport).toEqual({ width: 1440, height: 900 });
    expect(wide.value.variants[0]?.vk).not.toBe(plain.value.variants[0]?.vk);
    expect(DEFAULT_VIEWPORT).toEqual({ width: 1280, height: 800 });
  });

  it('reports SB_STORY_MISSING for an id outside the index', () => {
    const plan = planSingleStory(model, 'components-nope--default');
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toMatchObject({
      code: 'SB_STORY_MISSING',
      severity: 'error',
      value: 'components-nope--default',
      data: { reason: 'the story id is not in the Storybook index' },
    });
  });

  it('says when the story filter excluded the story', () => {
    const plan = planSingleStory(model, 'micro-flex--hidden');
    expect(plan.ok ? undefined : plan.error.data).toEqual({
      reason: 'the story is in the index but the story filter excludes it',
      exclusion: 'tag-opt-out',
    });
  });
});

describe('identity', () => {
  it('names the framework from the renderer, then the framework package', () => {
    expect(frameworkOf(caps)).toBe('react');
    expect(frameworkOf({ framework: '@storybook/vue3-vite' })).toBe('vue3');
    expect(frameworkOf({ framework: '@storybook/web-components-webpack5' })).toBe('web-components');
    expect(frameworkOf({})).toBe('unknown');
  });

  it('uses the last title segment as the display name', () => {
    const [first] = model.stories;
    if (first === undefined) throw new Error('no story');
    expect(identityOf(first, caps)).toEqual({
      sid: 'micro-flex',
      displayName: 'Flex',
      importPath: './src/micro/Flex.stories.tsx',
      framework: 'react',
    });
  });
});
