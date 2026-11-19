/**
 * Build-time settings of the site: the base path it is served under, the repository it
 * links to, and whether it links to the internal design docs. All come from the environment,
 * so a repository rename, a custom domain or a public repository is a change of one
 * variable, not of the content.
 */

/** GitHub project pages serve the site under `/<repository name>/`. */
export const DEFAULT_SITE_BASE = '/figmabook/';

/** Branch that repository links ("Design docs", plan links when opted in) point at. */
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

/**
 * How the site treats links into the internal design docs (`docs/plan/`, `docs/research/`),
 * which it never publishes:
 * - `text` (default): the link becomes its plain text. The repository is private, so a link
 *   would be dead for readers and would expose internal file names.
 * - `repo`: the link points at the file in the repository, and the nav shows "Design docs".
 *   Only for a public repository.
 */
export type PlanLinks = 'text' | 'repo';

const PLAN_LINK_MODES: readonly PlanLinks[] = ['text', 'repo'];

/** `HOLOTYPE_SITE_PLAN_LINKS`, validated; unset or blank means `text`. */
export function planLinks(value: string | undefined): PlanLinks {
  const raw = value?.trim();
  if (!raw) return 'text';
  const mode = PLAN_LINK_MODES.find((candidate) => candidate === raw);
  if (!mode) {
    throw new Error(
      `HOLOTYPE_SITE_PLAN_LINKS must be "repo" (link the design docs in the repository) or "text" (the default), not ${JSON.stringify(value)}.`,
    );
  }
  return mode;
}

/**
 * The repository that links into the design docs point at: the repository URL when the site
 * opted in with `repo`, otherwise `undefined` (the links become plain text).
 */
export function designDocsRepo(mode: PlanLinks, repoUrl: string | undefined): string | undefined {
  return mode === 'repo' ? repoUrl : undefined;
}
