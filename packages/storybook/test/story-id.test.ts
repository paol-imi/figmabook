import { describe, expect, it } from 'vitest';
import { componentIdFromStoryId } from '../src';

describe('componentIdFromStoryId', () => {
  it.each([
    ['components-button--primary', 'components-button'],
    ['forms-input--with-label--dark', 'forms-input'],
    ['icon--default', 'icon'],
  ])('%s → %s', (storyId, sid) => {
    expect(componentIdFromStoryId(storyId)).toBe(sid);
  });

  it.each(['components-button', '--primary', ''])('rejects "%s"', (storyId) => {
    expect(() => componentIdFromStoryId(storyId)).toThrow(TypeError);
  });
});
