import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_BASE,
  designDocsRepo,
  planLinks,
  repoLink,
  repoWebUrl,
  resolveRepoUrl,
  siteBase,
} from '../.vitepress/lib/site.ts';

describe('siteBase', () => {
  it('defaults to the GitHub project pages path', () => {
    expect(siteBase(undefined)).toBe(DEFAULT_SITE_BASE);
    expect(siteBase('')).toBe(DEFAULT_SITE_BASE);
    expect(siteBase('   ')).toBe(DEFAULT_SITE_BASE);
  });

  it('adds the leading and trailing slash', () => {
    expect(siteBase('holotype')).toBe('/holotype/');
    expect(siteBase('/holotype')).toBe('/holotype/');
    expect(siteBase('holotype/')).toBe('/holotype/');
    expect(siteBase('/docs/holotype/')).toBe('/docs/holotype/');
  });

  it('accepts the domain root for a custom domain', () => {
    expect(siteBase('/')).toBe('/');
  });

  it.each(['https://example.com/', '/a//b/', '/../x/', '/a b/', '/a?b'])('rejects %j', (value) => {
    expect(() => siteBase(value)).toThrow(/HOLOTYPE_SITE_BASE must be a URL path/);
  });
});

describe('repoWebUrl', () => {
  it.each([
    ['https://github.com/acme/ui', 'https://github.com/acme/ui'],
    ['https://github.com/acme/ui.git', 'https://github.com/acme/ui'],
    ['https://github.com/acme/ui/', 'https://github.com/acme/ui'],
    ['https://user:secret@github.com/acme/ui.git', 'https://github.com/acme/ui'],
    ['http://GitHub.com/acme/ui', 'https://github.com/acme/ui'],
    ['git@github.com:acme/ui.git', 'https://github.com/acme/ui'],
    ['ssh://git@github.com/acme/ui.git', 'https://github.com/acme/ui'],
    ['https://gitlab.example.com/acme/ui.git\n', 'https://gitlab.example.com/acme/ui'],
  ])('%j → %j', (remote, expected) => {
    expect(repoWebUrl(remote)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    '/home/me/ui',
    'file:///home/me/ui',
    'http://127.0.0.1:8080/git/acme/ui',
    'http://localhost/acme/ui',
    'https://github.com/acme',
    'https://github.com/acme/ui/tree/main',
  ])('returns undefined for %j', (remote) => {
    expect(repoWebUrl(remote)).toBeUndefined();
  });
});

describe('resolveRepoUrl', () => {
  const never = () => {
    throw new Error('git must not be asked');
  };

  it('prefers HOLOTYPE_REPO_URL', () => {
    expect(
      resolveRepoUrl({
        explicit: 'https://github.com/acme/docs.git',
        githubServerUrl: 'https://github.com',
        githubRepository: 'acme/ui',
        gitRemote: never,
      }),
    ).toBe('https://github.com/acme/docs');
  });

  it('rejects an explicit value that is not a repository URL', () => {
    expect(() => resolveRepoUrl({ explicit: 'acme/ui', gitRemote: never })).toThrow(/HOLOTYPE_REPO_URL/);
  });

  it('uses the GitHub Actions variables next', () => {
    expect(
      resolveRepoUrl({ githubServerUrl: 'https://github.com/', githubRepository: 'acme/ui', gitRemote: never }),
    ).toBe('https://github.com/acme/ui');
  });

  it('falls back to the git remote, and to no link at all', () => {
    expect(resolveRepoUrl({ gitRemote: () => 'git@github.com:acme/ui.git' })).toBe('https://github.com/acme/ui');
    expect(resolveRepoUrl({ gitRemote: () => undefined })).toBeUndefined();
    expect(resolveRepoUrl({})).toBeUndefined();
  });
});

describe('repoLink', () => {
  it('links files and folders on the default branch', () => {
    expect(repoLink('https://github.com/acme/ui', 'docs/plan/05-capture.md#a')).toBe(
      'https://github.com/acme/ui/blob/main/docs/plan/05-capture.md#a',
    );
    expect(repoLink('https://github.com/acme/ui', '/docs/plan', 'tree')).toBe(
      'https://github.com/acme/ui/tree/main/docs/plan',
    );
  });
});

describe('planLinks', () => {
  it('keeps the design docs private by default', () => {
    expect(planLinks(undefined)).toBe('text');
    expect(planLinks('')).toBe('text');
    expect(planLinks('  ')).toBe('text');
    expect(planLinks('text')).toBe('text');
  });

  it('opts in to repository links with "repo"', () => {
    expect(planLinks('repo')).toBe('repo');
    expect(planLinks(' repo\n')).toBe('repo');
  });

  it.each(['Repo', 'true', '1', 'github', 'https://github.com/acme/ui'])('rejects %j', (value) => {
    expect(() => planLinks(value)).toThrow(/HOLOTYPE_SITE_PLAN_LINKS must be "repo"/);
  });
});

describe('designDocsRepo', () => {
  it('gives the repository only when opted in', () => {
    expect(designDocsRepo('repo', 'https://github.com/acme/ui')).toBe('https://github.com/acme/ui');
    expect(designDocsRepo('text', 'https://github.com/acme/ui')).toBeUndefined();
    expect(designDocsRepo('repo', undefined)).toBeUndefined();
  });
});
