/** Build-time values shared by the site config and the dynamic route loaders. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRepoUrl, siteBase } from './site.ts';

/** Repository root (the site lives in `website/`). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

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
