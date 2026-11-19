import { resolve } from 'node:path';
import { documentOrigin, parseSource, type StorybookSource } from '@holotype/storybook';

/** `storybook.source` as a connectable source: a static directory resolves against `cwd`. */
export function resolveSource(source: string, cwd: string): StorybookSource {
  const parsed = parseSource(source);
  return parsed.kind === 'static' ? { kind: 'static', dir: resolve(cwd, parsed.dir) } : parsed;
}

/**
 * The source as reports and manifests show it (06 §4.2 `source.origin`): a URL without
 * credentials, query or hash; a static build as `static:<folder name>` (the same origin its
 * captures record, `documentOrigin`), so no local path and no ephemeral loopback port ends up
 * in a bundle.
 */
export function redactSource(source: StorybookSource): string {
  if (source.kind === 'static') return documentOrigin(source);
  try {
    const url = new URL(source.url);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return 'url:invalid';
  }
}

/** Storybook docs links for a component, only for a Storybook others can open (a URL source). */
export function storybookLinks(
  source: StorybookSource,
  baseUrl: string,
  storyId: string,
): { readonly label: string; readonly url: string }[] {
  if (source.kind === 'static') return [];
  const url = new URL(baseUrl);
  url.search = `?path=/story/${encodeURIComponent(storyId)}`;
  return [{ label: 'Storybook', url: url.href }];
}
