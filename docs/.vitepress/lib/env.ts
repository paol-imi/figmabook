/** Build-time values shared by the site config and the dynamic route loaders. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { designDocsRepo, planLinks, resolveRepoUrl, siteBase } from './site.ts';

/** Repository root (the site lives in `docs/`). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The site's source root, `docs/`. */
export const SITE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function gitRemote(): string | undefined {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

/** `HOLOTYPE_SITE_BASE`, normalized; `/figmabook/` by default. */
export const SITE_BASE = siteBase(process.env.HOLOTYPE_SITE_BASE);

/** The repository's web URL, or `undefined` when it cannot be told (then no repository links). */
export const REPO_URL = resolveRepoUrl({
  explicit: process.env.HOLOTYPE_REPO_URL,
  githubServerUrl: process.env.GITHUB_SERVER_URL,
  githubRepository: process.env.GITHUB_REPOSITORY,
  gitRemote,
});

/** `HOLOTYPE_SITE_PLAN_LINKS`: `text` by default, `repo` to link the design docs. */
export const PLAN_LINKS = planLinks(process.env.HOLOTYPE_SITE_PLAN_LINKS);

/**
 * Repository that links into `internal/` (plan, research) point at, that the nav's "Design
 * docs" opens and that the header's GitHub icon links to; `undefined` unless
 * `HOLOTYPE_SITE_PLAN_LINKS=repo` (then the site has no repository links at all).
 */
export const DESIGN_DOCS_REPO_URL = designDocsRepo(PLAN_LINKS, REPO_URL);
