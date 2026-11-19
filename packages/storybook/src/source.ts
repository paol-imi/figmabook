import { fileURLToPath } from 'node:url';
import type { StorybookSource } from './types';

/**
 * Reads a `--storybook <dir|url>` value or `storybook.source` (16 §4): an `http(s)` URL is a
 * running Storybook, a `file:` URL or any other string is a static build directory.
 */
export function parseSource(input: string): StorybookSource {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return { kind: 'url', url: value };
  if (/^file:\/\//i.test(value)) return { kind: 'static', dir: fileURLToPath(value) };
  return { kind: 'static', dir: value };
}

export interface NormalizedUrl {
  /** Root URL with a trailing slash, no query and no hash. */
  readonly baseUrl: string;
  /** The story of a `?path=/story/<id>` deep link. */
  readonly defaultStoryId?: string;
}

const PAGE_SUFFIX = /\/(?:index|iframe)\.html$/i;
const STORY_PATH = /^\/story\/([^/?#]+)/;

/**
 * Strips a Storybook URL to its root (03 §2.1): `…/index.html`, `…/iframe.html`, the query and
 * the hash go; a `?path=/story/<id>` deep link is kept as the default story. Throws a
 * `TypeError` for a string that is not an `http(s)` URL.
 */
export function normalizeStorybookUrl(input: string): NormalizedUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError(`Not a URL: "${input}".`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`Not an http(s) URL: "${input}".`);
  }
  const deepLink = STORY_PATH.exec(url.searchParams.get('path') ?? '')?.[1];
  let pathname = url.pathname.replace(PAGE_SUFFIX, '/');
  if (!pathname.endsWith('/')) pathname += '/';
  const baseUrl = `${url.origin}${pathname}`;
  return deepLink === undefined ? { baseUrl } : { baseUrl, defaultStoryId: decodeURIComponent(deepLink) };
}
