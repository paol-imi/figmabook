import { describe, expect, it } from 'vitest';
import {
  componentIdFromStoryId,
  documentOrigin,
  documentUrl,
  isStoryId,
  normalizeStorybookUrl,
  parseSource,
} from '../src';

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

describe('documentOrigin (06 §2 target.storybookUrl)', () => {
  it.each([
    [{ kind: 'static', dir: '/home/someone/project/storybook-static' }, 'static:storybook-static'],
    [{ kind: 'static', dir: '/srv/storybook-static/' }, 'static:storybook-static'],
    [{ kind: 'url', url: 'http://127.0.0.1:6006/?path=/story/a--b' }, 'http://127.0.0.1:6006'],
    [{ kind: 'url', url: 'https://user:secret@sb.example.test/design/system/' }, 'https://sb.example.test'],
  ] as const)('%j → %s', (source, origin) => {
    expect(documentOrigin(source)).toBe(origin);
  });

  it('names a relative static directory by its resolved folder', () => {
    expect(documentOrigin({ kind: 'static', dir: '.' })).toMatch(/^static:[^/]+$/);
  });

  it('builds the document URL from the origin and the page path only', () => {
    expect(documentUrl('http://127.0.0.1:53111/iframe.html?id=a--b&args=x#top', 'static:sb')).toBe(
      'static:sb/iframe.html',
    );
    expect(documentUrl('https://u:p@sb.example.test/ui/iframe.html?id=a--b', 'https://sb.example.test')).toBe(
      'https://sb.example.test/ui/iframe.html',
    );
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
