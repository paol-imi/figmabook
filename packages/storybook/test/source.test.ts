import { describe, expect, it } from 'vitest';
import { componentIdFromStoryId, isStoryId, normalizeStorybookUrl, parseSource } from '../src';

describe('parseSource', () => {
  it.each([
    ['http://127.0.0.1:6006', { kind: 'url', url: 'http://127.0.0.1:6006' }],
    ['  HTTPS://sb.example.test/  ', { kind: 'url', url: 'HTTPS://sb.example.test/' }],
    ['storybook-static', { kind: 'static', dir: 'storybook-static' }],
    ['/srv/storybook-static/', { kind: 'static', dir: '/srv/storybook-static/' }],
    ['file:///srv/storybook-static', { kind: 'static', dir: '/srv/storybook-static' }],
  ])('%s', (input, expected) => {
    expect(parseSource(input)).toEqual(expected);
  });
});

describe('normalizeStorybookUrl (03 §2.1)', () => {
  it.each([
    ['http://127.0.0.1:6006', 'http://127.0.0.1:6006/'],
    ['http://127.0.0.1:6006/index.html', 'http://127.0.0.1:6006/'],
    ['http://127.0.0.1:6006/iframe.html?id=a--b&viewMode=story', 'http://127.0.0.1:6006/'],
    ['https://user:secret@sb.example.test/design/system#top', 'https://sb.example.test/design/system/'],
    ['https://main--abc123.chromatic.com/', 'https://main--abc123.chromatic.com/'],
  ])('%s → %s', (input, baseUrl) => {
    expect(normalizeStorybookUrl(input)).toEqual({ baseUrl });
  });

  it('keeps a ?path=/story/<id> deep link as the default story', () => {
    expect(normalizeStorybookUrl('http://127.0.0.1:6006/?path=/story/components-button--primary')).toEqual({
      baseUrl: 'http://127.0.0.1:6006/',
      defaultStoryId: 'components-button--primary',
    });
    expect(normalizeStorybookUrl('http://127.0.0.1:6006/index.html?path=/docs/components-button--docs')).toEqual({
      baseUrl: 'http://127.0.0.1:6006/',
    });
  });

  it.each(['not a url', 'ftp://example.test/'])('rejects %s', (input) => {
    expect(() => normalizeStorybookUrl(input)).toThrow(TypeError);
  });
});

describe('story ids', () => {
  it.each([
    ['components-button--primary', 'components-button'],
    ['forms-input--with-label--dark', 'forms-input'],
    ['icon--default', 'icon'],
  ])('componentIdFromStoryId(%s) → %s', (storyId, sid) => {
    expect(componentIdFromStoryId(storyId)).toBe(sid);
    expect(isStoryId(storyId)).toBe(true);
  });

  it.each(['components-button', '--primary', ''])('rejects "%s"', (storyId) => {
    expect(() => componentIdFromStoryId(storyId)).toThrow(TypeError);
    expect(isStoryId(storyId)).toBe(false);
  });
});
