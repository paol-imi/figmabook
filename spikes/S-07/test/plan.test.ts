import { describe, expect, it } from 'vitest';
import { buildPlan, lanes, type StoryMetaLite, sample, storyCandidates } from '../plan.ts';

const button: StoryMetaLite = {
  id: 'components-button--primary',
  title: 'Components/Button',
  initialArgs: { variant: 'primary', disabled: false, label: 'Button', onClick: { $nonJson: 'function' } },
  argTypes: {
    variant: { options: ['primary', 'secondary', 'ghost'], control: 'inline-radio' },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
    onClick: { control: false },
  },
};

const badge: StoryMetaLite = {
  id: 'components-badge--default',
  title: 'Components/Badge',
  initialArgs: { tone: 'neutral' },
  argTypes: { tone: { options: ['neutral', 'info'], control: 'select' } },
};

const theme = { name: 'theme', value: 'dark' } as const;

describe('storyCandidates', () => {
  it('lists the initial state, other options, a toggle and a URL-safe text, in arg order', () => {
    expect(storyCandidates(button)).toEqual([
      { args: {}, globals: {} },
      { args: { disabled: true }, globals: {} },
      { args: { label: 'Spike label text' }, globals: {} },
      { args: { variant: 'secondary' }, globals: {} },
      { args: { variant: 'ghost' }, globals: {} },
    ]);
  });

  it('puts the theme variant third, and skips args with control: false', () => {
    const candidates = storyCandidates(button, { themeGlobal: theme });
    expect(candidates[2]).toEqual({ args: {}, globals: { theme: 'dark' } });
    expect(candidates.some((candidate) => 'onClick' in candidate.args)).toBe(false);
  });

  it('skips non-primitive options', () => {
    const story: StoryMetaLite = {
      ...badge,
      argTypes: { tone: { options: ['neutral', { nested: true }, 'info'] } },
    };
    expect(storyCandidates(story).map((candidate) => candidate.args)).toEqual([{}, { tone: 'info' }]);
  });
});

describe('buildPlan', () => {
  it('takes every initial state first, then round-robins changes, grouped by story', () => {
    const plan = buildPlan([button, badge], { count: 5, themeGlobal: theme });
    expect(plan.map((variant) => variant.label)).toEqual([
      'components-button--primary',
      'components-button--primary disabled=true',
      'components-button--primary theme=dark',
      'components-badge--default',
      'components-badge--default tone=info',
    ]);
    expect(plan.map((variant) => variant.index)).toEqual([0, 1, 2, 3, 4]);
    expect(plan[0]?.sid).toBe('components-button');
  });

  it('can interleave stories, the worst case for story switches', () => {
    const plan = buildPlan([button, badge], { count: 4, order: 'interleaved' });
    expect(plan.map((variant) => variant.storyId)).toEqual([
      'components-button--primary',
      'components-badge--default',
      'components-button--primary',
      'components-badge--default',
    ]);
  });

  it('is deterministic', () => {
    expect(buildPlan([button, badge], { count: 6 })).toEqual(buildPlan([button, badge], { count: 6 }));
  });

  it('rejects a count the stories cannot fill, and a bad count', () => {
    expect(() => buildPlan([badge], { count: 3 })).toThrow(/only 2 variants/);
    expect(() => buildPlan([badge], { count: 0 })).toThrow(RangeError);
  });
});

describe('sample', () => {
  it('takes every n-th item from an offset', () => {
    expect(sample([0, 1, 2, 3, 4, 5, 6], 3)).toEqual([0, 3, 6]);
    expect(sample([0, 1, 2, 3, 4, 5, 6], 3, 1)).toEqual([1, 4]);
    expect(() => sample([1], 0)).toThrow(RangeError);
  });
});

describe('lanes', () => {
  it('keeps each component on one lane and deals components out in order', () => {
    const plan = ['a', 'b', 'a', 'c', 'b', 'd'].map((sid, index) => ({ sid, index }));
    expect(lanes(plan, 2).map((lane) => lane.map((variant) => variant.index))).toEqual([
      [0, 2, 3],
      [1, 4, 5],
    ]);
    expect(lanes(plan, 10)).toHaveLength(4);
    expect(() => lanes(plan, 0)).toThrow(RangeError);
  });
});
