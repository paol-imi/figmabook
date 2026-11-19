import { describe, expect, expectTypeOf, it } from 'vitest';
import type { HolotypeParameters, WithHolotypeParameters } from '../src';
import { previewAnnotations } from '../src/preset';

describe('storybook-addon', () => {
  it('appends its preview annotations to the existing entries', () => {
    const entries = previewAnnotations(['/project/.storybook/preview.ts']);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toBe('/project/.storybook/preview.ts');
    expect(entries[1]).toMatch(/[\\/]preview\.js$/);
  });

  it('types parameters.holotype', () => {
    expectTypeOf<{
      holotype: { strategy: 'curated'; variants: [{ Size: 'md' }] };
    }>().toExtend<WithHolotypeParameters>();
    expectTypeOf<{ strategy: 'everything' }>().not.toExtend<HolotypeParameters>();
  });
});
