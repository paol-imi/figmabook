/**
 * Build-time settings of the site: the base path it is served under and the repository
 * it links to. Both come from the environment, so a repository rename or a custom domain
 * is a change of one variable, not of the content.
 */

/** GitHub project pages serve the site under `/<repository name>/`. */
export const DEFAULT_SITE_BASE = '/figmabook/';

/** Branch that "Design docs" and diagnostics source links point at. */
export const DEFAULT_BRANCH = 'main';

/**
 * The VitePress `base` from `HOLOTYPE_SITE_BASE`: always one leading and one trailing slash,
 * `/` for a site at the domain root (custom domain). Unset or blank means the default.
 */
export function siteBase(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return DEFAULT_SITE_BASE;
  if (!/^[\w\-./~]+$/.test(raw) || raw.includes('//') || raw.split('/').includes('..')) {
    throw new Error(
      `HOLOTYPE_SITE_BASE must be a URL path such as "/figmabook/" or "/", not ${JSON.stringify(value)}.`,
    );
  }
  const trimmed = raw.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

/**
 * A browsable `https://host/owner/repo` URL for a git remote, without credentials or `.git`.
 * Returns `undefined` for remotes that are not a hosted repository (local paths, proxies).
 */
export function repoWebUrl(remote: string | undefined): string | undefined {
  const raw = remote?.trim();
  if (!raw) return undefined;
  const scp = /^[\w.-]+@([\w.-]+):([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(raw);
  if (scp) return webUrl(scp[1], scp[2]);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return undefined;
  if (!url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname)) return undefined;
  const path = /^\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.pathname);
  return path ? webUrl(url.hostname, path[1]) : undefined;
}

function webUrl(host: string | undefined, path: string | undefined): string | undefined {
  return host && path ? `https://${host.toLowerCase()}/${path}` : undefined;
}

export interface RepoSources {
  /** `HOLOTYPE_REPO_URL`: explicit override. */
  readonly explicit?: string | undefined;
  /** `GITHUB_SERVER_URL` and `GITHUB_REPOSITORY`, set by GitHub Actions. */
  readonly githubServerUrl?: string | undefined;
  readonly githubRepository?: string | undefined;
  /** Reads `git remote get-url origin`; only called when nothing above is set. */
  readonly gitRemote?: () => string | undefined;
}

/** The repository the site links to, or `undefined` (then the site shows no repository links). */
export function resolveRepoUrl(sources: RepoSources): string | undefined {
  if (sources.explicit?.trim()) {
    const url = repoWebUrl(sources.explicit);
    if (!url) throw new Error(`HOLOTYPE_REPO_URL is not a repository URL: ${JSON.stringify(sources.explicit)}.`);
    return url;
  }
  if (sources.githubServerUrl && sources.githubRepository) {
    return repoWebUrl(`${sources.githubServerUrl.replace(/\/+$/, '')}/${sources.githubRepository}`);
  }
  return repoWebUrl(sources.gitRemote?.());
}

/** Link to a file or folder in the repository at {@link DEFAULT_BRANCH}. */
export function repoLink(repoUrl: string, path: string, kind: 'blob' | 'tree' = 'blob'): string {
  return `${repoUrl}/${kind}/${DEFAULT_BRANCH}/${path.replace(/^\/+/, '')}`;
}
