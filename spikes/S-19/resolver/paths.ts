/**
 * Source-map sources and `data-vite-dev-id` values → repo-relative paths (15 §5.2: `SourceLoc.file`
 * is repo-relative and validated inside the repo, 15 §10.3). Pure: no `node:path`, so the module
 * also runs in a browser bundle.
 */

export type RepoPathResult =
  | { readonly ok: true; readonly path: string }
  | {
      readonly ok: false;
      /**
       * `virtual`: a bundler-internal module (`\0…`, `virtual:`); `dependency`: inside
       * `node_modules`; `outside-repo`: a file outside `repoRoot`; `unresolvable`: a relative or
       * server path with no base to resolve it against.
       */
      readonly reason: 'virtual' | 'dependency' | 'outside-repo' | 'unresolvable';
    };

export interface RepoPathOptions {
  /** Absolute path of the repository root (any separator style). */
  readonly repoRoot: string;
  /** Absolute path of the Vite root, for server paths such as `/src/x.css`. */
  readonly viteRoot?: string;
  /** Absolute directory that relative sources resolve against (the style sheet's own file). */
  readonly baseDir?: string;
}

/** Forward slashes, no `.` segments, `..` folded; keeps a leading `/` or drive (`c:/`). */
export function normalizePath(path: string): string {
  const slashed = path.replaceAll('\\', '/');
  const drive = /^[A-Za-z]:\//.exec(slashed)?.[0];
  const prefix = drive !== undefined ? drive.toLowerCase() : slashed.startsWith('/') ? '/' : '';
  const out: string[] = [];
  for (const segment of slashed.slice(drive?.length ?? 0).split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (prefix === '') out.push('..');
    } else {
      out.push(segment);
    }
  }
  return prefix + out.join('/');
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function stripQuery(value: string): string {
  const cut = value.search(/[?#]/);
  return cut < 0 ? value : value.slice(0, cut);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** An absolute file path for `source`, or why there is none. */
function absoluteFile(source: string, options: RepoPathOptions): string | RepoPathResult {
  if (source.includes('\0') || source.startsWith('virtual:')) return { ok: false, reason: 'virtual' };
  let value = source;
  if (/^file:\/\//i.test(value)) {
    value = decode(stripQuery(value.replace(/^file:\/\/(?:localhost)?/i, '')));
    // file:///C:/x → /C:/x
    if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
  } else if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    value = decode(url.pathname);
    if (!value.startsWith('/@fs/')) {
      if (options.viteRoot === undefined) return { ok: false, reason: 'unresolvable' };
      return `${options.viteRoot}/${value}`;
    }
  } else {
    value = stripQuery(value);
  }
  if (value.startsWith('/@fs/')) value = value.slice('/@fs'.length);
  if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
  if (isAbsolute(value)) return value;
  if (options.baseDir === undefined) return { ok: false, reason: 'unresolvable' };
  return `${options.baseDir}/${value}`;
}

/** Maps a source (file path, `file:` URL, `/@fs/` path or dev-server URL) to a repo-relative path. */
export function toRepoPath(source: string, options: RepoPathOptions): RepoPathResult {
  const absolute = absoluteFile(source, options);
  if (typeof absolute !== 'string') return absolute;
  const file = normalizePath(absolute);
  const root = normalizePath(options.repoRoot).replace(/\/$/, '');
  const caseless = /^[a-z]:\//.test(root);
  const inside = caseless ? file.toLowerCase().startsWith(`${root.toLowerCase()}/`) : file.startsWith(`${root}/`);
  if (!inside) return { ok: false, reason: 'outside-repo' };
  const relative = file.slice(root.length + 1);
  if (relative === '' || relative.split('/').some((s) => s === '..' || s === '')) {
    return { ok: false, reason: 'outside-repo' };
  }
  if (relative.split('/').includes('node_modules')) return { ok: false, reason: 'dependency' };
  return { ok: true, path: relative };
}

/** The directory part of a normalized path (`a/b/c.css` → `a/b`). */
export function dirname(path: string): string {
  const normalized = normalizePath(path);
  const cut = normalized.lastIndexOf('/');
  return cut <= 0 ? normalized.slice(0, cut + 1) : normalized.slice(0, cut);
}
