import { basename, resolve } from 'node:path';
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

/** The scheme of a {@link documentOrigin} for a static build. */
export const STATIC_ORIGIN_SCHEME = 'static:';

/**
 * The origin that documents record for renders of `source` (06 §2 `target.storybookUrl`), so a
 * capture is the same wherever it ran. A URL source is its server origin (scheme, host, port; no
 * credentials). A static build is `static:<folder name>`: Holotype serves it on an ephemeral
 * loopback port (03 §9.1), which is not a fact of the design, and its local path is private.
 * Throws a `TypeError` for a URL source that is not an `http(s)` URL.
 */
export function documentOrigin(source: StorybookSource): string {
  if (source.kind === 'static') return `${STATIC_ORIGIN_SCHEME}${basename(resolve(source.dir))}`;
  return new URL(normalizeStorybookUrl(source.url).baseUrl).origin;
}

/**
 * A page URL as documents record it: `origin` ({@link documentOrigin}) and the path of `url`;
 * credentials, query and hash are dropped.
 */
export function documentUrl(url: string, origin: string): string {
  return `${origin}${new URL(url).pathname}`;
}
